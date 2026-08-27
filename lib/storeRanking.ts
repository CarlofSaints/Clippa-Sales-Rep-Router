import type { Store } from "./types";

/**
 * The three rank columns on the Stores page: overall, within a rep, within a
 * channel.
 *
 * Now driven by the rolling six-month IMS figure. That does not change the
 * ORDER — `monthlySales` is defined as `sixMonthSales / 6`, and dividing every
 * value by the same constant cannot reorder anything — but it does fix two real
 * defects in the old inline version:
 *
 * 🔴 It ranked on `monthlySales ?? 0`, so a store IMS has never heard of was
 *    ranked as though it had sold exactly zero. With 44% of the store base
 *    carrying no figure, most of the rank column was fiction that looked like
 *    fact. Those stores are now UNRANKED and render as a dash.
 *
 * 🔴 Equal values took sequential ranks, so two stores on the same turnover
 *    were arbitrarily 41st and 42nd depending on array order. Ties now share a
 *    rank.
 */

/**
 * What a store is ranked on, or null when it should not be ranked at all.
 *
 * Prefers the IMS six-month figure. Falls back to the stored monthly average
 * scaled back up, because until the sales are applied most stores still carry
 * only the human-entered average and blanking every rank in the meantime would
 * be a regression.
 *
 * ⚠️ A six-month figure of 0 IS data — it means the outlet bought nothing — and
 * ranks last. A monthly average of 0 with no six-month figure is NOT: that is
 * the value the old Store Upload bug wrote over thousands of rows, so it is
 * treated as unknown rather than trusted as a zero.
 */
export function salesForRanking(store: Store): number | null {
  if (store.sixMonthSales !== undefined && store.sixMonthSales !== null) return store.sixMonthSales;
  const monthly = store.monthlySales;
  if (typeof monthly === "number" && monthly > 0) return monthly * 6;
  return null;
}

/**
 * Competition ranking, highest value first: 1, 2, 2, 4.
 *
 * Stores with no figure are left out of the map entirely rather than given a
 * trailing rank, so the caller renders a dash and nobody reads a position that
 * was never earned.
 */
function rankGroup(stores: Store[], into: Map<string, number>): void {
  const rankable = stores
    .map((s) => ({ id: s.id, value: salesForRanking(s) }))
    .filter((x): x is { id: string; value: number } => x.value !== null)
    .sort((a, b) => b.value - a.value);

  let lastValue: number | null = null;
  let lastRank = 0;
  rankable.forEach((x, i) => {
    if (lastValue !== null && x.value === lastValue) {
      into.set(x.id, lastRank);
      return;
    }
    lastRank = i + 1;
    lastValue = x.value;
    into.set(x.id, lastRank);
  });
}

export interface StoreRankings {
  /** Store id to rank. A store absent from a map has no figure and is unranked. */
  overallRank: Map<string, number>;
  repRank: Map<string, number>;
  channelRank: Map<string, number>;
  /** How many stores carry a figure at all, for explaining a column full of dashes. */
  rankedCount: number;
  unrankedCount: number;
}

export function rankStores(stores: Store[]): StoreRankings {
  const overallRank = new Map<string, number>();
  const repRank = new Map<string, number>();
  const channelRank = new Map<string, number>();

  rankGroup(stores, overallRank);

  const byRep = new Map<string, Store[]>();
  const byChannel = new Map<string, Store[]>();
  for (const s of stores) {
    const r = byRep.get(s.repCode);
    if (r) r.push(s);
    else byRep.set(s.repCode, [s]);

    const c = byChannel.get(s.channelId);
    if (c) c.push(s);
    else byChannel.set(s.channelId, [s]);
  }
  byRep.forEach((group) => rankGroup(group, repRank));
  byChannel.forEach((group) => rankGroup(group, channelRank));

  return {
    overallRank,
    repRank,
    channelRank,
    rankedCount: overallRank.size,
    unrankedCount: stores.length - overallRank.size,
  };
}
