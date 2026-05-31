import { NextRequest, NextResponse } from "next/server";
import { getStores, saveStores } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { hasGoogleMapsKey, reverseGeocodeRegion } from "@/lib/google-maps";

export const maxDuration = 60;

const BATCH_SIZE = 40;

export async function POST(request: NextRequest) {
  try {
    await requireSession();

    if (!hasGoogleMapsKey()) {
      return NextResponse.json(
        { error: "GOOGLE_MAPS_API_KEY not configured" },
        { status: 400 }
      );
    }

    const stores = await getStores();

    // Optional channel filter
    const channelsParam = request.nextUrl.searchParams.get("channels");
    const channelFilter = channelsParam
      ? new Set(channelsParam.split(",").map((c) => c.trim()).filter(Boolean))
      : null;

    const scoped = channelFilter
      ? stores.filter((s) => channelFilter.has(s.channelId))
      : stores;

    const total = scoped.length;
    const alreadyHad = scoped.filter((s) => s.province?.trim()).length;
    const noGps = scoped.filter(
      (s) =>
        !s.province?.trim() &&
        (!s.gpsLat || !s.gpsLng || isNaN(parseFloat(s.gpsLat)) || isNaN(parseFloat(s.gpsLng)))
    ).length;

    // Stores that need province AND have GPS
    const needsProvince = scoped.filter(
      (s) =>
        !s.province?.trim() &&
        s.gpsLat &&
        s.gpsLng &&
        !isNaN(parseFloat(s.gpsLat)) &&
        !isNaN(parseFloat(s.gpsLng))
    );

    if (needsProvince.length === 0) {
      return NextResponse.json({
        ok: true,
        populated: 0,
        failed: 0,
        alreadyHad,
        noGps,
        remaining: 0,
        total,
        done: true,
      });
    }

    // Process only a batch
    const batch = needsProvince.slice(0, BATCH_SIZE);
    let populated = 0;
    let failed = 0;

    for (const store of batch) {
      try {
        const province = await reverseGeocodeRegion(
          parseFloat(store.gpsLat),
          parseFloat(store.gpsLng)
        );
        if (province) {
          store.province = province;
          populated++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    if (populated > 0) {
      await saveStores(stores);
    }

    const remaining = needsProvince.length - batch.length;

    return NextResponse.json({
      ok: true,
      populated,
      failed,
      alreadyHad: alreadyHad + populated,
      noGps,
      remaining,
      total,
      done: remaining === 0,
    });
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Populate provinces error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
