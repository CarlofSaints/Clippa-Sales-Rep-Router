import { Rep, Store } from "./types";

/**
 * Who owns the store base, and who is missing.
 *
 * Stores are allocated to reps by `store.repCode` — that string IS the link, and
 * nothing validates it against the rep list. So a store can name a rep the app
 * has never heard of, and it then vanishes quietly: it is not on the map, not in
 * anyone's route, and not counted in capacity. Nothing on any screen said so.
 *
 * Read off live data on 25 Aug 2026: 34 distinct rep codes across 6 655 stores,
 * 17 with a rep record and 17 without, the unmatched ones covering 2 570 stores.
 * Every one of the app's own reps was in Gauteng, Mpumalanga or KZN — the Cape,
 * Free State, Northern Cape and North West had simply never been loaded.
 */

export interface UnmatchedRepCode {
  repCode: string;
  storeCount: number;
  /** Where those stores are, most common first. Blank entries are dropped. */
  provinces: string[];
  regions: string[];
  storesWithBadGps: number;
}

export interface IdleRep {
  id: string;
  code: string;
  name: string;
  email: string;
}

export interface CoverageSummary {
  totalStores: number;
  totalReps: number;
  /** Distinct non-blank rep codes appearing on stores. */
  distinctCodesOnStores: number;
  matchedCodes: number;
  unmatchedCodes: number;
  storesOnMatchedReps: number;
  storesOnUnmatchedCodes: number;
  storesWithNoRepCode: number;
  /** The share of the base the app can actually route, 0-100. */
  coveragePercent: number;
}

export interface CoverageReport {
  summary: CoverageSummary;
  unmatched: UnmatchedRepCode[];
  idleReps: IdleRep[];
}

/** The same range check the route engine uses, so the two never disagree. */
function hasUsableGps(store: Store): boolean {
  const lat = Number(String(store.gpsLat ?? "").trim());
  const lng = Number(String(store.gpsLng ?? "").trim());
  if (!String(store.gpsLat ?? "").trim() || !String(store.gpsLng ?? "").trim()) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  // Roughly South Africa's bounding box, which is what "outside SA" means here.
  return lat >= -35 && lat <= -21 && lng >= 15 && lng <= 34;
}

function rank(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = (v || "").trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

export function buildCoverageReport(reps: Rep[], stores: Store[]): CoverageReport {
  const knownCodes = new Set(reps.map((r) => (r.code || "").trim().toUpperCase()).filter(Boolean));

  const byCode = new Map<string, Store[]>();
  let storesWithNoRepCode = 0;

  for (const store of stores) {
    const code = (store.repCode || "").trim();
    if (!code) {
      storesWithNoRepCode++;
      continue;
    }
    const key = code.toUpperCase();
    byCode.set(key, [...(byCode.get(key) || []), store]);
  }

  const unmatched: UnmatchedRepCode[] = [];
  let storesOnMatchedReps = 0;
  let storesOnUnmatchedCodes = 0;

  for (const [code, group] of byCode) {
    if (knownCodes.has(code)) {
      storesOnMatchedReps += group.length;
      continue;
    }
    storesOnUnmatchedCodes += group.length;
    unmatched.push({
      repCode: code,
      storeCount: group.length,
      provinces: rank(group.map((s) => s.province || "")),
      regions: rank(group.map((s) => s.region || "")),
      storesWithBadGps: group.filter((s) => !hasUsableGps(s)).length,
    });
  }

  unmatched.sort((a, b) => b.storeCount - a.storeCount || a.repCode.localeCompare(b.repCode));

  // A rep with no stores is the mirror-image problem: they are on the payroll of
  // the app but route nothing, which usually means their code was retyped.
  const idleReps: IdleRep[] = reps
    .filter((r) => !byCode.has((r.code || "").trim().toUpperCase()))
    .map((r) => ({ id: r.id, code: r.code, name: r.name, email: r.email || "" }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const totalStores = stores.length;

  return {
    summary: {
      totalStores,
      totalReps: reps.length,
      distinctCodesOnStores: byCode.size,
      matchedCodes: byCode.size - unmatched.length,
      unmatchedCodes: unmatched.length,
      storesOnMatchedReps,
      storesOnUnmatchedCodes,
      storesWithNoRepCode,
      coveragePercent: totalStores === 0 ? 0 : Math.round((storesOnMatchedReps / totalStores) * 1000) / 10,
    },
    unmatched,
    idleReps,
  };
}
