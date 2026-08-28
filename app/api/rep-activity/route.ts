import { NextRequest, NextResponse } from "next/server";
import { getReps, getStores, getTeams, getRoutes, getRoutesForType, getCommissionSettings, getCallCycleTypes } from "@/lib/data";
import { buildRepActivity } from "@/lib/repActivity";
import { requireSession } from "@/lib/auth";
import { getImsSnapshot } from "@/lib/imsSnapshot";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Which plan the "new cycle" columns describe. No parameter means the live
  // plan is the only one loaded and the new-cycle columns stay blank, rather
  // than quietly comparing the current allocation against itself.
  const typeId = request.nextUrl.searchParams.get("typeId");

  const [reps, stores, teams, commission, types, snapshot] = await Promise.all([
    getReps(),
    getStores(),
    getTeams(),
    getCommissionSettings(),
    getCallCycleTypes(),
    getImsSnapshot(),
  ]);

  const newCyclePlan = !typeId
    ? null
    : typeId === "__latest__"
      ? await getRoutes()
      : await getRoutesForType(typeId);

  const rows = buildRepActivity({
    reps,
    stores,
    teams,
    imsRows: snapshot?.rows ?? {},
    imsGhosts: snapshot?.ghosts ?? [],
    commission,
    newCyclePlan,
  });

  return NextResponse.json({
    rows,
    commission,
    // The snapshot is a point in time, so every reader shows its age.
    snapshotFetchedAt: snapshot?.fetchedAt ?? null,
    hasSnapshot: !!snapshot && Object.keys(snapshot.rows).length > 0,
    callCycleTypes: types.map((t) => ({ id: t.id, name: t.name, active: t.active })),
    newCycle: newCyclePlan
      ? {
          typeId,
          name: newCyclePlan.callCycleTypeName || "Latest Routes",
          generatedAt: newCyclePlan.generatedAt,
          repCount: newCyclePlan.repPlans.length,
        }
      : null,
  });
}
