import { sql } from "./db";
import { analyzePost } from "./openai";
import { fetchResolvedQuote } from "./finnhub";
import { needsChineseTranslation, translateToChinese } from "./translate";
import { signalFromMention } from "./domain.mjs";

export type IngestPostInput = {
  xPostId: string;
  url: string;
  body: string;
  postedAt: string;
};

export async function ingestPost(input: IngestPostInput) {
  const db = sql();
  await ensureTranslationSchema(db);
  const cleanBody = cleanPostText(input.body);
  const analysis = await analyzePost(cleanBody);
  const translationItems = [
    { id: "post:body", text: cleanBody },
    { id: "post:summary", text: analysis.summary },
    ...analysis.mentionedStocks.flatMap((mention) => [
      ...mention.reasons.map((text, index) => ({ id: `stock:${mention.ticker}:reason:${index}`, text })),
      ...mention.risks.map((text, index) => ({ id: `stock:${mention.ticker}:risk:${index}`, text }))
    ])
  ];
  const translations = await translateToChinese(translationItems);
  const bodyZh = cachedChinese(translations, "post:body", cleanBody);
  const summaryZh = cachedChinese(translations, "post:summary", analysis.summary);

  const [post] = await db`
    insert into posts (x_post_id, url, body, body_zh, posted_at, summary, summary_zh, analysis, processed_at)
    values (
      ${input.xPostId}, ${input.url}, ${cleanBody}, ${bodyZh}, ${input.postedAt},
      ${analysis.summary}, ${summaryZh}, ${JSON.stringify(analysis)}, now()
    )
    on conflict (x_post_id) do update set
      body = excluded.body,
      body_zh = coalesce(excluded.body_zh, posts.body_zh),
      summary = excluded.summary,
      summary_zh = coalesce(excluded.summary_zh, posts.summary_zh),
      analysis = excluded.analysis,
      processed_at = now()
    returning id, posted_at
  `;

  for (const mention of analysis.mentionedStocks) {
    const ticker = mention.ticker.toUpperCase();
    const signal = signalFromMention(mention);
    const reasonsZh = mention.reasons.map((text, index) => cachedChinese(translations, `stock:${mention.ticker}:reason:${index}`, text) || text);
    const risksZh = mention.risks.map((text, index) => cachedChinese(translations, `stock:${mention.ticker}:risk:${index}`, text) || text);

    await db`
      insert into stock_mentions (
        post_id, ticker, company_name, stance, confidence, reasons, risks,
        time_sensitivity, action_signal, mentioned_at
      )
      values (
        ${post.id}, ${ticker}, ${mention.companyName || null}, ${mention.stance}, ${mention.confidence},
        ${mention.reasons}, ${mention.risks}, ${mention.timeSensitivity}, ${mention.actionSignal}, ${post.posted_at}
      )
      on conflict (post_id, ticker) do update set
        stance = excluded.stance,
        confidence = excluded.confidence,
        reasons = excluded.reasons,
        risks = excluded.risks,
        time_sensitivity = excluded.time_sensitivity,
        action_signal = excluded.action_signal
    `;

    await db`
      insert into stock_profiles (
        ticker, company_name, thesis, thesis_zh, advantages, advantages_zh, risks, risks_zh, signal_strength,
        last_mentioned_at, total_mention_count, updated_at
      )
      values (
        ${ticker}, ${mention.companyName || null}, ${analysis.summary}, ${summaryZh},
        ${mention.reasons}, ${reasonsZh}, ${mention.risks}, ${risksZh},
        ${signal}, ${post.posted_at}, 1, now()
      )
      on conflict (ticker) do update set
        company_name = coalesce(stock_profiles.company_name, excluded.company_name),
        thesis = excluded.thesis,
        thesis_zh = coalesce(excluded.thesis_zh, stock_profiles.thesis_zh),
        advantages = (
          select array(select distinct unnest(stock_profiles.advantages || excluded.advantages) limit 8)
        ),
        advantages_zh = case
          when coalesce(array_length(excluded.advantages_zh, 1), 0) > 0 then (
            select array(select distinct unnest(stock_profiles.advantages_zh || excluded.advantages_zh) limit 8)
          )
          else stock_profiles.advantages_zh
        end,
        risks = (
          select array(select distinct unnest(stock_profiles.risks || excluded.risks) limit 8)
        ),
        risks_zh = case
          when coalesce(array_length(excluded.risks_zh, 1), 0) > 0 then (
            select array(select distinct unnest(stock_profiles.risks_zh || excluded.risks_zh) limit 8)
          )
          else stock_profiles.risks_zh
        end,
        signal_strength = greatest(stock_profiles.signal_strength, excluded.signal_strength),
        last_mentioned_at = greatest(stock_profiles.last_mentioned_at, excluded.last_mentioned_at),
        total_mention_count = (
          select count(*)::int from stock_mentions where stock_mentions.ticker = excluded.ticker
        ),
        updated_at = now()
    `;

    if (mention.actionSignal === "strong_watch" || signal >= 75) {
      await db`
        insert into alerts (ticker, post_id, severity, title, message)
        values (
          ${ticker}, ${post.id}, 'warning',
          ${`Strong signal: ${ticker}`},
          ${analysis.summary}
        )
      `;
    }

    try {
      const quote = await fetchResolvedQuote(ticker, mention.companyName);
      await db`
        update stock_profiles
        set quote_symbol = ${quote.symbol}, quote_exchange = ${quote.exchange}, updated_at = now()
        where ticker = ${ticker}
      `;
      await db`
        insert into price_snapshots (ticker, price, change, percent_change, market_time)
        values (${ticker}, ${quote.price}, ${quote.change}, ${quote.percentChange}, ${quote.marketTime})
      `;
    } catch {
      // Quote refresh is best-effort during ingest; scheduled maintenance can retry.
    }
  }

  return { postId: post.id, analysis };
}

function cachedChinese(translations: Map<string, string>, id: string, source: string) {
  const text = source.trim();
  if (!text) return "";
  return translations.get(id) || (needsChineseTranslation(text) ? null : text);
}

async function ensureTranslationSchema(db: ReturnType<typeof sql>) {
  await db`alter table posts add column if not exists body_zh text`;
  await db`alter table posts add column if not exists summary_zh text`;
  await db`alter table stock_profiles add column if not exists thesis_zh text`;
  await db`alter table stock_profiles add column if not exists advantages_zh text[] not null default '{}'`;
  await db`alter table stock_profiles add column if not exists risks_zh text[] not null default '{}'`;
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
