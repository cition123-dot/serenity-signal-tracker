import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const windowHours = Number(searchParams.get("windowHours") || 168);
  const data = await getDashboardData(Number.isFinite(windowHours) ? windowHours : 168);
  return NextResponse.json(data);
}
