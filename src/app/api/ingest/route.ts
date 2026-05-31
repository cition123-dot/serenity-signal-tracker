import { NextResponse } from "next/server";
import { ingestPost } from "@/lib/ingest";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = request.headers.get("x-worker-secret");
  if (!process.env.WORKER_INGEST_SECRET || secret !== process.env.WORKER_INGEST_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (!body?.xPostId || !body?.url || !body?.body || !body?.postedAt) {
      return NextResponse.json({ error: "Missing xPostId, url, body, or postedAt" }, { status: 400 });
    }

    const result = await ingestPost({
      xPostId: String(body.xPostId),
      url: String(body.url),
      body: String(body.body),
      postedAt: new Date(body.postedAt).toISOString()
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ingest error";
    console.error("[ingest] failed", error);
    return NextResponse.json({ error: "Ingest failed", message }, { status: 500 });
  }
}
