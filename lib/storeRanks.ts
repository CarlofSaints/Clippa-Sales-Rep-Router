/**
 * Where a store sits in the pecking order, by six months of sales.
 *
 * Three questions, because they answer different things. "47th of 7 080" says
 * whether this is a big shop at all. "3rd of 231" says whether it is big FOR
 * THIS REP, which is what decides whether their day is well spent. "2nd of 8"
 * says whether today's drive was worth making.
 *
 * 🔴 A store with no sales figure is NOT ranked, and must never be shown as
 * last. IMS has never reported a figure for 2 727 of the 7 080 stores (38.5%),
 * and printing "6 812th of 7 080" against a shop nobody has measured invents a
 * fact and reads as a judgement on it. Those stores return null and the card
 * says the figure is missing. See [[absence-is-a-value-render-it]].
 */

import type { Store } from "./types";
import { knownSixMonthSales } from "./storeValue";

export interface StoreRank {
  /** 1-based position among stores that HAVE a figure. */
  position: number;
  /** How many stores were ranked — the denominator, never the whole list. */
  of: number;
}

export interface StoreRanks {
  overall: StoreRank | null;
  rep: StoreRank | null;
}

/**
 * Rank a list best-first, skipping the unmeasured.
 *
 * Ties share a position (two stores on R50k are both 4th) and the next store
 * takes the position after the tied block, which is how a league table reads.
 * Without that, two identical shops would be shown as 4th and 5th and somebody
 * would go looking for the difference.
 */
function rankList(stores: Store[]): Map<string, StoreRank> {
  const measured = stores
    .map((s) => ({ id: s.id, value: knownSixMonthSales(s) }))
    .filter((r): r is { id: string; value: number } => r.value !== null)
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));

  const out = new Map<string, StoreRank>();
  const of = measured.length;
  let position = 0;
  let seen = 0;
  let lastValue: number | null = null;
  for (const r of measured) {
    seen++;
    if (lastValue === null || r.value !== lastValue) {
      position = seen;
      lastValue = r.value;
    }
    out.set(r.id, { position, of });
  }
  return out;
}

/**
 * Overall and per-rep ranks for every store in one pass.
 *
 * Built once for the whole list rather than per popup: ranking 7 080 stores on
 * every hover would sort the base each time a card opened.
 */
export function buildStoreRanks(stores: Store[]): Map<string, StoreRanks> {
  const overall = rankList(stores);

  const byRep = new Map<string, Store[]>();
  for (const s of stores) {
    const code = s.repCode || "";
    const list = byRep.get(code);
    if (list) list.push(s);
    else byRep.set(code, [s]);
  }
  const repRanks = new Map<string, StoreRank>();
  for (const list of byRep.values()) {
    for (const [id, rank] of rankList(list)) repRanks.set(id, rank);
  }

  const out = new Map<string, StoreRanks>();
  for (const s of stores) {
    out.set(s.id, { overall: overall.get(s.id) ?? null, rep: repRanks.get(s.id) ?? null });
  }
  return out;
}

/**
 * Rank within one day's calls — built from the stores actually scheduled.
 *
 * Keyed by day, because a store visited on several days has a different
 * standing on each: third best of Monday's eight and best of Thursday's four.
 */
export function buildDayRanks(
  daysOfStoreIds: { key: string; storeIds: string[] }[],
  storeById: Map<string, Store>
): Map<string, Map<string, StoreRank>> {
  const out = new Map<string, Map<string, StoreRank>>();
  for (const { key, storeIds } of daysOfStoreIds) {
    const stores = storeIds
      .map((id) => storeById.get(id))
      .filter((s): s is Store => !!s);
    out.set(key, rankList(stores));
  }
  return out;
}

/** "3rd of 231", or null when the store has no figure to rank. */
export function formatRank(rank: StoreRank | null): string | null {
  if (!rank) return null;
  const n = rank.position;
  const suffix =
    n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix} of ${rank.of}`;
}
