import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { getStores, saveStores, getChannels } from "@/lib/data";
import { isSqlProxyConfigured, sqlQuery } from "@/lib/sqlProxy";
import { norm, type ImsStore } from "@/lib/imsReconCore";
import { planBackfill } from "@/lib/mapStatus";

/**
 * Fill blank channel and province on stores from the IMS outlet master.
 *
 * Preview is the default; `?mode=apply` is the only thing that writes.
 *
 * ⚠️ Only ever fills a field that is BLANK. A value the app already holds is
 * never replaced — the router's channel drives call frequency, duration and
 * every route, and IMS's channel vocabulary is a different one. Overwriting
 * would silently re-plan the year.
 *
 * ⚠️ Channels are MATCHED, never created. An IMS channel with no counterpart
 * here is reported back by name and count so somebody can decide, rather than
 * quietly inventing rows in a table that routes depend on.
 */

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    await requirePermission("upload_stores");

    if (!isSqlProxyConfigured()) {
      return NextResponse.json(
        { error: "SQL_PROXY_URL and SQL_PROXY_API_KEY are not set on this deployment." },
        { status: 503 }
      );
    }

    const mode = request.nextUrl.searchParams.get("mode") === "apply" ? "apply" : "preview";

    const [masterRes, stores, channels] = await Promise.all([
      sqlQuery<ImsStore>("clippa_ims_store_master", {}),
      getStores(),
      getChannels(),
    ]);

    const master = new Map<string, ImsStore>();
    for (const r of masterRes.data ?? []) master.set(norm(r["Store Code"]), r);

    // Match on the channel's name, case and spacing insensitive. That is the only
    // thing the two systems share; there is no common id.
    const byName = new Map<string, string>();
    for (const c of channels) byName.set(norm(c.name).replace(/\s+/g, " "), c.id);
    const channelIdFor = (imsName: string) => byName.get(norm(imsName).replace(/\s+/g, " ")) ?? null;

    const { changes, channelCount, provinceCount, unmappedChannels } = planBackfill(
      stores,
      master,
      channelIdFor
    );

    if (mode === "apply" && changes.length > 0) {
      const byPlaceId = new Map(changes.map((c) => [norm(c.placeId), c]));
      const next = stores.map((s) => {
        const change = byPlaceId.get(norm(s.placeId || s.id));
        if (!change) return s;
        return {
          ...s,
          ...(change.channel ? { channelId: change.channel } : {}),
          ...(change.province ? { province: change.province } : {}),
        };
      });
      await saveStores(next);
    }

    return NextResponse.json({
      mode,
      applied: mode === "apply",
      storesTouched: changes.length,
      channelCount,
      provinceCount,
      // Named, because each one is a channel somebody may need to create here
      // before those stores can ever be filled.
      unmappedChannels: [...unmappedChannels.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([name, count]) => ({ name, count })),
      samples: changes.slice(0, 15),
    });
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Forbidden")) {
      return NextResponse.json({ error: "You do not have permission to write stores." }, { status: 403 });
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
