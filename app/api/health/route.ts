// app/api/health/route.ts
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { summarizeUpstreamError } from "@/lib/data/utils";

// Always read the database. Without this Next treats GET as static and its Supabase read as cache-forever (it reported Sep 10 data on Sep 25).
// `dynamic = "force-dynamic"` alone is not enough in Next 14: the read would still come from the fetch cache.
export const revalidate = 0;

// A failed read is 503 (the database is unavailable; ask again later), never
// stored by anything in between (read resilience spec §1.2). The data refresh
// workflow will use this status to decide whether to clear the site's cache.
function unavailable(message: string) {
  return NextResponse.json(
    { status: "error", message },
    { status: 503, headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET() {
  let data: unknown;
  try {
    const supabase = createServerClient();
    const result = await supabase
      .from("data_freshness")
      .select("*")
      .order("season", { ascending: false });
    // summarizeUpstreamError: always a string (an error with no message shows
    // its code and details), never the upstream's HTML error page, never more
    // than about 300 characters. This body goes to whoever asks.
    if (result.error) return unavailable(summarizeUpstreamError(result.error, result.status));
    data = result.data;
  } catch (err) {
    // createServerClient throws on missing env vars; a rejected read lands here too.
    return unavailable(summarizeUpstreamError(typeof err === "string" ? { message: err } : err));
  }

  return NextResponse.json({
    status: "ok",
    freshness: data,
    timestamp: new Date().toISOString(),
  });
}
