import { NextResponse } from "next/server";
import { getStores, saveStores, getReps, saveReps, getZones, saveZones } from "@/lib/data";
import { Zone } from "@/lib/types";
import { requireSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";

export async function POST() {
  try {
    const session = await requireSession();

    const [stores, reps, existingZones] = await Promise.all([
      getStores(),
      getReps(),
      getZones(),
    ]);

    // Group stores by repCode
    const storesByRep = new Map<string, typeof stores>();
    for (const s of stores) {
      if (!s.repCode) continue;
      const arr = storesByRep.get(s.repCode) || [];
      arr.push(s);
      storesByRep.set(s.repCode, arr);
    }

    // Find the highest existing "Zone N" number to continue from
    let maxNum = 0;
    for (const z of existingZones) {
      const match = z.name.match(/^Zone\s+(\d+)$/i);
      if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
    }

    const newZones: Zone[] = [];
    let storesAssigned = 0;
    let repsAssigned = 0;

    // Sort rep codes for deterministic ordering
    const repCodes = [...storesByRep.keys()].sort();

    for (const repCode of repCodes) {
      const repStores = storesByRep.get(repCode)!;

      // Skip if all stores already have zones assigned
      const unzoned = repStores.filter((s) => !s.zoneId);
      if (unzoned.length === 0) continue;

      maxNum++;
      const zone: Zone = {
        id: crypto.randomUUID(),
        name: `Zone ${maxNum}`,
        description: "",
      };
      newZones.push(zone);

      // Assign unzoned stores to this zone
      for (const s of unzoned) {
        s.zoneId = zone.id;
        storesAssigned++;
      }

      // Assign zone to the rep
      const rep = reps.find((r) => r.code === repCode);
      if (rep) {
        const existing = new Set(rep.assignedZones || []);
        if (!existing.has(zone.id)) {
          existing.add(zone.id);
          rep.assignedZones = [...existing];
          repsAssigned++;
        }
      }
    }

    if (newZones.length === 0) {
      return NextResponse.json({
        ok: true,
        zonesCreated: 0,
        storesAssigned: 0,
        repsAssigned: 0,
        message: "All stores already have zones assigned",
      });
    }

    // Save everything
    const allZones = [...existingZones, ...newZones];
    await Promise.all([
      saveZones(allZones),
      saveStores(stores),
      saveReps(reps),
    ]);

    logActivity({
      action: "Auto-generated zones",
      actor: session?.email || "unknown",
      actorName: session?.name || "Unknown",
      summary: `Created ${newZones.length} zones, assigned ${storesAssigned} stores and ${repsAssigned} reps`,
    });

    return NextResponse.json({
      ok: true,
      zonesCreated: newZones.length,
      storesAssigned,
      repsAssigned,
    });
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Auto-generate zones error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
