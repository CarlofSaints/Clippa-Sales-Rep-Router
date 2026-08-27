import "server-only";
import { get, put } from "@vercel/blob";
import { sqlQuery } from "./sqlProxy";
import { getStores } from "./data";
import { norm, type ImsStore } from "./imsReconCore";
import { buildStoreMap, type StoreMap } from "./mapStatus";

/**
 * A cached IMS map, so pages do not each pay for a live SQL round trip.
 *
 * Building it costs three proxy queries and roughly twenty seconds — fine for a
 * button or a nightly job, far too slow for the Stores page, which is the busiest
 * screen in the app. So the COMPUTED map is stored rather than the raw data:
 * 6 655 rows plus 4 820 ghosts, instead of 40 632 master rows and two sales sets.
 *
 * ⚠️ The snapshot is a point in time and says so. A store edited after it was
 * taken keeps its old status until the next refresh, which is why every reader
 * shows the age.
 */

const KEY = "ims-map.json";

export interface ImsSnapshot extends StoreMap {
  fetchedAt: string;
  monthsBack: number;
  /** Counts at build time, for showing what the snapshot covers without walking it. */
  totals: {
    appStores: number;
    imsSalesCodes: number;
    imsMasterCodes: number;
    ghosts: number;
  };
}

interface ImsSale {
  "Place ID": string;
  SalesValue: number;
}

/** Fetch from SQL and compute. Slow on purpose — call from a button or a cron. */
export async function buildImsSnapshot(monthsBack = 6): Promise<ImsSnapshot> {
  const [salesRes, sales12Res, masterRes, stores] = await Promise.all([
    sqlQuery<ImsSale>("clippa_ims_place_sales", { monthsBack }),
    sqlQuery<ImsSale>("clippa_ims_place_sales", { monthsBack: 12 }),
    sqlQuery<ImsStore>("clippa_ims_store_master", {}),
    getStores(),
  ]);

  const sales = new Map<string, number>();
  for (const r of salesRes.data ?? []) sales.set(norm(r["Place ID"]), Number(r.SalesValue) || 0);

  const sales12 = new Set<string>();
  for (const r of sales12Res.data ?? []) sales12.add(norm(r["Place ID"]));

  const master = new Map<string, ImsStore>();
  for (const r of masterRes.data ?? []) master.set(norm(r["Store Code"]), r);

  const map = buildStoreMap({ stores, sales, sales12, master });

  return {
    ...map,
    // Stamped so a stale snapshot is visible rather than silently believed.
    fetchedAt: new Date().toISOString(),
    monthsBack,
    totals: {
      appStores: stores.length,
      imsSalesCodes: sales.size,
      imsMasterCodes: master.size,
      ghosts: map.ghosts.length,
    },
  };
}

export async function saveImsSnapshot(snapshot: ImsSnapshot): Promise<void> {
  await put(KEY, JSON.stringify(snapshot), {
    // PRIVATE, like every other blob this app writes. It holds outlet-level
    // client sales; a public blob URL is readable by anyone who learns it.
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

/**
 * Read the cached map. Returns null when it has never been built.
 *
 * Addressed with get() by key rather than list(), so a fresh write is readable
 * immediately and there is no index to go stale.
 */
export async function getImsSnapshot(): Promise<ImsSnapshot | null> {
  const result = await get(KEY, { access: "private", useCache: false });
  if (!result) return null;
  const text = await new Response(result.stream).text();
  if (!text.trim()) return null;
  return JSON.parse(text) as ImsSnapshot;
}
