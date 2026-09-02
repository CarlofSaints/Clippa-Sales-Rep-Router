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
    // The IMS snapshot ENRICHES this page; it does not carry it. Every reader
    // below already handles it being absent, so a failed read must degrade to
    // "no snapshot" rather than take the whole page down with a 500 — which is
    // what it did, because the read throws instead of returning null.
    //
    // Read-only, so nothing downstream writes a decision based on the empty
    // result. The paths that DO write from the snapshot deliberately keep the
    // loud failure, because silently seeing "no snapshot" there would close or
    // re-assign stores off a picture that was never loaded.
    getImsSnapshot().catch(() => null),
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
