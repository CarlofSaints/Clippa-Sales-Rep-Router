import { NextRequest, NextResponse } from "next/server";
import { getStores, saveStores, getChannels, getStoreOverrides, saveStoreOverrides, getSubChannels } from "@/lib/data";
import { Store, FrequencyType } from "@/lib/types";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { isClosed, setStatusByHand } from "@/lib/closedStores";

export async function GET() {
  try {
    const stores = await getStores();
    return NextResponse.json(stores);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body as Partial<Store> & { id: string };

    const stores = await getStores();
    const idx = stores.findIndex((s) => s.id === id);
    if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (updates.repCode !== undefined) stores[idx].repCode = updates.repCode;

    // 🔴 Moving a store to a different channel invalidates its sub-channel.
    //
    // A sub-channel belongs to exactly one channel, so a store filed under
    // "PNP Hyper" that is moved to Makro would keep pointing at a sub-channel
    // of a retailer it is no longer part of — and `callPolicy` would happily
    // apply Pick n Pay's decision to a Makro store. Cleared here, so the store
    // falls back to its new channel until somebody files it again.
    //
    // Skipped when the same request also sets a sub-channel: that is a
    // deliberate move of both, and the validation below checks the pair.
    if (
      updates.channelId !== undefined &&
      updates.channelId !== stores[idx].channelId &&
      updates.subChannelId === undefined &&
      stores[idx].subChannelId
    ) {
      delete stores[idx].subChannelId;
    }
    if (updates.channelId !== undefined) stores[idx].channelId = updates.channelId;
    if (updates.gpsLat !== undefined) stores[idx].gpsLat = updates.gpsLat;
    if (updates.gpsLng !== undefined) stores[idx].gpsLng = updates.gpsLng;
    if (updates.rangeConfirmed !== undefined) stores[idx].rangeConfirmed = updates.rangeConfirmed;

    // Editing call frequency or duration here diverges the store from its
    // channel, so it has to leave an override record — that record is what
    // stops a later channel change cascading over the decision, and it is the
    // same marker the Call Overrides page uses.
    const divergesFromChannel =
      (updates.frequency !== undefined && updates.frequency !== stores[idx].frequency) ||
      (updates.duration !== undefined && updates.duration !== stores[idx].duration);

    if (updates.frequency !== undefined) stores[idx].frequency = updates.frequency as FrequencyType;
    if (updates.duration !== undefined) stores[idx].duration = updates.duration;
    if (updates.dayOfWeek !== undefined) stores[idx].dayOfWeek = updates.dayOfWeek;
    if (updates.weekNumber !== undefined) stores[idx].weekNumber = updates.weekNumber;
    if (updates.region !== undefined) stores[idx].region = updates.region;
    if (updates.province !== undefined) stores[idx].province = updates.province;

    // Which sub-channel this store sits in, set by hand.
    //
    // Empty string clears it, so the store follows its channel again — a real
    // choice, and the one to reach for when IMS has filed a shop wrongly.
    //
    // ⚠️ Validated against the store's OWN channel. A sub-channel belonging to
    // a different channel would never resolve: callPolicy looks the sub-channel
    // up and finds a parent that does not match, so the store would silently
    // take a policy from a retailer it is not part of.
    if (updates.subChannelId !== undefined) {
      const wanted = String(updates.subChannelId || "").trim();
      if (!wanted) {
        delete stores[idx].subChannelId;
      } else {
        const subChannels = await getSubChannels();
        const sub = subChannels.find((c) => c.id === wanted);
        if (!sub) {
          return NextResponse.json({ error: "That sub-channel does not exist." }, { status: 400 });
        }
        if (sub.channelId !== stores[idx].channelId) {
          return NextResponse.json(
            { error: `${sub.name} belongs to a different channel than this store.` },
            { status: 400 }
          );
        }
        stores[idx].subChannelId = wanted;
      }
    }

    // Active or closed, set by a person.
    //
    // This field existed for days before anything could reach it: the type had
    // it, the route engine and capacity both honoured it, and 267 stores were
    // already shut by the IMS bulk pass — but there was no way to correct a
    // single one by hand, because this route never accepted it.
    //
    // Written through setStatusByHand so the reason and the "a person decided
    // this" mark are recorded together. Setting `closed` here without them
    // would leave the decision to be silently undone by the next IMS run.
    const statusChanged =
      updates.closed !== undefined && !!updates.closed !== isClosed(stores[idx]);
    if (updates.closed !== undefined) {
      Object.assign(stores[idx], setStatusByHand(stores[idx], !!updates.closed));
    }

    await saveStores(stores);

    const session = await getSession();


    if (divergesFromChannel) {
      const store = stores[idx];
      const [channels, overrides] = await Promise.all([getChannels(), getStoreOverrides()]);
      const channel = channels.find((c) => c.id === store.channelId);

      // Back at the channel default? Then there is nothing to protect — drop
      // the override so the store follows its channel again.
      const backOnDefault =
        !!channel &&
        store.frequency === channel.frequency &&
        store.duration === channel.duration;

      const now = new Date().toISOString();
      const actor = session?.name || session?.email || "Unknown";
      const existingIdx = overrides.findIndex((o) => o.storeId === store.id);

      if (backOnDefault) {
        if (existingIdx !== -1) {
          overrides.splice(existingIdx, 1);
          await saveStoreOverrides(overrides);
        }
      } else {
        const base = {
          storeName: store.name,
          placeId: store.placeId,
          channelId: store.channelId,
          repCode: store.repCode,
          defaultFrequency: (channel?.frequency ?? store.frequency) as FrequencyType,
          defaultDuration: channel?.duration ?? store.duration,
          frequency: store.frequency,
          duration: store.duration,
          updatedAt: now,
        };
        if (existingIdx !== -1) {
          Object.assign(overrides[existingIdx], base);
        } else {
          overrides.push({
            id: crypto.randomUUID(),
            storeId: store.id,
            ...base,
            approvalStatus: "approved",
            requestedBy: actor,
            requestedAt: now,
            decidedBy: actor,
            decidedAt: now,
            createdBy: actor,
            createdAt: now,
          });
        }
        await saveStoreOverrides(overrides);
      }
    }

    // ONE entry, never two.
    //
    // 🔴 A second logActivity call in the same request is silently lost: each one
    // reads the month's log, appends, and writes the whole array back, so two
    // racing appends leave whichever finished first overwritten. Measured — a
    // dedicated "Closed a store" entry never appeared beside this one.
    //
    // So the status change is folded into this entry rather than logged
    // separately. Closing a store stops a rep being sent there, which is exactly
    // the kind of change the log exists to answer questions about, so it is named
    // in the action rather than buried in "Updated store".
    logActivity({
      action: statusChanged ? (isClosed(stores[idx]) ? "Closed a store" : "Reopened a store") : "Updated store",
      actor: session?.email || "unknown",
      actorName: session?.name || "Unknown",
      summary: statusChanged
        ? `${stores[idx].name} (${stores[idx].placeId}) marked ${
            isClosed(stores[idx]) ? "closed and taken out of the call cycles" : "active and back in the call cycles"
          } by hand`
        : `Updated store ${stores[idx].name}`,
    });

    return NextResponse.json(stores[idx]);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
