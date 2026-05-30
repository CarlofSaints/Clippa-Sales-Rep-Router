import { NextRequest, NextResponse } from "next/server";
import { getStores, saveStores, getZones, saveZones } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import * as XLSX from "xlsx";

export async function POST(request: NextRequest) {
  try {
    await requireSession();

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(ws);

    const stores = await getStores();
    const zones = await getZones();

    // Build lookups
    const storeByPlaceId = new Map(stores.map((s) => [s.placeId, s]));
    const zoneByName = new Map(zones.map((z) => [z.name.toLowerCase().trim(), z]));

    let updated = 0;
    let notFound = 0;
    const newZoneNames: string[] = [];

    // Helper: get column value by trying multiple header names (trimmed)
    const col = (row: Record<string, string | number>, ...keys: string[]) => {
      const trimmedEntries = Object.entries(row).map(
        ([k, v]) => [k.trim(), v] as const
      );
      for (const k of keys) {
        const entry = trimmedEntries.find(([tk]) => tk === k);
        if (entry !== undefined && entry[1] !== undefined && entry[1] !== "") {
          return String(entry[1]).trim();
        }
      }
      return "";
    };

    for (const row of rows) {
      const placeId = col(row, "Place ID", "PLACE ID", "PlaceID", "Store ID");
      if (!placeId) continue;

      const store = storeByPlaceId.get(placeId);
      if (!store) {
        notFound++;
        continue;
      }

      const zoneName = col(row, "Zone", "ZONE");
      const region = col(row, "Region", "REGION");

      // Update region if provided
      if (region) {
        store.region = region;
      }

      // Update zone assignment
      if (zoneName) {
        const key = zoneName.toLowerCase().trim();
        let zone = zoneByName.get(key);

        if (!zone) {
          // Auto-create new zone
          zone = {
            id: crypto.randomUUID(),
            name: zoneName.trim(),
            description: "",
          };
          zones.push(zone);
          zoneByName.set(key, zone);
          newZoneNames.push(zoneName.trim());
        }

        store.zoneId = zone.id;
        updated++;
      } else {
        // Blank zone column = unassign
        if (store.zoneId) {
          delete store.zoneId;
          updated++;
        }
      }
    }

    // Save if anything changed
    if (updated > 0 || newZoneNames.length > 0) {
      await saveStores(stores);
      if (newZoneNames.length > 0) {
        await saveZones(zones);
      }
    }

    return NextResponse.json({
      ok: true,
      updated,
      notFound,
      newZones: newZoneNames,
      totalRows: rows.length,
    });
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Zone import error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
