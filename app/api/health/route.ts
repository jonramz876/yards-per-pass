// app/api/health/route.ts
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

// Always read the database. Without this Next treats GET as static and its Supabase read as cache-forever (it reported Sep 10 data on Sep 25).
// `dynamic = "force-dynamic"` alone is not enough in Next 14: the read would still come from the fetch cache.
export const revalidate = 0;

export async function GET() {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("data_freshness")
    .select("*")
    .order("season", { ascending: false });

  if (error) {
    return NextResponse.json(
      { status: "error", message: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    status: "ok",
    freshness: data,
    timestamp: new Date().toISOString(),
  });
}
