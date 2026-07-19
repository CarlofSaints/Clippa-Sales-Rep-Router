import { NextResponse } from "next/server";
import { getStores, saveStores, getChannels } from "@/lib/data";
import { Store } from "@/lib/types";
import { getSession, requireSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";

// Group key: same store name + same rep = the same physical store.
function groupKey(s: Store): string {
  return `${(s.name || "").trim().toUpperCase()}|${s.repCode}`;
}

// Score a record so we keep the "best" one in a duplicate group: prefer a valid
// in-SA coordinate, then any valid GPS, then a real channel / province / confirmation.
function score(s: Store): number {
  const lat = parseFloat(s.gpsLat);
  const lng = parseFloat(s.gpsLng);
  const validGps =
    !isNaN(lat) && !isNaN(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
    !(Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01);
  const inSA = validGps && lat >= -35 && lat <= -22 && lng >= 16 && lng <= 33;
  let n = 0;
  if (inSA) n += 100;
  else if (validGps) n += 40;
  if ((s.channelId || "").trim()) n += 10;
  if ((s.province || "").trim()) n += 5;
  if (s.rangeConfirmed) n += 3;
  return n;
}

interface DupGroup {
  key: string;
  storeName: string;
  repCode: string;
  keepId: string;
  records: { id: string; placeId: string; channelId: string; gpsLat: string; gpsLng: string; keep: boolean }[];
}

function buildGroups(stores: Store[]): { groups: DupGroup[]; removeIds: Set<string> } {
  const byKey = new Map<string, Store[]>();
  for (const s of stores) {
    const k = groupKey(s);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(s);
  }

  const groups: DupGroup[] = [];
  const removeIds = new Set<string>();

  for (const [key, recs] of byKey) {
    if (recs.length < 2) continue;
    // Highest score wins; ties keep the first encountered.
    let keep = recs[0];
    for (const r of recs) if (score(r) > score(keep)) keep = r;

    for (const r of recs) if (r.id !== keep.id) removeIds.add(r.id);

    groups.push({
      key,
      storeName: keep.name,
      repCode: keep.repCode,
      keepId: keep.id,
      records: recs.map((r) => ({
        id: r.id,
        placeId: r.placeId,
        channelId: r.channelId,
        gpsLat: r.gpsLat,
        gpsLng: r.gpsLng,
        keep: r.id === keep.id,
      })),
    });
  }

  // Most-duplicated first
  groups.sort((a, b) => b.records.length - a.records.length);
  return { groups, removeIds };
}

export async function GET() {
  try {
    await requireSession();
    const [stores, channels] = await Promise.all([getStores(), getChannels()]);
    const channelName = new Map(channels.map((c) => [c.id, c.name]));
    const { groups, removeIds } = buildGroups(stores);

    const withChannel = groups.map((g) => ({
      ...g,
      records: g.records.map((r) => ({ ...r, channel: channelName.get(r.channelId) || r.channelId || "" })),
    }));

    return NextResponse.json({
      totalStores: stores.length,
      groupCount: groups.length,
      removableCount: removeIds.size,
      groups: withChannel,
    });
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Duplicates error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST() {
  try {
    await requireSession();
    const stores = await getStores();
    const { removeIds } = buildGroups(stores);

    if (removeIds.size === 0) {
      return NextResponse.json({ removed: 0, remaining: stores.length });
    }

    const survivors = stores.filter((s) => !removeIds.has(s.id));
    await saveStores(survivors);

    const session = await getSession();
    logActivity({
      action: "Deduplicated stores",
      actor: session?.email || "unknown",
      actorName: session?.name || "Unknown",
      summary: `Removed ${removeIds.size} duplicate store records (${survivors.length} remain)`,
    });

    return NextResponse.json({ removed: removeIds.size, remaining: survivors.length });
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Dedup apply error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
