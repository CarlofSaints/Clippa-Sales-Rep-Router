import { NextResponse } from "next/server";
import { getReps, getStores } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { buildCoverageReport } from "@/lib/coverage";

export async function GET() {
  try {
    await requireSession();
    const [reps, stores] = await Promise.all([getReps(), getStores()]);
    return NextResponse.json(buildCoverageReport(reps, stores));
  } catch (err) {
    const msg = String(err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
