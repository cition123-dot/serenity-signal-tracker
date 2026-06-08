import { chromium, type BrowserContext, type Page } from "playwright";

const TARGET_HANDLE = "aleabitoreddit";
const TARGET_URL = `https://x.com/${TARGET_HANDLE}`;
const PROFILE_DIR = process.env.PLAYWRIGHT_PROFILE_DIR || "playwright-profile";
const INGEST_URL = process.env.INGEST_URL || "http://localhost:8888/api/ingest";
const SECRET = process.env.WORKER_INGEST_SECRET || "";
const INTERVAL_MS = Number(process.env.COLLECTOR_INTERVAL_MS || 1800000);
const BACKFILL_ON_START_DAYS = Number(process.env.BACKFILL_ON_START_DAYS || 0);
const MAX_BACKFILL_SCROLLS = Number(process.env.MAX_BACKFILL_SCROLLS || 40);
const RUN_ONCE = process.env.RUN_ONCE === "true";
const FETCH_TIMEOUT_MS = Number(process.env.COLLECTOR_FETCH_TIMEOUT_MS || 15000);
const RUN_ONCE_MAX_POSTS = Number(process.env.RUN_ONCE_MAX_POSTS || 5);

type CollectedPost = {
  xPostId: string;
  url: string;
  body: string;
  postedAt: string;
};

async function main() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: process.env.HEADLESS !== "false",
    viewport: { width: 1280, height: 900 }
  });
  await seedXCookies(context);
  const page = context.pages()[0] || (await context.newPage());

  if (BACKFILL_ON_START_DAYS > 0) {
    await runCollection(page, {
      label: `backfill ${BACKFILL_ON_START_DAYS}d`,
      since: new Date(Date.now() - BACKFILL_ON_START_DAYS * 24 * 60 * 60 * 1000),
      maxScrolls: MAX_BACKFILL_SCROLLS
    });
  }

  if (RUN_ONCE) {
    await runCollection(page, {
      label: process.env.COLLECTOR_LABEL || "one-shot",
      since: undefined,
      maxScrolls: 1,
      maxPosts: RUN_ONCE_MAX_POSTS
    });
    await context.close();
    return;
  }

  while (true) {
    await runCollection(page, {
      label: "latest",
      since: BACKFILL_ON_START_DAYS > 0
        ? new Date(Date.now() - BACKFILL_ON_START_DAYS * 24 * 60 * 60 * 1000)
        : undefined,
      maxScrolls: 2
    });
    await page.waitForTimeout(INTERVAL_MS);
  }
}

