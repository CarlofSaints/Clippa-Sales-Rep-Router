import "server-only";
import { get, put } from "@vercel/blob";
import fs from "fs";
import path from "path";
import { sqlQuery } from "./sqlProxy";
import { getStores } from "./data";
import { norm, reconcile, type ImsStore, type ReconResult } from "./imsReconCore";
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

/**
 * The reconciliation, cached beside the map.
 *
 * Kept in its OWN blob rather than folded into the map. Both are computed from
 * the same three queries, so building them together is free — but the map is
 * read by the Stores page, the busiest screen in the app, and it has no use for
 * six thousand reconciliation rows. Merging them would make every Stores page
 * load carry roughly twice the bytes for data it never renders.
 */
const RECON_KEY = "ims-recon.json";

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

export interface ImsReconSnapshot {
  fetchedAt: string;
  monthsBack: number;
  result: ReconResult;
}

interface ImsSale {
  "Place ID": string;
  SalesValue: number;
}

/**
 * Fetch from SQL and compute BOTH cached products in one pass.
 *
 * The map and the reconciliation were built by two separate routes that each ran
 * the same three queries, so opening the reconciliation page cost a second full
 * pull of the ten megabyte outlet master. They are derived from identical
 * inputs, so that second pull was pure waste — and it was the one that ran on
 * every page load, which is what made a slow IMS server look like a broken page.
 *
 * Slow on purpose: this is now the only thing that pays for SQL, and it is
 * called from a button, never from a page render.
 */
export async function buildImsSnapshot(
  monthsBack = 6
): Promise<{ snapshot: ImsSnapshot; recon: ImsReconSnapshot }> {
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
  const result = reconcile(stores, sales, sales12, master, monthsBack);

  // One timestamp for both, because they describe the same instant. Two clocks
  // would let the reconciliation page and the Stores grid disagree about how old
  // the very same pull is.
  const fetchedAt = new Date().toISOString();

  return {
    snapshot: {
      ...map,
      // Stamped so a stale snapshot is visible rather than silently believed.
      fetchedAt,
      monthsBack,
      totals: {
        appStores: stores.length,
        imsSalesCodes: sales.size,
        imsMasterCodes: master.size,
        ghosts: map.ghosts.length,
      },
    },
    recon: { fetchedAt, monthsBack, result },
  };
}

/**
 * Blob in production, a local `data/` file when there is no token.
 *
 * The same dual mode `lib/data.ts` has had all along, and for the same reason:
 * without it the IMS half of this app — the Stores grid's Map Status and
 * IMS-only rows, the Map, Rep Sales & Activity, the reconciliation — cannot be
 * run or checked locally at all, because every one of them reads this cache.
 *
 * Keyed off the token exactly like lib/data.ts, so on any deployment the local
 * branch is unreachable.
 */
const useBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;
const localPath = (key: string) => path.join(process.cwd(), "data", key);

async function readSnapshotJSON<T>(key: string): Promise<T | null> {
  if (useBlob()) {
    const result = await get(key, { access: "private", useCache: false });
    if (!result) return null;
    const text = await new Response(result.stream).text();
    if (!text.trim()) return null;
    return JSON.parse(text) as T;
  }
  try {
    const raw = fs.readFileSync(localPath(key), "utf-8");
    return raw.trim() ? (JSON.parse(raw) as T) : null;
  } catch {
    // Never built locally is the same answer as never built at all.
    return null;
  }
}

async function writeSnapshotJSON(key: string, value: unknown): Promise<void> {
  const body = JSON.stringify(value);
  if (useBlob()) {
    await put(key, body, {
      // PRIVATE, like every other blob this app writes. It holds outlet-level
      // client sales; a public blob URL is readable by anyone who learns it.
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return;
  }
  const dir = path.dirname(localPath(key));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(localPath(key), body, "utf-8");
}
export async function saveImsSnapshot(snapshot: ImsSnapshot): Promise<void> {
  await writeSnapshotJSON(KEY, snapshot);
}

export async function saveImsRecon(recon: ImsReconSnapshot): Promise<void> {
  await writeSnapshotJSON(RECON_KEY, recon);
}

/**
 * Read the cached map. Returns null when it has never been built.
 *
 * Addressed with get() by key rather than list(), so a fresh write is readable
 * immediately and there is no index to go stale.
 */
export async function getImsSnapshot(): Promise<ImsSnapshot | null> {
  return readSnapshotJSON<ImsSnapshot>(KEY);
}

/** Read the cached reconciliation. Null when it has never been built. */
export async function getImsRecon(): Promise<ImsReconSnapshot | null> {
  return readSnapshotJSON<ImsReconSnapshot>(RECON_KEY);
}
