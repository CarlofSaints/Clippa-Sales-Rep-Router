import { NextResponse } from "next/server";
import { getRoutes } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { resolveOwnRep } from "@/lib/ownRep";
import { parseLatLng } from "@/lib/latlng";

/**
 * The signed-in rep's OWN route, and nothing else.
 *
 * 🔴 Reps are not let into /routes or /map: the APIs behind those hand back
 * every rep's route book, every store's sales and the generate/delete actions
 * to any valid session. This route is the narrow door instead. The rep is
 * resolved from the session on the server, never from a query or body, so
 * there is no parameter a rep could change to read somebody else's week.
 *
 * Only the fields the page draws leave the server: stop names, positions and
 * times. No sales, no ranks, no other rep.
 */
export async function GET() {
  try {
    const session = await requireSession();
    const rep = await resolveOwnRep(session);
    if (!rep) return NextResponse.json({ rep: null, plan: null });

    const doc = await getRoutes();
    const code = (rep.code || "").trim().toLowerCase();
    const plan = doc?.repPlans.find((p) => (p.repCode || "").trim().toLowerCase() === code) ?? null;

    // The home the rep has NOW, which can differ from the one the plan was
    // built on. The page says so rather than quietly drawing the old anchor.
    const currentHome = parseLatLng(rep.homeGpsLat, rep.homeGpsLng);

    return NextResponse.json({
      rep: { code: rep.code, name: rep.name, hasHome: !!currentHome },
      generatedAt: doc?.generatedAt ?? null,
      plan: plan && {
        homeLatLng: plan.homeLatLng,
        workingHoursPerDay: plan.workingHoursPerDay,
        startTime: doc?.config.defaultStartTime ?? null,
        days: plan.days.map((d) => ({
          week: d.week,
          day: d.day,
          stops: d.stops.map((s) => ({
            storeId: s.storeId,
            storeName: s.storeName,
            lat: s.lat,
            lng: s.lng,
            visitDuration: s.visitDuration,
            travelTimeFromPrev: s.travelTimeFromPrev,
            distanceFromPrev: s.distanceFromPrev,
            arrivalTime: s.arrivalTime,
            departureTime: s.departureTime,
            sequence: s.sequence,
          })),
          totalTravelTime: d.totalTravelTime,
          totalVisitTime: d.totalVisitTime,
          totalTime: d.totalTime,
          totalDistance: d.totalDistance,
          overCapacity: d.overCapacity,
          returnDistanceKm: d.returnDistanceKm,
          returnTravelTime: d.returnTravelTime,
          arriveHomeTime: d.arriveHomeTime,
          polyline: d.polyline,
        })),
      },
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
