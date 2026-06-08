import { NextRequest, NextResponse } from "next/server";
import { getReps, getStores, saveRoutes, saveRoutesForType, getCallCycleTypes } from "@/lib/data";
import { RoutePlanDocument, RepRoutePlan, Store, Rep } from "@/lib/types";
import { generateRepRoute } from "@/lib/route-engine";
import { hasGoogleMapsKey } from "@/lib/google-maps";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";

export const maxDuration = 120;

function getStoresForRep(
  rep: Rep,
  allStores: Store[],
  strategy: string | null
): Store[] {
  switch (strategy) {
    case "channel_dedicated":
      if (!rep.assignedChannels?.length) return [];
      return allStores.filter((s) => rep.assignedChannels!.includes(s.channelId));

    case "geography":
      if (!rep.assignedZones?.length) return [];
      return allStores.filter((s) => s.zoneId && rep.assignedZones!.includes(s.zoneId));

    case "hybrid":
      if (!rep.assignedChannels?.length || !rep.assignedZones?.length) return [];
      return allStores.filter(
        (s) =>
          rep.assignedChannels!.includes(s.channelId) &&
          s.zoneId &&
          rep.assignedZones!.includes(s.zoneId)
      );

    case "dynamic":
    default:
      // Current behaviour: manual repCode assignment
      return allStores.filter((s) => s.repCode === rep.code);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const repCodes: string[] | undefined = body.repCodes;

    const [allReps, allStores, callCycleTypes] = await Promise.all([
      getReps(),
      getStores(),
      getCallCycleTypes(),
    ]);

    // Determine active strategy
    const activeType = callCycleTypes.find((t) => t.active);
    const strategy = activeType?.strategy || null;

    // Filter reps if specific codes requested
    const reps = repCodes
      ? allReps.filter((r) => repCodes.includes(r.code))
      : allReps;

    if (reps.length === 0) {
      return NextResponse.json(
        { error: "No reps found" },
        { status: 400 }
      );
    }

    const startTime = body.startTime || "08:00";
    const repPlans: RepRoutePlan[] = [];

    for (const rep of reps) {
      // Get stores for this rep based on active strategy
      const repStores = getStoresForRep(rep, allStores, strategy);
      if (repStores.length === 0) {
        repPlans.push({
          repCode: rep.code,
          repName: rep.name,
          homeLatLng: parseHome(rep),
          workingHoursPerDay: rep.workingHoursPerDay ?? 8.5,
          generatedAt: new Date().toISOString(),
          days: [],
          stats: { totalStores: 0, unassignedStores: [] },
        });
        continue;
      }

      const plan = await generateRepRoute(rep, repStores, startTime);
      repPlans.push(plan);
    }

    const doc: RoutePlanDocument = {
      id: crypto.randomUUID(),
      generatedAt: new Date().toISOString(),
      generatedBy: "admin",
      callCycleTypeId: activeType?.id,
      callCycleTypeName: activeType?.name,
      repPlans,
      config: {
        useGoogleMaps: hasGoogleMapsKey(),
        defaultStartTime: startTime,
      },
    };

    // Save per-type (if active type exists) + latest snapshot
    if (activeType) {
      await saveRoutesForType(activeType.id, doc);
    }
    await saveRoutes(doc);

    const session = await getSession();
    logActivity({ action: "Generated routes", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Generated routes for ${repPlans.length} reps${activeType ? ` (${activeType.name})` : ""}` });

    return NextResponse.json(doc);
  } catch (err) {
    console.error("Route generation failed:", err);
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}

function parseHome(rep: { homeGpsLat: string; homeGpsLng: string }) {
  const lat = parseFloat(rep.homeGpsLat);
  const lng = parseFloat(rep.homeGpsLng);
  return !isNaN(lat) && !isNaN(lng) ? { lat, lng } : null;
}
