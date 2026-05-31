import { neon } from "@neondatabase/serverless";
import { fetchResolvedQuote } from "@/lib/finnhub";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return Response.json({ ok: false, message: "DATABASE_URL not configured" });
  }

  const db = neon(databaseUrl);

  await db`
    delete from alerts
    where acknowledged_at is not null
      and acknowledged_at < now() - interval '7 days'
  `;
  await db`
    insert into collector_status (id, status, message, updated_at)
    values (1, 'unknown', 'Maintenance checked site health; collector has not reported yet.', now())
    on conflict (id) do nothing
  `;

  let refreshedQuotes = 0;
  if (process.env.FINNHUB_API_KEY) {
    const profiles = await db`
      select ticker, company_name, quote_symbol
      from stock_profiles
      where watch_state <> 'ignored'
      order by last_mentioned_at desc nulls last
      limit 30
    `;

    for (const profile of profiles) {
      const quote = await fetchResolvedQuote(profile.ticker, profile.company_name, profile.quote_symbol);
      if (!quote.price) continue;
      await db`
        update stock_profiles
        set quote_symbol = ${quote.symbol}, quote_exchange = ${quote.exchange}, updated_at = now()
        where ticker = ${profile.ticker}
      `;
      await db`
        insert into price_snapshots (ticker, price, change, percent_change, market_time)
        values (${profile.ticker}, ${quote.price}, ${quote.change}, ${quote.percentChange}, ${quote.marketTime})
      `;
      refreshedQuotes += 1;
    }
  }

  return Response.json({ ok: true, refreshedQuotes });
}
