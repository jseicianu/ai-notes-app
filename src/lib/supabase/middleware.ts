import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  // Passthrough mode — skip auth to diagnose 404
  return NextResponse.next({ request });
}
