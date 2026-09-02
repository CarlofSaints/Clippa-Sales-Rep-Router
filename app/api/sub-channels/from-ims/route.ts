import { NextRequest, NextResponse } from "next/server";
import { getChannels, getSubChannels, saveSubChannels, getStores, saveStores } from "@/lib/data";
import { getImsSnapshot } from "@/lib/imsSnapshot";
import { requirePermission, getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import type { SubChannel } from "@/lib/types";

/**
 * Import sub-channels from IMS, and file this app's stores under them.
 *
 * Two jobs in one pass because they are useless apart: a sub-channel nothing
 * points at cannot exclude anything, and a store cannot point at a sub-channel
 * that does not exist yet.
 *
 * ⚠️ The whole reason this is cheap: IMS already carries `Store Sub Channel` on
 * every outlet, so neither the list nor the per-store assignment needs a
 * spreadsheet. The snapshot is matched to this app's stores on Place ID, which
 * is the same key everything else here uses.
 *
 * Preview is the default. `?mode=apply` writes.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const norm = (v: unknown) => String(v ?? "").trim().toUpperCase();
const subId = (channelId: string, name: string) =>
  `${channelId}__${name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;

export async function POST(request: NextRequest) {
  try {
    await requirePermission("manage_channels");

    const [channels, subChannels, stores, snapshot] = await Promise.all([
      getChannels(),
      getSubChannels(),
      getStores(),
      getImsSnapshot(),
    ]);

    if (!snapshot) {
      return NextResponse.json(
        { error: "No IMS snapshot has been built yet. Press Refresh snapshot on IMS Reconciliation first." },
        { status: 400 }
      );
    }
    if (!snapshot.imsSubChannels) {
      return NextResponse.json(
        {
          error:
            "This snapshot predates the sub-channel list. Press Refresh snapshot on IMS Reconciliation to rebuild it.",
        },
        { status: 400 }
      );
    }

    // IMS names its channels; this app has ids. Match on name, which is what the
    // channel import creates them from.
    const channelByName = new Map(channels.map((c) => [norm(c.name), c]));
    const existingIds = new Set(subChannels.map((c) => c.id));

    // A sub-channel whose PARENT channel is not configured here cannot be
    // created: it would hang off nothing and could never be resolved. Reported
    // rather than dropped, because the fix is to import that channel first.
    const candidates: { name: string; channel: string; outlets: number }[] = [];
    const orphanParents = new Map<string, number>();
    for (const s of snapshot.imsSubChannels) {
      const parent = channelByName.get(norm(s.channel));
      if (!parent) {
        orphanParents.set(s.channel, (orphanParents.get(s.channel) ?? 0) + s.outlets);
        continue;
      }
      if (existingIds.has(subId(parent.id, s.name))) continue;
      candidates.push(s);
    }

    // How many of THIS app's stores each sub-channel would claim, which is the
    // number that decides whether importing it is worth anything.
    const storeByPlace = new Map(stores.map((s) => [norm(s.placeId || s.id), s]));
    const wouldFile = new Map<string, number>();
    for (const [place, row] of Object.entries(snapshot.rows)) {
      const store = storeByPlace.get(norm(place));
      if (!store || !row.imsSubChannel) continue;
      const parent = channelByName.get(norm(row.imsChannel));
      if (!parent) continue;
      const id = subId(parent.id, row.imsSubChannel);
      wouldFile.set(id, (wouldFile.get(id) ?? 0) + 1);
    }

    const withCounts = candidates.map((c) => {
      const parent = channelByName.get(norm(c.channel))!;
      return {
        name: c.name,
        channel: c.channel,
        channelId: parent.id,
        outlets: c.outlets,
        storesHere: wouldFile.get(subId(parent.id, c.name)) ?? 0,
      };
    });

    const mode = request.nextUrl.searchParams.get("mode");
    if (mode !== "apply") {
      return NextResponse.json({
        mode: "preview",
        fetchedAt: snapshot.fetchedAt,
        candidates: withCounts,
        existing: subChannels.length,
        orphanParents: [...orphanParents]
          .map(([channel, outlets]) => ({ channel, outlets }))
          .sort((a, b) => b.outlets - a.outlets),
      });
    }

    const body = await request.json().catch(() => ({}));
    const wanted: string[] = Array.isArray(body?.ids) ? body.ids : [];
    if (wanted.length === 0) {
      return NextResponse.json({ error: "No sub-channels were chosen." }, { status: 400 });
    }

    const offered = new Map(withCounts.map((c) => [subId(c.channelId, c.name), c]));
    const created: SubChannel[] = [];
    for (const id of wanted) {
      const match = offered.get(id);
      if (!match) continue;
      if (created.some((c) => c.id === id)) continue;
      created.push({
        id,
        name: match.name,
        channelId: match.channelId,
        // 🔴 No routing setting at all. A new sub-channel FOLLOWS ITS CHANNEL
        // until somebody decides otherwise; defaulting it either way would make
        // an import a routing decision, which it is not.
        source: "ims",
        sourceAt: new Date().toISOString(),
      });
    }

    const nextSubChannels = [...subChannels, ...created];
    await saveSubChannels(nextSubChannels);

    // File this app's stores under whichever sub-channel now exists for them.
    // Every sub-channel, not only the ones just created, so a second run picks
    // up stores added since the last one.
    const validIds = new Set(nextSubChannels.map((c) => c.id));
    let filed = 0;
    let moved = 0;
    for (const [place, row] of Object.entries(snapshot.rows)) {
      const store = storeByPlace.get(norm(place));
      if (!store || !row.imsSubChannel) continue;
      const parent = channelByName.get(norm(row.imsChannel));
      if (!parent) continue;
      const id = subId(parent.id, row.imsSubChannel);
      if (!validIds.has(id)) continue;
      if (store.subChannelId === id) continue;
      if (store.subChannelId) moved++;
      else filed++;
      store.subChannelId = id;
    }
    if (filed + moved > 0) await saveStores(stores);

    const session = await getSession();
    logActivity({
      action: "Imported sub-channels from IMS",
      actor: session?.email || "unknown",
      actorName: session?.name || "Unknown",
      summary:
        `Created ${created.length} sub-channel${created.length === 1 ? "" : "s"}` +
        `; filed ${filed} store${filed === 1 ? "" : "s"}` +
        (moved ? `, moved ${moved} to a different sub-channel` : ""),
      details: created.map((c) => c.name).join(", ").slice(0, 900),
    });

    return NextResponse.json({
      mode: "apply",
      created: created.map((c) => ({ id: c.id, name: c.name, channelId: c.channelId })),
      storesFiled: filed,
      storesMoved: moved,
      note: "New sub-channels follow their channel until you say otherwise. Set one to called on, or not a rep sub-channel, then regenerate routes.",
    });
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Forbidden")) {
      return NextResponse.json({ error: "You do not have permission to manage channels." }, { status: 403 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
