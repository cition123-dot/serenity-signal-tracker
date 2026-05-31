import { launch, type BrowserWorker, type BrowserContext, type Page } from "@cloudflare/playwright";

type Env = {
  BROWSER: BrowserWorker;
  INGEST_URL: string;
  WORKER_INGEST_SECRET: string;
  X_AUTH_TOKEN?: string;
  X_CT0?: string;
  X_COOKIES_JSON?: string;
  MAX_SCROLLS?: string;
};

type CollectedPost = {
  xPostId: string;
  url: string;
  body: string;
  postedAt: string;
};

const TARGET_HANDLE = "aleabitoreddit";
const TARGET_URL = `https://x.com/${TARGET_HANDLE}`;

export default {
  async fetch(_request: Request, env: Env) {
    const result = await collectAndIngest(env, "manual");
    return Response.json(result);
  },

  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    ctx.waitUntil(collectAndIngest(env, "cron"));
  }
};

async function collectAndIngest(env: Env, label: "cron" | "manual") {
  const startedAt = new Date().toISOString();
  const maxScrolls = Number(env.MAX_SCROLLS || 2);
  const browser = await launch(env.BROWSER, { keep_alive: 60_000 });

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    });
    await seedXCookies(context, env);
    const page = await context.newPage();
    const posts = await collectPosts(page, maxScrolls);

    let ingested = 0;
    let failed = 0;
    for (const post of posts) {
      try {
        await ingest(env, post);
        ingested += 1;
      } catch (error) {
        failed += 1;
        console.error("[cf-collector] ingest failed", {
          xPostId: post.xPostId,
          message: error instanceof Error ? error.message : "unknown"
        });
      }
    }

    const status = failed > 0 ? "degraded" : "healthy";
    const message = `${label}: collected ${posts.length} posts, ingested ${ingested}, failed ${failed}`;
    await reportStatus(env, status, message, ingested > 0 ? new Date().toISOString() : undefined);
    return { ok: true, startedAt, message, posts: posts.length, ingested, failed };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown collector error";
    const status = message.includes("login appears to be required") ? "login_required" : "degraded";
    await reportStatus(env, status, message);
    console.error("[cf-collector] failed", error);
    return { ok: false, startedAt, message };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function collectPosts(page: Page, maxScrolls: number): Promise<CollectedPost[]> {
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(5000);

  const loginLink = page.getByText(/log in|sign in/i).first();
  if (await loginLink.isVisible().catch(() => false)) {
    throw new Error("X login appears to be required. Refresh Cloudflare collector X cookies.");
  }

  const collected = new Map<string, CollectedPost>();
  for (let scroll = 0; scroll <= maxScrolls; scroll += 1) {
    await expandVisibleArticles(page);
    const articles = await readVisibleArticles(page);
    for (const item of articles) {
      if (!item.link || !item.time || !item.text) continue;
      const postedAt = new Date(item.time);
      if (Number.isNaN(postedAt.getTime())) continue;

      const statusId = item.link.match(/status\/(\d+)/)?.[1] || item.link;
      if (collected.has(statusId)) continue;
      collected.set(statusId, {
        xPostId: statusId,
        url: new URL(item.link, "https://x.com").toString(),
        body: cleanPostText(item.text),
        postedAt: postedAt.toISOString()
      });
    }

    if (scroll === maxScrolls) break;
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(1600);
  }

  const posts = Array.from(collected.values()).sort(
    (a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime()
  );
  return hydrateFullPostBodies(page, posts.slice(0, 12));
}

async function hydrateFullPostBodies(page: Page, posts: CollectedPost[]): Promise<CollectedPost[]> {
  const detailPage = await page.context().newPage();
  const hydrated: CollectedPost[] = [];

  for (const post of posts) {
    try {
      const fullText = await readFullPostFromDetail(detailPage, post.url);
      hydrated.push({ ...post, body: fullText && fullText.length > post.body.length ? fullText : post.body });
    } catch (error) {
      console.warn("[cf-collector] detail read failed", {
        xPostId: post.xPostId,
        message: error instanceof Error ? error.message : "unknown"
      });
      hydrated.push(post);
    }
  }

  await detailPage.close().catch(() => undefined);
  return hydrated;
}

async function readFullPostFromDetail(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);

  const article = page.locator("article").first();
  if (!(await article.isVisible({ timeout: 15000 }).catch(() => false))) return "";

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
  return page.locator("article").evaluateAll((nodes) =>
    nodes.map((node) => {
      const textNode = node.querySelector("[data-testid='tweetText']");
      const text = (textNode?.textContent || node.textContent || "").trim();
      const timeNode = node.querySelector("time");
      const time = timeNode?.getAttribute("datetime");
      const link = timeNode?.closest("a")?.getAttribute("href");
      return { text, link, time };
    })
  );
}

async function seedXCookies(context: BrowserContext, env: Env) {
  if (env.X_COOKIES_JSON) {
    await context.addCookies(JSON.parse(env.X_COOKIES_JSON));
    return;
  }

  if (!env.X_AUTH_TOKEN || !env.X_CT0) return;

  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 120;
  await context.addCookies(
    [".x.com", ".twitter.com"].flatMap((domain) => [
      {
        name: "auth_token",
        value: env.X_AUTH_TOKEN || "",
        domain,
        path: "/",
        expires,
        httpOnly: true,
        secure: true,
        sameSite: "Lax" as const
      },
      {
        name: "ct0",
        value: env.X_CT0 || "",
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

async function ingest(env: Env, post: CollectedPost) {
  if (!env.WORKER_INGEST_SECRET) throw new Error("WORKER_INGEST_SECRET is required");
  const response = await fetch(env.INGEST_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-secret": env.WORKER_INGEST_SECRET
    },
    body: JSON.stringify(post)
  });

  if (!response.ok) {
    throw new Error(`Ingest failed ${response.status}: ${await response.text()}`);
  }
}

async function reportStatus(env: Env, status: string, message: string, lastSuccessAt?: string) {
  if (!env.WORKER_INGEST_SECRET || !env.INGEST_URL) return;
  const statusUrl = new URL("/api/collector-status", env.INGEST_URL).toString();
  await fetch(statusUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-secret": env.WORKER_INGEST_SECRET
    },
    body: JSON.stringify({
      status,
      message,
      lastCheckedAt: new Date().toISOString(),
      lastSuccessAt
    })
  }).catch(() => undefined);
}
