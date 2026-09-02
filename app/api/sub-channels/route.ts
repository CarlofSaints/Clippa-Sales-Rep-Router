import { NextRequest, NextResponse } from "next/server";
import { getSubChannels, saveSubChannels, getStores, saveStores } from "@/lib/data";
import { requirePermission, getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import type { SubChannel } from "@/lib/types";

/**
 * Sub-channels: read, create, retarget, delete.
 *
 * The only field with any teeth is `notARepChannel`, and it has THREE states.
 * See `callPolicy` in lib/routable.ts — absent means "follow the parent
 * channel", which is a different answer from either true or false and is the
 * one every imported sub-channel starts in.
 */

export async function GET() {
  try {
    await requirePermission("manage_channels");
    return NextResponse.json(await getSubChannels());
  } catch (err) {
    const msg = String(err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Forbidden")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requirePermission("manage_channels");
    const body = await request.json();
    const name = String(body?.name || "").trim();
    const channelId = String(body?.channelId || "").trim();
    if (!name || !channelId) {
      return NextResponse.json({ error: "A sub-channel needs a name and a parent channel." }, { status: 400 });
    }

    const subChannels = await getSubChannels();
    const id = `${channelId}__${name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
    // Scoped to the parent: the same sub-channel name under two channels is two
    // different groups, and rejecting the second would lose one of them.
    if (subChannels.some((c) => c.id === id)) {
      return NextResponse.json({ error: `${name} already exists under that channel.` }, { status: 400 });
    }

    const created: SubChannel = {
      id,
      name,
      channelId,
      source: "manual",
      sourceAt: new Date().toISOString(),
    };
    await saveSubChannels([...subChannels, created]);

    const session = await getSession();
    logActivity({
      action: "Created sub-channel",
      actor: session?.email || "unknown",
      actorName: session?.name || "Unknown",
      summary: `Created sub-channel ${name} under ${channelId}`,
    });
    return NextResponse.json(created);
  } catch (err) {
    const msg = String(err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Forbidden")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requirePermission("manage_channels");
    const body = await request.json();
    const { id, name, notARepChannel } = body as Partial<SubChannel> & { id: string };

    const subChannels = await getSubChannels();
    const idx = subChannels.findIndex((c) => c.id === id);
    if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (name) subChannels[idx].name = String(name).trim();

    // 🔴 THREE states. `null` clears the setting so the sub-channel follows its
    // parent again; that is a real choice a manager can want back, and folding
    // it into `false` would pin the sub-channel to "called on" forever.
    let routingChanged = false;
    if (notARepChannel !== undefined) {
      const before = subChannels[idx].notARepChannel;
      if (notARepChannel === null) delete subChannels[idx].notARepChannel;
      else subChannels[idx].notARepChannel = !!notARepChannel;
      routingChanged = before !== subChannels[idx].notARepChannel;
    }

    await saveSubChannels(subChannels);

    if (routingChanged) {
      const s = subChannels[idx];
      const session = await getSession();
      logActivity({
        action: "Updated sub-channel",
        actor: session?.email || "unknown",
        actorName: session?.name || "Unknown",
        summary: `${s.name} now ${
          s.notARepChannel === undefined
            ? "follows its channel"
            : s.notARepChannel
              ? "is not a rep sub-channel — its stores leave every call cycle"
              : "is called on, whatever its channel says"
        }`,
      });
    }

    return NextResponse.json(subChannels[idx]);
  } catch (err) {
    const msg = String(err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Forbidden")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requirePermission("manage_channels");
    const id = request.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "No sub-channel named." }, { status: 400 });

    const [subChannels, stores] = await Promise.all([getSubChannels(), getStores()]);
    const target = subChannels.find((c) => c.id === id);
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // A store pointing at a sub-channel that no longer exists would fall back to
    // its channel silently. Clearing the pointer makes that explicit instead of
    // leaving a dangling id nobody can explain later.
    let cleared = 0;
    for (const s of stores) {
      if (s.subChannelId === id) {
        delete s.subChannelId;
        cleared++;
      }
    }
    if (cleared > 0) await saveStores(stores);
    await saveSubChannels(subChannels.filter((c) => c.id !== id));

    const session = await getSession();
    logActivity({
      action: "Deleted sub-channel",
      actor: session?.email || "unknown",
      actorName: session?.name || "Unknown",
      summary: `Deleted sub-channel ${target.name}${cleared ? `; ${cleared} store(s) now follow their channel` : ""}`,
    });

    return NextResponse.json({ ok: true, storesCleared: cleared });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Forbidden")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
