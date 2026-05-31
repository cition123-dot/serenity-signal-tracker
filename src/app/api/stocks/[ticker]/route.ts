import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const symbol = ticker.toUpperCase();
  const db = sql();
  const [profileRows, mentionRows, priceRows] = await Promise.all([
    db`select * from stock_profiles where ticker = ${symbol}`,
    db`
      select sm.*, p.x_post_id, p.url, p.body, p.summary, p.posted_at
      from stock_mentions sm
      join posts p on p.id = sm.post_id
      where sm.ticker = ${symbol}
      order by sm.mentioned_at desc
      limit 40
    `,
    db`
      select *
      from price_snapshots
      where ticker = ${symbol}
      order by captured_at desc
      limit 120
    `
  ]);

  return NextResponse.json({
    profile: profileRows[0] || null,
    mentions: mentionRows,
    prices: priceRows.reverse()
  });
}
