import { NextRequest, NextResponse } from "next/server";
import { getStores, saveStores, getChannels, saveChannels, getReps, saveReps } from "@/lib/data";
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
    const channelMap = new Map(existingChannels.map((c) => [c.name, c]));
    const repMap = new Map(existingReps.map((r) => [r.code, r]));

    const stores: Store[] = [];

    for (const row of rows) {
      const placeId = String(row["PLACE ID"] || "").trim();
      const repCode = String(row["REPRESENTATIVE ID"] || "").trim();
      const channelName = String(row["CHANNEL"] || "").trim();
      const storeName = String(row["PLACE NAME"] || "").trim();
      const repName = String(row["REPRESENTATIVE NAME"] || "").trim();
      const lat = String(row["GPS LATITUDE"] || "").trim();
      const lng = String(row["GPS LONGITUDE"] || "").trim();
      const sales = Number(row["MONTHLY AVERAGE"] || 0);

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

      stores.push({
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
      });
    }

    await saveChannels(Array.from(channelMap.values()));
    await saveReps(Array.from(repMap.values()));
    await saveStores(stores);

    return NextResponse.json({
      ok: true,
      imported: stores.length,
      channels: channelMap.size,
      reps: repMap.size,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
