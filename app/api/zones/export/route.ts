import { NextResponse } from "next/server";
import { getStores, getChannels, getZones } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import XLSX from "xlsx";

export async function GET() {
  try {
    await requireSession();

    const [stores, channels, zones] = await Promise.all([
      getStores(),
      getChannels(),
      getZones(),
    ]);

    const channelMap = new Map(channels.map((c) => [c.id, c.name]));
    const zoneMap = new Map(zones.map((z) => [z.id, z.name]));

    // Header row
    const rows: (string | number)[][] = [
      ["Store Name", "Place ID", "Channel", "Region", "Province", "Zone"],
    ];

    // Sort stores by name for readability
    const sorted = [...stores].sort((a, b) => a.name.localeCompare(b.name));

    for (const s of sorted) {
      rows.push([
        s.name,
        s.placeId,
        channelMap.get(s.channelId) || "",
        s.region || "",
        s.province || "",
        s.zoneId ? zoneMap.get(s.zoneId) || "" : "",
      ]);
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Column widths
    ws["!cols"] = [
      { wch: 35 }, // Store Name
      { wch: 15 }, // Place ID
      { wch: 20 }, // Channel
      { wch: 20 }, // Region
      { wch: 20 }, // Province
      { wch: 25 }, // Zone
    ];

    XLSX.utils.book_append_sheet(wb, ws, "Store Zones");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const filename = `Store_Zones_${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Zone export error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
