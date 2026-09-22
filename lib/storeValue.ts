/**
 * What a store is worth, for every decision that has to rank one against
 * another — which calls survive a full day, and the ranks shown on the map.
 *
 * 🔴 The number that makes this hard: **2 727 of 7 080 stores (38.5%) have no
 * sales figure at all.** IMS has never given us one. Sorting by sales and
 * keeping the top N would put every one of those at the bottom of every day,
 * every time, and they would never be visited again. "No figure" is not
 * "worthless" — it is far more often a new outlet or an unmatched code.
 *
 * So an unknown store is ranked as TYPICAL: it takes the median of the known
 * values around it. It loses to a better-than-average shop and beats a
 * worse-than-average one, which is the honest thing to do with no information.
 * A store IMS has actually reported as zero is different — that is a real
 * signal, and it sorts to the bottom where it belongs.
 */

import type { Store } from "./types";

/**
 * Six months of in-market sales, or null when nobody has told us.
 *
 * `sixMonthSales` is the figure IMS supplies; `monthlySales` is that number
 * divided by six and kept under its old key. They never disagree on the live
 * data, so either answers the question — but only when one of them is actually
 * present. Null is returned rather than 0 so callers must decide what an
 * unknown means to them. See [[absence-is-a-value-render-it]].
 */
export function knownSixMonthSales(store: Store): number | null {
  if (store.sixMonthSales != null && Number.isFinite(Number(store.sixMonthSales))) {
    return Number(store.sixMonthSales);
  }
  const monthly = Number(store.monthlySales);
  if (Number.isFinite(monthly) && monthly > 0) return monthly * 6;
  return null;
}

/** The median of the stores that DO have a figure, or 0 when none do. */
export function medianKnownValue(stores: Store[]): number {
  const known = stores
    .map(knownSixMonthSales)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  if (known.length === 0) return 0;
  const mid = Math.floor(known.length / 2);
  return known.length % 2 ? known[mid] : (known[mid - 1] + known[mid]) / 2;
}

/**
 * The number a store is ranked on: its own value, or the median when unknown.
 *
 * `median` is computed over the REP's own stores rather than the whole base,
 * so a rep working a quieter patch does not have every one of their unknowns
 * outranked by another province's averages.
 */
export function rankingValue(store: Store, median: number): number {
  return knownSixMonthSales(store) ?? median;
}

/**
 * Order stores best-first for deciding which calls survive a full day.
 *
 * 🔴 Ties are broken on store id, never left to the order the array happened to
 * arrive in. Whole channels share a value of exactly 0, and an unstable tie
 * would mean regenerating with no data change silently swapped which of them
 * got visited. See [[stale-total-after-trimming-the-last-row]] for the sibling
 * lesson about order-dependent results.
 */
export function byValueDesc(median: number) {
  return (a: Store, b: Store): number => {
    const d = rankingValue(b, median) - rankingValue(a, median);
    return d !== 0 ? d : a.id.localeCompare(b.id);
  };
}

/**
 * Split a day's stores into the ones that are kept and the ones that are not.
 *
 * Keeping is by value; the DRIVING ORDER of the keepers is decided afterwards
 * by the router, which is why this returns sets rather than a sequence. Picking
 * the keepers before the day is built is also what stops the legs going stale:
 * the day is optimised once, from the stores it will actually contain.
 */
export function splitByValue(
  stores: Store[],
  keepCount: number,
  median: number
): { keep: Store[]; drop: Store[] } {
  if (keepCount >= stores.length) return { keep: stores, drop: [] };
  if (keepCount <= 0) return { keep: [], drop: stores };
  const ranked = [...stores].sort(byValueDesc(median));
  return { keep: ranked.slice(0, keepCount), drop: ranked.slice(keepCount) };
}
