import { NextRequest, NextResponse } from "next/server";
import { getReps, getStores, saveRoutes } from "@/lib/data";
import { RoutePlanDocument, RepRoutePlan } from "@/lib/types";
import { generateRepRoute } from "@/lib/route-engine";
import { hasGoogleMapsKey } from "@/lib/google-maps";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const repCodes: string[] | undefined = body.repCodes;

    const allReps = await getReps();
    const allStores = await getStores();

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
      // Get stores assigned to this rep
      const repStores = allStores.filter((s) => s.repCode === rep.code);
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
      repPlans,
      config: {
        useGoogleMaps: hasGoogleMapsKey(),
        defaultStartTime: startTime,
      },
    };

    await saveRoutes(doc);

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
