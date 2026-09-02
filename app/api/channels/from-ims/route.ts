import { NextRequest, NextResponse } from "next/server";
import { getChannels, saveChannels, getStores } from "@/lib/data";
import { getImsSnapshot } from "@/lib/imsSnapshot";
import { requirePermission, getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import type { Channel } from "@/lib/types";

/**
 * Create the channels IMS uses that this app does not have.
 *
 * Preview is the default; `?mode=apply` with an explicit list of names is the
 * only thing that writes.
 *
 * 🔴 It never creates everything it finds. IMS carries "INDEPENDANT" and
 * "INDEPANDANT" beside "INDEPENDENT", and a channel named "GAUTENG" holding 139
 * outlets — a blind import would turn the client's typos into permanent
 * channels that stores then get filed under. So the preview lists candidates
 * with their outlet counts and flags the ones that look like a near-duplicate
 * of a channel already here, and the caller chooses.
 */

export const dynamic = "force-dynamic";

const norm = (v: unknown) => String(v ?? "").trim().toUpperCase();

/**
 * Does this name look like a typo of one we already have?
 *
 * Cheap edit-distance, capped at one substitution or transposition on names of
 * the same rough length. Deliberately narrow: the job is to catch INDEPENDANT
 * against INDEPENDENT, not to guess that "OK MINI MARK" belongs with "OK".
 */
function looksLikeTypoOf(candidate: string, existing: string[]): string | null {
  const a = norm(candidate);
  for (const other of existing) {
    const b = norm(other);
    if (a === b) return other;
    if (Math.abs(a.length - b.length) > 1) continue;
    let edits = 0;
    for (let i = 0, j = 0; i < a.length && j < b.length; i++, j++) {
      if (a[i] === b[j]) continue;
      if (++edits > 1) break;
      if (a.length > b.length) j--;
      else if (b.length > a.length) i--;
    }
    if (edits <= 1 && Math.abs(a.length - b.length) <= 1) return other;
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    await requirePermission("manage_channels");

    const [channels, snapshot, stores] = await Promise.all([
      getChannels(),
      getImsSnapshot(),
      getStores(),
    ]);

    if (!snapshot) {
      return NextResponse.json(
        { error: "No IMS snapshot has been built yet. Press Refresh snapshot on IMS Reconciliation first." },
        { status: 400 }
      );
    }
    if (!snapshot.imsChannels || snapshot.imsChannels.length === 0) {
      return NextResponse.json(
        {
          error:
            "This snapshot predates the channel list. Press Refresh snapshot on IMS Reconciliation to rebuild it.",
        },
        { status: 400 }
      );
    }

    const existingNames = channels.map((c) => c.name);
    const existingSet = new Set(existingNames.map(norm));

    // How many stores in THIS app already carry each channel, so a candidate
    // can say whether creating it would actually file anything.
    const appUsage = new Map<string, number>();
    for (const s of stores) appUsage.set(norm(s.channelId), (appUsage.get(norm(s.channelId)) ?? 0) + 1);

    const candidates = snapshot.imsChannels
      .filter((c) => !existingSet.has(norm(c.name)))
      .map((c) => ({
        name: c.name,
        outlets: c.outlets,
        // Named rather than silently skipped: a near-duplicate is usually a
        // client typo, and the person importing should decide.
        looksLike: looksLikeTypoOf(c.name, existingNames),
      }));

    const mode = request.nextUrl.searchParams.get("mode");
    if (mode !== "apply") {
      return NextResponse.json({
        mode: "preview",
        fetchedAt: snapshot.fetchedAt,
        imsChannelCount: snapshot.imsChannels.length,
        existing: channels.length,
        candidates,
      });
    }

    const body = await request.json().catch(() => ({}));
    const wanted: string[] = Array.isArray(body?.names) ? body.names : [];
    if (wanted.length === 0) {
      return NextResponse.json({ error: "No channels were chosen." }, { status: 400 });
    }

    // Only names the preview actually offered. A caller cannot invent a channel
    // through this route, and a name that has appeared in the meantime is not
    // created twice.
    const offered = new Map(candidates.map((c) => [norm(c.name), c]));
    const created: Channel[] = [];
    const skipped: string[] = [];

    for (const name of wanted) {
      const match = offered.get(norm(name));
      if (!match) {
        skipped.push(name);
        continue;
      }
      // Guard against the same name arriving twice in one request.
      if (created.some((c) => norm(c.name) === norm(match.name))) continue;
      created.push({
        id: match.name.toLowerCase().replace(/[^a-z0-9]/g, "_"),
        name: match.name,
        // 🔴 Monthly and 30 minutes, NOT copied from anything. IMS has no call
        // rhythm to copy, and inheriting a busy channel's weekly default would
        // hand every new channel four visits a month that nobody asked for.
        frequency: "monthly",
        duration: 30,
      });
    }

    // An id collision would silently overwrite an existing channel's stores.
    const existingIds = new Set(channels.map((c) => c.id));
    const clashes = created.filter((c) => existingIds.has(c.id));
    if (clashes.length > 0) {
      return NextResponse.json(
        {
          error: `These would collide with a channel that already exists: ${clashes
            .map((c) => c.name)
            .join(", ")}. Rename them on the Channels page first.`,
        },
        { status: 400 }
      );
    }

    await saveChannels([...channels, ...created]);

    const session = await getSession();
    logActivity({
      action: "Imported channels from IMS",
      actor: session?.email || "unknown",
      actorName: session?.name || "Unknown",
      summary: `Created ${created.length} channel${created.length === 1 ? "" : "s"} from IMS${
        skipped.length ? `, skipped ${skipped.length} already present` : ""
      }`,
      details: created.map((c) => c.name).join(", ").slice(0, 900),
    });

    return NextResponse.json({
      mode: "apply",
      created: created.map((c) => ({ id: c.id, name: c.name })),
      skipped,
      // What the new channels will do until somebody says otherwise.
      note: "New channels are Once a Month at 30 minutes and ARE called on by reps. Set the frequency, or mark them Not a rep channel, before regenerating routes.",
      unusedByStores: created.filter((c) => (appUsage.get(norm(c.id)) ?? 0) === 0).length,
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
