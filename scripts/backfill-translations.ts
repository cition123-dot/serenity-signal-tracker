import { neon } from "@neondatabase/serverless";
import { needsChineseTranslation, translateToChinese } from "../src/lib/translate";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const db = neon(databaseUrl);

await db`alter table posts add column if not exists body_zh text`;
await db`alter table posts add column if not exists summary_zh text`;
await db`alter table stock_profiles add column if not exists thesis_zh text`;
await db`alter table stock_profiles add column if not exists advantages_zh text[] not null default '{}'`;
await db`alter table stock_profiles add column if not exists risks_zh text[] not null default '{}'`;

const postRows = await db`
  select id, body, summary, body_zh, summary_zh
  from posts
  where body_zh is null or summary_zh is null
  order by posted_at desc
  limit 80
`;

let postUpdates = 0;
for (const row of postRows) {
  const items = [
    row.body_zh ? null : { id: `post:${row.id}:body`, text: String(row.body || "") },
    row.summary_zh ? null : { id: `post:${row.id}:summary`, text: String(row.summary || "") }
  ].filter((item): item is { id: string; text: string } => Boolean(item?.text));

  const translations = await translateToChinese(items);
  const bodyZh = row.body_zh || cachedChinese(translations, `post:${row.id}:body`, String(row.body || ""));
  const summaryZh = row.summary_zh || cachedChinese(translations, `post:${row.id}:summary`, String(row.summary || ""));

  await db`
    update posts
    set body_zh = ${bodyZh}, summary_zh = ${summaryZh}
    where id = ${row.id}
  `;
  postUpdates += 1;
}

const profileRows = await db`
  select ticker, thesis, thesis_zh, advantages, advantages_zh, risks, risks_zh
  from stock_profiles
  where thesis_zh is null
     or coalesce(array_length(advantages_zh, 1), 0) < coalesce(array_length(advantages, 1), 0)
     or coalesce(array_length(risks_zh, 1), 0) < coalesce(array_length(risks, 1), 0)
  order by last_mentioned_at desc nulls last
  limit 80
`;

let profileUpdates = 0;
for (const row of profileRows) {
  const advantages = arrayOfStrings(row.advantages);
  const advantagesZhExisting = arrayOfStrings(row.advantages_zh);
  const risks = arrayOfStrings(row.risks);
  const risksZhExisting = arrayOfStrings(row.risks_zh);
  const items = [
    row.thesis_zh ? null : { id: `stock:${row.ticker}:thesis`, text: String(row.thesis || "") },
    ...advantages.flatMap((text, index) =>
      advantagesZhExisting[index] ? [] : [{ id: `stock:${row.ticker}:advantage:${index}`, text }]
    ),
    ...risks.flatMap((text, index) =>
      risksZhExisting[index] ? [] : [{ id: `stock:${row.ticker}:risk:${index}`, text }]
    )
  ].filter((item): item is { id: string; text: string } => Boolean(item?.text));

  const translations = await translateToChinese(items);
  const thesisZh = row.thesis_zh || cachedChinese(translations, `stock:${row.ticker}:thesis`, String(row.thesis || ""));
  const advantagesZh = advantages.map((text, index) =>
    advantagesZhExisting[index] || cachedChinese(translations, `stock:${row.ticker}:advantage:${index}`, text) || text
  );
  const risksZh = risks.map((text, index) =>
    risksZhExisting[index] || cachedChinese(translations, `stock:${row.ticker}:risk:${index}`, text) || text
  );

  await db`
    update stock_profiles
    set thesis_zh = ${thesisZh}, advantages_zh = ${advantagesZh}, risks_zh = ${risksZh}, updated_at = now()
    where ticker = ${row.ticker}
  `;
  profileUpdates += 1;
}

console.log(`backfilled posts=${postUpdates} profiles=${profileUpdates}`);

function cachedChinese(translations: Map<string, string>, id: string, source: string) {
  const text = source.trim();
  if (!text) return "";
  return translations.get(id) || (needsChineseTranslation(text) ? null : text);
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
