import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = sql();
  await db`update alerts set acknowledged_at = now() where id = ${id}`;
  return NextResponse.json({ ok: true });
}
