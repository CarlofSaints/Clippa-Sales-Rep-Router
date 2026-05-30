import { NextRequest, NextResponse } from "next/server";
import { getStores, saveStores, getChannels, saveChannels, getReps, saveReps, getZones } from "@/lib/data";
import { Store, Channel, Rep } from "@/lib/types";
import * as XLSX from "xlsx";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(ws);

    // Load existing data
    const existingChannels = await getChannels();
    const existingReps = await getReps();
    const existingStores = await getStores();
    const existingZones = await getZones();
    const zoneMap = new Map(existingZones.map((z) => [z.name.toLowerCase(), z]));
    const channelMap = new Map(existingChannels.map((c) => [c.name, c]));
    const repMap = new Map(existingReps.map((r) => [r.code, r]));

    // Index existing stores by placeId for merge
    const storeMap = new Map(existingStores.map((s) => [s.placeId, s]));
    let newCount = 0;
    let updatedCount = 0;

    // Helper: try multiple header names, return first match (trimmed key lookup)
    const col = (row: Record<string, string | number>, ...keys: string[]) => {
      // Build a trimmed-key lookup so " VALUE " matches "VALUE"
      const trimmedEntries = Object.entries(row).map(([k, v]) => [k.trim(), v] as const);
      for (const k of keys) {
        const entry = trimmedEntries.find(([tk]) => tk === k);
        if (entry !== undefined && entry[1] !== undefined && entry[1] !== "") {
          return String(entry[1]).trim();
        }
      }
      return "";
    };

    for (const row of rows) {
      const placeId = col(row, "PLACE ID", "STORE ID", "Store ID");
      const repCode = col(row, "REPRESENTATIVE ID", "REP CODE", "Rep Code");
      const channelName = col(row, "CHANNEL", "Channel");
      const storeName = col(row, "PLACE NAME", "STORE NAME", "Store Name");
      const repName = col(row, "REPRESENTATIVE NAME", "REP NAME", "Rep Name");
      const lat = col(row, "GPS LATITUDE", "Gps latitude", "Gps Latitude", "GPS_LATITUDE");
      const lng = col(row, "GPS LONGITUDE", "Gps longitude", "Gps Longitude", "GPS_LONGITUDE");
      const rawSales = col(row, "MONTHLY AVERAGE", "VALUE", "Value");
      const sales = Number(rawSales.replace(/[^0-9.\-]/g, "") || 0);
      const zoneName = col(row, "ZONE", "Zone", "AREA", "Area");

      if (!placeId || !storeName) continue;

      // Auto-create channel
      if (channelName && !channelMap.has(channelName)) {
        const ch: Channel = {
          id: channelName.toLowerCase().replace(/[^a-z0-9]/g, "_"),
          name: channelName,
          frequency: "monthly",
          duration: 30,
        };
        channelMap.set(channelName, ch);
      }

      // Auto-create rep
      if (repCode && !repMap.has(repCode)) {
        const r: Rep = {
          id: crypto.randomUUID(),
          code: repCode,
          name: repName,
          email: "",
          cell: "",
          homeAddress: "",
          homeGpsLat: "",
          homeGpsLng: "",
          teamId: "",
        };
        repMap.set(repCode, r);
      }

      const channelId = channelMap.get(channelName)?.id || "";
      const zoneId = zoneName ? (zoneMap.get(zoneName.toLowerCase())?.id || "") : "";

      if (storeMap.has(placeId)) {
        // Update existing store
        const existing = storeMap.get(placeId)!;
        existing.name = storeName;
        existing.channelId = channelId;
        existing.repCode = repCode;
        existing.gpsLat = lat;
        existing.gpsLng = lng;
        existing.monthlySales = sales;
        if (zoneId) existing.zoneId = zoneId;
        updatedCount++;
      } else {
        // Add new store
        storeMap.set(placeId, {
          id: placeId,
          placeId,
          name: storeName,
          channelId,
          repCode,
          gpsLat: lat,
          gpsLng: lng,
          monthlySales: sales,
          frequency: "monthly",
          duration: 30,
          dayOfWeek: "",
          weekNumber: "",
          ...(zoneId ? { zoneId } : {}),
        });
        newCount++;
      }
    }

    await saveChannels(Array.from(channelMap.values()));
    await saveReps(Array.from(repMap.values()));
    await saveStores(Array.from(storeMap.values()));

    return NextResponse.json({
      ok: true,
      added: newCount,
      updated: updatedCount,
      total: storeMap.size,
      channels: channelMap.size,
      reps: repMap.size,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
