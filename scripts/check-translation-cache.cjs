const { neon } = require("@neondatabase/serverless");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const db = neon(databaseUrl);

(async () => {
  const columns = await db`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and (
        (table_name = 'posts' and column_name in ('body_zh', 'summary_zh'))
        or (table_name = 'stock_profiles' and column_name in ('thesis_zh', 'advantages_zh', 'risks_zh'))
      )
    order by table_name, column_name
  `;

  const posts = await db`
    select
      count(*)::int as total,
      count(*) filter (where body_zh is not null and length(trim(body_zh)) > 0)::int as body_zh_count,
      count(*) filter (where summary_zh is not null and length(trim(summary_zh)) > 0)::int as summary_zh_count,
      max(collected_at) as newest_collected_at,
      max(collected_at) filter (where body_zh is not null and length(trim(body_zh)) > 0) as newest_body_zh_at
    from posts
    where posted_at >= now() - interval '7 days'
  `;

  const latest = await db`
    select
      x_post_id,
      posted_at,
      collected_at,
      body_zh is not null and length(trim(body_zh)) > 0 as has_body_zh,
      summary_zh is not null and length(trim(summary_zh)) > 0 as has_summary_zh,
      left(coalesce(body_zh, ''), 60) as body_zh_preview,
      left(coalesce(summary_zh, ''), 60) as summary_zh_preview
    from posts
    order by collected_at desc
    limit 8
  `;

  const profiles = await db`
    select
      count(*)::int as total,
      count(*) filter (where thesis_zh is not null and length(trim(thesis_zh)) > 0)::int as thesis_zh_count,
      count(*) filter (where coalesce(array_length(advantages_zh, 1), 0) > 0)::int as advantages_zh_count,
      count(*) filter (where coalesce(array_length(risks_zh, 1), 0) > 0)::int as risks_zh_count
    from stock_profiles
    where last_mentioned_at >= now() - interval '7 days'
  `;

  const collector = await db`
    select status, message, last_checked_at, last_success_at, updated_at
    from collector_status
    where id = 1
  `;

  console.log(JSON.stringify({
    columns,
    posts: posts[0],
    latest,
    profiles: profiles[0],
    collector: collector[0] || null
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
