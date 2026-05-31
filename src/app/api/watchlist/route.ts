import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { ticker, watchState } = await request.json();
  if (!ticker || !["active", "watchlist", "ignored"].includes(watchState)) {
    return NextResponse.json({ error: "Invalid ticker or watchState" }, { status: 400 });
  }

  const db = sql();
  await db`
    update stock_profiles
    set watch_state = ${watchState}, updated_at = now()
    where ticker = ${String(ticker).toUpperCase()}
  `;
  return NextResponse.json({ ok: true });
}
