import { NextRequest, NextResponse } from "next/server";
import { getReps, getStores, getRoutes, getChannels, getStoreOverrides, getSubChannels } from "@/lib/data";
import { routableStores } from "@/lib/routable";
import { computeCapacity, WORKING_DAYS_PER_MONTH } from "@/lib/capacity";
import { explainCapacity } from "@/lib/capacityExplain";
import { requireSession } from "@/lib/auth";
import { isTeamRole } from "@/lib/roles";

/**
 * GET /api/reps/capacity/explain?repCode=GAU001
 *
 * The reasons behind one rep's capacity figure, for "Tell me why". Built from
 * exactly the inputs the capacity grid uses, so the explanation cannot quote a
 * different number from the row it was opened on.
 *
 * Scoped on the server, not just the page: this returns the rep's home and
 * store list, so a rep sees only themselves and a team role only their team.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    const repCode = (request.nextUrl.searchParams.get("repCode") || "").trim();
    if (!repCode) return NextResponse.json({ error: "repCode is required" }, { status: 400 });

    const [reps, stores, doc, channels, overrides, subChannels] = await Promise.all([
      getReps(),
      getStores(),
      getRoutes(),
      getChannels(),
      getStoreOverrides(),
      getSubChannels(),
    ]);

    const rep = reps.find((r) => r.code === repCode);
    if (!rep) return NextResponse.json({ error: "Rep not found" }, { status: 404 });

    const forbidden =
      (session.role === "rep" && session.repCode !== rep.code) ||
      (isTeamRole(session.role) && (!session.teamId || session.teamId !== rep.teamId));
    if (forbidden) return NextResponse.json({ error: "Rep not found" }, { status: 404 });

    const row = computeCapacity([rep], stores, doc, channels, overrides, subChannels).reps[0];
    // The same allocation computeCapacity makes.
    const allocated = routableStores({ stores, channels, overrides, subChannels }).filter(
      (s) => s.repCode === rep.code
    );
    const plan = doc?.repPlans.find((p) => p.repCode === rep.code) ?? null;

    return NextResponse.json(
      explainCapacity(rep, row, allocated, plan, doc?.generatedAt ?? null, WORKING_DAYS_PER_MONTH)
    );
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Capacity explain error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