async function runCollection(
  page: Page,
  options: { label: string; since?: Date; maxScrolls: number; maxPosts?: number }
) {
    try {
      const posts = await collectPosts(page, options);
      let ingested = 0;
      let failed = 0;
      for (const post of posts) {
        try {
          await ingest(post);
          ingested += 1;
        } catch (error) {
          failed += 1;
          console.error("[collector] post ingest failed", {
            xPostId: post.xPostId,
            message: error instanceof Error ? error.message : "Unknown ingest error"
          });
        }
      }
      const status = failed > 0 ? "degraded" : "healthy";
      const message = `${options.label}: collected ${posts.length} posts, ingested ${ingested}, failed ${failed}`;
      await reportStatus(status, message, ingested > 0 ? new Date().toISOString() : undefined);
      console.log(`[collector] ${new Date().toISOString()} ${message}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown collector error";
      await reportStatus(message.includes("login appears to be required") ? "login_required" : "degraded", message);
      console.error("[collector] failed", error);
    }
}

async function collectPosts(
  page: Page,
  options: { since?: Date; maxScrolls: number; maxPosts?: number }
): Promise<CollectedPost[]> {
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(4000);

  const loginLink = page.getByText(/log in|sign in/i).first();
  if (await loginLink.isVisible().catch(() => false)) {
    throw new Error("X login appears to be required. Run worker with HEADLESS=false and log in.");
  }

  const collected = new Map<string, CollectedPost>();
  for (let scroll = 0; scroll <= options.maxScrolls; scroll += 1) {
    await expandVisibleArticles(page);
    const articles = await readVisibleArticles(page);
    for (const item of articles) {
      if (!item.link || !item.time || !item.text) continue;
      const postedAt = new Date(item.time);
      if (Number.isNaN(postedAt.getTime())) continue;
      if (options.since && postedAt < options.since) {
        continue;
      }

      const statusId = item.link.match(/status\/(\d+)/)?.[1] || item.link;
      if (collected.has(statusId)) continue;
      collected.set(statusId, {
        xPostId: statusId,
        url: new URL(item.link, "https://x.com").toString(),
        body: cleanPostText(item.text),
        postedAt: postedAt.toISOString()
      });
    }

    console.log(
      `[collector] visible=${articles.length} unique=${collected.size} scroll=${scroll}/${options.maxScrolls}`
    );

    if (scroll === options.maxScrolls) break;
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(1800);
  }

  const posts = Array.from(collected.values()).sort(
    (a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime()
  );
  return hydrateFullPostBodies(page, options.maxPosts ? posts.slice(0, options.maxPosts) : posts);
}

async function hydrateFullPostBodies(page: Page, posts: CollectedPost[]): Promise<CollectedPost[]> {
  const detailPage = await page.context().newPage();
  const hydrated: CollectedPost[] = [];

  for (const post of posts) {
    try {
      const fullText = await readFullPostFromDetail(detailPage, post.url);
      hydrated.push({
        ...post,
        body: fullText && fullText.length > post.body.length ? fullText : post.body
      });
    } catch (error) {
      console.warn("[collector] detail read failed", {
        xPostId: post.xPostId,
        message: error instanceof Error ? error.message : "Unknown detail read error"
      });
      hydrated.push(post);
    }
  }

  await detailPage.close().catch(() => undefined);
  return hydrated;
}

async function readFullPostFromDetail(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForLoadState("load", { timeout: 5000 }).catch(() => undefined);

  const article = page.locator("article").first();
  if (!(await article.isVisible({ timeout: 8000 }).catch(() => false))) {
    return "";
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await expandVisibleArticles(page);
    await page.waitForTimeout(250);
  }

  const tweetText = article.locator("[data-testid='tweetText']").first();
  const text = await tweetText.textContent({ timeout: 5000 }).catch(() => null);
  return cleanPostText(text || "");
}

async function expandVisibleArticles(page: Page) {
  const articles = page.locator("article");
  const count = await articles.count();

  for (let index = 0; index < count; index += 1) {
    const article = articles.nth(index);
    const expandButton = article
      .locator("div[role='button'], span[role='button'], button")
      .filter({ hasText: /show more|显示更多|查看更多|展开/i })
      .first();

    if (await expandButton.isVisible().catch(() => false)) {
      await expandButton.click({ timeout: 1200 }).catch(() => undefined);
      await page.waitForTimeout(250);
    }
  }
}

async function readVisibleArticles(page: Page) {
  return page.locator("article").evaluateAll((nodes) => {
    return nodes.map((node) => {
      const textNode = node.querySelector("[data-testid='tweetText']");
      const text = (textNode?.textContent || node.textContent || "").trim();
      const timeNode = node.querySelector("time");
      const time = timeNode?.getAttribute("datetime");
      const link = timeNode?.closest("a")?.getAttribute("href");
      return { text, link, time };
    });
  });
}

async function seedXCookies(context: BrowserContext) {
  const authToken = process.env.X_AUTH_TOKEN;
  const ct0 = process.env.X_CT0;
  const cookiesJson = process.env.X_COOKIES_JSON;

  if (cookiesJson) {
    await context.addCookies(JSON.parse(cookiesJson));
    return;
  }

  if (!authToken || !ct0) return;

  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 180;
  await context.addCookies(
    [".x.com", ".twitter.com"].flatMap((domain) => [
      {
        name: "auth_token",
        value: authToken,
        domain,
        path: "/",
        expires,
        httpOnly: true,
        secure: true,
        sameSite: "Lax" as const
      },
      {
        name: "ct0",
        value: ct0,
        domain,
        path: "/",
        expires,
        httpOnly: false,
        secure: true,
        sameSite: "Lax" as const
      }
    ])
  );
}

function cleanPostText(text: string) {
  let cleaned = text
    .replace(/\s+/g, " ")
    .replace(/^.*?@aleabitoreddit/i, "")
    .replace(/Show more|显示更多|查看更多|展开|Subscribe to unlock/gi, " ")
    .replace(/\s+x\.com\/\S+…?\d*(?:\.\d+)?[KMB]?\d*(?:\.\d+)?[KMB]?\s*$/i, " ")
    .trim();

  for (let index = 0; index < 3; index += 1) {
    const next = cleaned
      .replace(/\s+(?:\d+(?:\.\d+)?[KMB]?){2,}\s*$/i, "")
      .replace(/(\D)(?:\d+(?:\.\d+)?[KMB]?){2,}\s*$/i, "$1")
      .trim();
    if (next === cleaned) break;
    cleaned = next;
  }

  return cleaned;
}

async function ingest(post: CollectedPost) {
  if (!SECRET) throw new Error("WORKER_INGEST_SECRET is required");
  const response = await fetch(INGEST_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-secret": SECRET
    },
    body: JSON.stringify(post),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ingest failed ${response.status}: ${body}`);
  }
}

async function reportStatus(status: string, message: string, lastSuccessAt?: string) {
  if (!SECRET) return;
  const statusUrl = new URL("/api/collector-status", INGEST_URL).toString();
  await fetch(statusUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-secret": SECRET
    },
    body: JSON.stringify({
      status,
      message,
      lastCheckedAt: new Date().toISOString(),
      lastSuccessAt
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  }).catch(() => undefined);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
