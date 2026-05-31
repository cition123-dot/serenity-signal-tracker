import { neon } from "@neondatabase/serverless";
import { fetchResolvedQuote } from "../src/lib/finnhub";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const db = neon(databaseUrl);
const rows = await db`
  select ticker, company_name, quote_symbol
  from stock_profiles
  where watch_state <> 'ignored'
  order by last_mentioned_at desc nulls last
  limit 40
`;

let updated = 0;

for (const row of rows) {
  try {
    const quote = await fetchResolvedQuote(row.ticker, row.company_name, row.quote_symbol);
    if (!quote.price) continue;

    await db`
      update stock_profiles
      set quote_symbol = ${quote.symbol}, quote_exchange = ${quote.exchange}, updated_at = now()
      where ticker = ${row.ticker}
    `;
    await db`
      insert into price_snapshots (ticker, price, change, percent_change, market_time)
      values (${row.ticker}, ${quote.price}, ${quote.change}, ${quote.percentChange}, ${quote.marketTime})
    `;
    updated += 1;
    console.log(`${row.ticker} => ${quote.symbol} ${quote.price}`);
  } catch {
    console.log(`${row.ticker} skipped`);
  }
}

console.log(`updated ${updated}`);
