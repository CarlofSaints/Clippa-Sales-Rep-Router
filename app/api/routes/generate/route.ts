import { NextRequest, NextResponse } from "next/server";
import { getReps, getStores, saveRoutes, saveRoutesForType, getRoutes, getRoutesForType, getCallCycleTypes, getSettings, getChannels, getStoreOverrides, getSubChannels } from "@/lib/data";
import { RoutePlanDocument, RepRoutePlan, Store, Rep } from "@/lib/types";
import { generateRepRoute } from "@/lib/route-engine";
import { hasGoogleMapsKey } from "@/lib/google-maps";
import { getSession, sessionHasPermission } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { routableStores } from "@/lib/routable";
import { countRoadRouting } from "@/lib/roadRouting";

/** Only the two counted facts are stored; the rest of the summary is derived. */
const storedRoadRouting = (plans: RepRoutePlan[]) => {
  const { eligibleDays, roadRoutedDays } = countRoadRouting(plans);
  return { eligibleDays, roadRoutedDays };
};

// 300s, the Vercel Pro default ceiling (the plan maximum is 800). A generation
// is almost entirely waiting on Google, and Fluid compute pauses active-CPU
// billing during I/O, so the headroom is close to free. The old 120 was the
// hard stop that truncated every bulk run.
export const maxDuration = 300;

