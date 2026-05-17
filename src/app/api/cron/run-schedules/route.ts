import { NextResponse, type NextRequest } from "next/server";
import { runDueSchedules } from "@/services/schedule-service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const secret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || request.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await runDueSchedules());
}
