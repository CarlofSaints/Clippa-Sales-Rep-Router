import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getRepslyVisits } from "@/lib/repslyData";

// GET — return visits, optionally filtered by date range
// Query params: from (YYYY-MM-DD), to (YYYY-MM-DD)
export async function GET(request: NextRequest) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let visits = await getRepslyVisits();

  if (from) visits = visits.filter((v) => v.date >= from);
  if (to) visits = visits.filter((v) => v.date <= to);

  return NextResponse.json(visits);
}