function getStoresForRep(
  rep: Rep,
  routable: Store[],
  strategy: string | null
): Store[] {
  // A rep's stores are the stores allocated to them (repCode). This is the
  // source of truth for "which stores does this rep call on". The route engine
  // then clusters them geographically and optimises the daily order.
  //
  // The list arrives already filtered by lib/routable: shut shops are out, and
  // so are channels nobody calls on, less any single store a manager has
  // excused with an approved Call Override. Filtered ONCE for all reps rather
  // than per rep, because it walks every store and every channel.
  const allocated = routable.filter((s) => s.repCode === rep.code);

  // Channel Dedicated additionally narrows the allocation to the rep's channels.
  if (strategy === "channel_dedicated" && rep.assignedChannels?.length) {
    return allocated.filter((s) => rep.assignedChannels!.includes(s.channelId));
  }

  // Geography / default: the rep calls on every store allocated to them.
  return allocated;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const repCodes: string[] | undefined = body.repCodes;

    const [allReps, allStores, callCycleTypes, settings, channels, overrides, subChannels] = await Promise.all([
      getReps(),
      getStores(),
      getCallCycleTypes(),
      getSettings(),
      getChannels(),
      getStoreOverrides(),
      getSubChannels(),
    ]);
    const routable = routableStores({ stores: allStores, channels, overrides, subChannels });
    const outlierRadiusKm = settings.outlierRadiusKm;

    // How many calls a day this run should aim for.
    //
    // The body wins over the saved setting so the Routes page can preview a
    // number BEFORE anyone commits to it: the manager drags it to 8, one rep is
    // rebuilt at 8, and the setting is only written when they apply it to
    // everybody. Sending `null` explicitly asks for no target at all, which is
    // different from sending nothing and inheriting the saved one.
    const callsPerDay =
      body.callsPerDay === null
        ? undefined
        : body.callsPerDay !== undefined
          ? clampCallsPerDay(body.callsPerDay)
          : settings.callsPerDay;

    // Determine strategy: prefer explicit typeId from request, fall back to globally active type
    const resolvedType = body.typeId
      ? callCycleTypes.find((t) => t.id === body.typeId)
      : callCycleTypes.find((t) => t.active);
    const activeType = resolvedType;
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

    /**
     * Budget for Google Directions calls — now a SAFETY VALVE, not a cap.
     *
     * With the calls running six at a time a full 705-day book takes roughly
     * 30 seconds, so this should never be reached. It stays because the
     * fallback is silent: when the budget runs out the engine draws straight
     * lines and says nothing, and that is how 29 of 37 reps ended up with
     * understated distances for weeks. A valve that never trips is the point.
     *
     * 240s inside a 300s function leaves a minute to assemble and save the
     * document even in the worst case.
     */
    const googleDeadline = Date.now() + 240_000;

    for (const rep of reps) {
      // Get stores for this rep based on active strategy
      const repStores = getStoresForRep(rep, routable, strategy);
      if (repStores.length === 0) {
        repPlans.push({
          repCode: rep.code,
          repName: rep.name,
          homeLatLng: parseHome(rep),
          workingHoursPerDay: rep.workingHoursPerDay ?? 8.5,
          // A rep with no stores still carries the target, so the Map dropdown
          // does not show a blank beside them and read as "not set".
          callsPerDay: callsPerDay && callsPerDay > 0 ? callsPerDay : undefined,
          generatedAt: new Date().toISOString(),
          days: [],
          stats: { totalStores: 0, unassignedStores: [] },
        });
        continue;
      }

      const plan = await generateRepRoute(
        rep,
        repStores,
        startTime,
        googleDeadline,
        outlierRadiusKm,
        callsPerDay
      );
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
        // Stamped on the plan, so a page can say what THIS week was built with
        // rather than reading a setting that may have moved since.
        callsPerDay,
      },
      roadRouting: storedRoadRouting(repPlans),
    };

    // 🔴 A run for SOME reps must not replace the plan for all of them.
    //
    // Previewing one rep at a new calls-per-day writes a document holding that
    // one rep. Saving it as-is would delete the other 63 reps' weeks, and the
    // only sign would be an almost-empty Routes page. So a partial run merges
    // its reps into the plan already saved, and only a full run replaces it.
    if (repCodes && repCodes.length > 0) {
      const existing = activeType ? await getRoutesForType(activeType.id) : await getRoutes();
      if (existing) {
        const touched = new Set(repPlans.map((p) => p.repCode));
        doc.repPlans = [
          ...existing.repPlans.filter((p) => !touched.has(p.repCode)),
          ...repPlans,
        ];
        // The document still describes the plan as a whole, and most of it was
        // built with the OLD target. Claiming the new one would misdescribe 63
        // of the 64 weeks in it.
        doc.config.callsPerDay = existing.config?.callsPerDay;
        doc.generatedAt = existing.generatedAt;
        // Recounted over the MERGED set. Counting only this run's reps would
        // report "20 of 20 road-routed" on a document whose other 63 weeks are
        // straight lines — the reassuring version of the exact problem this
        // field exists to expose.
        doc.roadRouting = storedRoadRouting(doc.repPlans);
      }
    }

    // Save per-type (if active type exists) + latest snapshot
    if (activeType) {
      await saveRoutesForType(activeType.id, doc);
    }
    await saveRoutes(doc);

    const session = await getSession();
    logActivity({
      action: "Generated routes",
      actor: session?.email || "unknown",
      actorName: session?.name || "Unknown",
      summary:
        `Generated routes for ${repPlans.length} rep${repPlans.length === 1 ? "" : "s"}` +
        (activeType ? ` (${activeType.name})` : "") +
        (callsPerDay ? ` at ${callsPerDay} calls per day` : ""),
    });

    return NextResponse.json(doc);
  } catch (err) {
    console.error("Route generation failed:", err);
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}

/**
 * A calls-per-day value we are willing to act on.
 *
 * Anything unusable becomes undefined, which means "no target" and returns day
 * sizing to the clock. It does NOT fall back to a number: a typo silently
 * becoming 8 would redraw every rep's week and look like the app decided on its
 * own.
 */
function clampCallsPerDay(raw: unknown): number | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.min(Math.round(n), 30);
}

function parseHome(rep: { homeGpsLat: string; homeGpsLng: string }) {
  const lat = parseFloat(rep.homeGpsLat);
  const lng = parseFloat(rep.homeGpsLng);
  return !isNaN(lat) && !isNaN(lng) ? { lat, lng } : null;
}
