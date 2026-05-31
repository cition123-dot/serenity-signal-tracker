const { neon } = require("@neondatabase/serverless");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const db = neon(databaseUrl);

function cleanPostText(value) {
  if (!value) return value;
  let cleaned = String(value)
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

(async () => {
  const rows = await db`
    select id, body, body_zh, summary, summary_zh
    from posts
    order by collected_at desc
  `;

  let changed = 0;
  for (const row of rows) {
    const body = cleanPostText(row.body);
    const bodyZh = cleanPostText(row.body_zh);
    const summary = cleanPostText(row.summary);
    const summaryZh = cleanPostText(row.summary_zh);

    if (
      body !== row.body ||
      bodyZh !== row.body_zh ||
      summary !== row.summary ||
      summaryZh !== row.summary_zh
    ) {
      await db`
        update posts
        set body = ${body}, body_zh = ${bodyZh}, summary = ${summary}, summary_zh = ${summaryZh}
        where id = ${row.id}
      `;
      changed += 1;
    }
  }

  console.log(`cleaned posts=${changed}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
