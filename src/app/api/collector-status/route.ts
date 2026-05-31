import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = request.headers.get("x-worker-secret");
  if (!process.env.WORKER_INGEST_SECRET || secret !== process.env.WORKER_INGEST_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const status = String(body.status || "unknown");
  const message = String(body.message || "");
  const checkedAt = body.lastCheckedAt ? new Date(body.lastCheckedAt).toISOString() : new Date().toISOString();
  const successAt = body.lastSuccessAt ? new Date(body.lastSuccessAt).toISOString() : null;

  const db = sql();
  await db`
    insert into collector_status (
      id, target_handle, status, message, last_checked_at, last_success_at, updated_at
    )
    values (1, 'aleabitoreddit', ${status}, ${message}, ${checkedAt}, ${successAt}, now())
    on conflict (id) do update set
      status = excluded.status,
      message = excluded.message,
      last_checked_at = excluded.last_checked_at,
      last_success_at = coalesce(excluded.last_success_at, collector_status.last_success_at),
      updated_at = now()
  `;

  return NextResponse.json({ ok: true });
}
