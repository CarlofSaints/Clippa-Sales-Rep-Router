import { NextResponse } from "next/server";
import { getStores, saveStores } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { hasGoogleMapsKey, reverseGeocodeRegion } from "@/lib/google-maps";

export const maxDuration = 120;

export async function POST() {
  try {
    await requireSession();

    if (!hasGoogleMapsKey()) {
      return NextResponse.json(
        { error: "GOOGLE_MAPS_API_KEY not configured" },
        { status: 400 }
      );
    }

    const stores = await getStores();

    // Filter to stores that need province AND have GPS coordinates
    const needsProvince = stores.filter(
      (s) =>
        !s.province?.trim() &&
        s.gpsLat &&
        s.gpsLng &&
        !isNaN(parseFloat(s.gpsLat)) &&
        !isNaN(parseFloat(s.gpsLng))
    );

    let populated = 0;
    let failed = 0;

    for (const store of needsProvince) {
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

    const alreadyHad = stores.filter((s) => s.province?.trim()).length - populated;
    const noGps = stores.filter(
      (s) => !s.province?.trim() && (!s.gpsLat || !s.gpsLng || isNaN(parseFloat(s.gpsLat)) || isNaN(parseFloat(s.gpsLng)))
    ).length;

    return NextResponse.json({
      ok: true,
      populated,
      failed,
      alreadyHad,
      noGps,
      total: stores.length,
    });
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Populate provinces error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
