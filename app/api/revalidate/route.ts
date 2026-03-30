// app/api/revalidate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-revalidate-secret");
  if (secret !== process.env.REVALIDATE_SECRET) {
    return NextResponse.json({ message: "Invalid secret" }, { status: 401 });
  }

  revalidatePath("/");
  revalidatePath("/teams");
  revalidatePath("/qb-leaderboard");
  revalidatePath("/run-gaps");
  revalidatePath("/receivers");
  revalidatePath("/rushing");
  revalidatePath("/compare");
  revalidatePath("/trends");
  revalidatePath("/player", "layout");
  revalidatePath("/team", "layout");
  revalidatePath("/card", "layout");

  return NextResponse.json({
    revalidated: true,
    timestamp: new Date().toISOString(),
  });
}
