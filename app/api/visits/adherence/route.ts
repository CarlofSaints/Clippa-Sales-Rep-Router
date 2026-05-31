import { NextRequest, NextResponse } from "next/server";
import { getStores, getChannels, getReps, getTeams } from "@/lib/data";
import { getVisits } from "@/lib/visitData";
import { computeAdherence } from "@/lib/adherenceCalc";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    // Default: current month
    const now = new Date();
    const dateFrom = fromParam
      ? new Date(fromParam + "T00:00:00")
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const dateTo = toParam
      ? new Date(toParam + "T23:59:59")
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    // Load all data in parallel
    const [stores, channels, reps, teams, visits] = await Promise.all([
      getStores(),
      getChannels(),
      getReps(),
      getTeams(),
      getVisits(),
    ]);

    const result = computeAdherence(stores, reps, teams, channels, visits, dateFrom, dateTo);

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
