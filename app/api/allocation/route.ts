import { NextRequest, NextResponse } from "next/server";
import { getStores, saveStores, getReps, getAllocationSettings, saveAllocationSettings } from "@/lib/data";
import { getImsSnapshot } from "@/lib/imsSnapshot";
import { planImsAllocation, canonicalRepCode, DEFAULT_ALLOCATION, type AllocationSettings } from "@/lib/allocationSource";
import { requireAdmin, getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";

export const maxDuration = 60;

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [settings, stores, reps, snapshot] = await Promise.all([
    getAllocationSettings(),
    getStores(),
    getReps(),
    getImsSnapshot(),
  ]);

  if (!snapshot) {
    return NextResponse.json({
      settings,
      plan: null,
      error: "No IMS snapshot has been built yet. Press Refresh snapshot first.",
    });
  }

  // ⚠️ The snapshot is a point in time. If stores have been added or removed
  // since it was taken, the plan is computed against a stale picture and the
  // page must say so rather than quietly planning from old data.
  const stale = snapshot.totals.appStores !== stores.length;

  const plan = planImsAllocation(stores, reps, snapshot.rows, settings);
  return NextResponse.json({
    settings,
    plan: {
      ...plan,
      // The full lists can run to hundreds of rows; the page shows a sample and
      // the counts are exact.
      moves: plan.moves.slice(0, 300),
      held: plan.held.slice(0, 300),
      moveCount: plan.moves.length,
      heldCount: plan.held.length,
    },
    snapshot: {
      fetchedAt: snapshot.fetchedAt,
      appStoresAtBuild: snapshot.totals.appStores,
      appStoresNow: stores.length,
      stale,
    },
  });
}

/** Change the setting, and optionally apply the re-assignment in the same press. */
export async function PUT(request: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const apply = body.apply === true;
  const session = await getSession();
  const previous = await getAllocationSettings();

  const next: AllocationSettings = {
    ...DEFAULT_ALLOCATION,
    ...previous,
    source: body.source === "ims" ? "ims" : "repsly",
    allowUnknownReps: body.allowUnknownReps === true,
    updatedAt: new Date().toISOString(),
    updatedBy: session?.name || session?.email || "Unknown",
  };
  await saveAllocationSettings(next);

  logActivity({
    action: "Changed store allocation source",
    actor: session?.email || "unknown",
    actorName: session?.name || "Unknown",
    summary: `Allocation source: ${previous.source} changed to ${next.source}${next.allowUnknownReps ? ", unknown rep codes allowed" : ""}`,
  });

  if (!apply) return NextResponse.json({ settings: next, applied: 0 });

  if (next.source !== "ims") {
    return NextResponse.json(
      { error: "Re-assigning only makes sense with IMS as the source." },
      { status: 400 }
    );
  }

  const [stores, reps, snapshot] = await Promise.all([getStores(), getReps(), getImsSnapshot()]);
  if (!snapshot) {
    return NextResponse.json({ error: "No IMS snapshot to apply from." }, { status: 400 });
  }

  const plan = planImsAllocation(stores, reps, snapshot.rows, next);
  const byId = new Map(stores.map((s) => [s.id, s]));
  for (const m of plan.moves) {
    const store = byId.get(m.storeId);
    if (store) store.repCode = m.to;
  }
  await saveStores(stores);

  logActivity({
    action: "Re-assigned stores from IMS",
    actor: session?.email || "unknown",
    actorName: session?.name || "Unknown",
    summary: `Re-assigned ${plan.moves.length} stores to their IMS rep${plan.held.length ? `, held back ${plan.held.length} whose IMS rep code has no rep record` : ""}`,
    // The moves themselves, so the change is reversible by inspection rather
    // than only by a backup nobody took.
    details: plan.moves.slice(0, 400).map((m) => `${m.placeId}: ${m.from || "(none)"} -> ${m.to}`).join("; "),
  });

  return NextResponse.json({
    settings: next,
    applied: plan.moves.length,
    held: plan.held.length,
    unknownCodes: plan.unknownCodes,
  });
}
