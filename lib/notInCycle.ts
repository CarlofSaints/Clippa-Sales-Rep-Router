/**
 * Why a rep's store is not in their call cycle.
 *
 * "It is not on the route" is not one fact, it is seven, and they call for
 * completely different actions — raise the calls-per-day target, fix a
 * coordinate, confirm an outlier, reopen a shop, or just regenerate. A map that
 * greys out the missing stores without saying which of the seven applies moves
 * the question rather than answering it.
 *
 * Two families sit behind it, and keeping them apart is the point:
 *
 *   NOT ELIGIBLE  — closed, or a channel nobody calls on. Correctly absent.
 *                   Answered by `lib/routable.ts`, the same rule the router
 *                   itself uses, so this screen can never disagree with the
 *                   routes it is describing.
 *   DROPPED       — eligible, and the router still could not place it: over the
 *                   calls-per-day target, over the working day, no usable GPS,
 *                   or too far out to include without a manager saying so.
 *
 * And one that is neither: a store the plan has simply never heard of, because
 * it was loaded after the routes were generated. That one is a stale plan, not
 * a routing decision, and saying "regenerate" is the whole answer.
 */

import type { Channel, RoutePlanDocument, Store, StoreOverride, SubChannel } from "./types";
import { exclusionReason, approvedOverrideStoreIds } from "./routable";

export type NotInCycleReason =
  | "over_target"
  | "over_capacity"
  | "bad_gps"
  | "out_of_range"
  | "closed"
  | "channel_not_called_on"
  | "not_in_plan";

export interface ReasonPresentation {
  /** What is true, in the words a manager would use. */
  label: string;
  /** What to do about it, or null when the answer is "nothing, this is right". */
  action: string | null;
  /** Hex, for the map dot and the legend swatch. */
  colour: string;
  /**
   * 🔴 False when the store cannot be drawn at all.
   *
   * A store excluded for having no usable GPS has, by definition, nowhere to be
   * plotted. If the panel counts it and the map cannot show it, the map is
   * short by exactly the stores the panel is drawing attention to. It is
   * counted and named in the panel instead of being silently dropped.
   */
  plottable: boolean;
  /** Ordering in the legend: what a manager can act on comes first. */
  rank: number;
}

export const REASONS: Record<NotInCycleReason, ReasonPresentation> = {
  over_target: {
    label: "Over the calls-per-day target",
    action: "Raise the target, or move the store to another rep.",
    colour: "#DC2626",
    plottable: true,
    rank: 1,
  },
  over_capacity: {
    label: "Over the working day",
    action: "The day ran out of hours before this store was reached.",
    colour: "#EA580C",
    plottable: true,
    rank: 2,
  },
  out_of_range: {
    label: "Too far outside the rep's area",
    action: "Confirm it on the Routes page to force it into the cycle.",
    colour: "#D97706",
    plottable: true,
    rank: 3,
  },
  bad_gps: {
    label: "No usable coordinates",
    action: "Fix the GPS on the Routes page, then regenerate.",
    colour: "#7C3AED",
    plottable: false,
    rank: 4,
  },
  not_in_plan: {
    label: "Loaded after these routes were generated",
    action: "Regenerate routes to bring it into the cycle.",
    colour: "#2563EB",
    plottable: true,
    rank: 5,
  },
  channel_not_called_on: {
    label: "In a channel nobody calls on",
    action: null,
    colour: "#6B7280",
    plottable: true,
    rank: 6,
  },
  closed: {
    label: "Closed",
    action: null,
    colour: "#9CA3AF",
    plottable: true,
    rank: 7,
  },
};

/** The two reasons that mean the store is right to be absent. */
export function isCorrectlyOut(reason: NotInCycleReason): boolean {
  return reason === "closed" || reason === "channel_not_called_on";
}

export interface NotInCycleInput {
  stores: Store[];
  channels: Channel[];
  overrides: StoreOverride[];
  subChannels?: SubChannel[];
  routes: RoutePlanDocument | null;
  /** Restrict to one rep, or leave out for every rep in scope. */
  repCode?: string;
  /** Rep codes the signed-in user may see. */
  visibleRepCodes?: Set<string>;
}

export interface NotInCycleStore {
  store: Store;
  reason: NotInCycleReason;
}

export interface NotInCycleResult {
  /** Every store of the rep's that no day of the cycle visits. */
  missing: NotInCycleStore[];
  reasonOf: Map<string, NotInCycleReason>;
  counts: Record<NotInCycleReason, number>;
  /** Stores the rep owns, after user scoping. The denominator. */
  totalStores: number;
  /** Stores the cycle DOES visit at least once. */
  scheduled: number;
  /**
   * Counted separately because the map physically cannot draw them — see
   * `plottable`. The panel says so rather than letting the dots disagree with
   * the count.
   */
  notPlottable: number;
}

/**
 * ⚠️ `stats.unassignedStores` holds one entry per DROPPED VISIT, not per store,
 * and carries no week. A weekly store dropped from three weeks appears three
 * times, and a store dropped from Wk3 while kept in Wk1 appears there too while
 * still being genuinely in the cycle.
 *
 * So it can only be consulted for stores the cycle visits NOWHERE. For those,
 * the first reason recorded is the reason — they were all the same decision.
 */
function reasonFromUnassigned(text: string): NotInCycleReason {
  const t = text.toLowerCase();
  if (t.includes("calls per day")) return "over_target";
  if (t.includes("daily capacity")) return "over_capacity";
  if (t.includes("out of range")) return "out_of_range";
  if (t.includes("gps") || t.includes("coordinates")) return "bad_gps";
  // A reason the plan records that this file has never seen. Treating it as a
  // stale plan is wrong, so it is reported as a capacity drop — the honest
  // default, and the one a manager can act on.
  return "over_capacity";
}

export function findNotInCycle({
  stores,
  channels,
  overrides,
  subChannels = [],
  routes,
  repCode,
  visibleRepCodes,
}: NotInCycleInput): NotInCycleResult {
  const channelsById = new Map(channels.map((c) => [c.id, c]));
  const subById = new Map(subChannels.map((c) => [c.id, c]));
  const excused = approvedOverrideStoreIds(overrides);

  const mine = stores.filter((s) => {
    if (repCode && s.repCode !== repCode) return false;
    if (visibleRepCodes && !visibleRepCodes.has(s.repCode)) return false;
    return true;
  });

  // Every store the cycle visits at least once, across ALL four weeks and all
  // five days. 🔴 Deliberately ignores any week or day filter on screen: the
  // question is "never visited", and a store visited only in Wk3 is in the
  // cycle even while you are looking at Wk1.
  const visited = new Set<string>();
  const droppedReason = new Map<string, string>();
  for (const plan of routes?.repPlans ?? []) {
    if (repCode && plan.repCode !== repCode) continue;
    if (visibleRepCodes && !visibleRepCodes.has(plan.repCode)) continue;
    for (const dp of plan.days) for (const stop of dp.stops) visited.add(stop.storeId);
    for (const u of plan.stats.unassignedStores) {
      if (!droppedReason.has(u.storeId)) droppedReason.set(u.storeId, u.reason);
    }
  }

  const missing: NotInCycleStore[] = [];
  const reasonOf = new Map<string, NotInCycleReason>();
  const counts = Object.fromEntries(
    Object.keys(REASONS).map((k) => [k, 0])
  ) as Record<NotInCycleReason, number>;
  let scheduled = 0;
  let notPlottable = 0;

  for (const store of mine) {
    if (visited.has(store.id)) {
      scheduled++;
      continue;
    }

    // Not eligible in the first place beats anything the router did with it: a
    // shut shop reported as "over the calls-per-day target" would send somebody
    // to raise a target that was never the problem.
    const excluded = exclusionReason(store, channelsById, excused, subById);
    const dropped = droppedReason.get(store.id);
    const reason: NotInCycleReason = excluded
      ? excluded
      : dropped
        ? reasonFromUnassigned(dropped)
        : "not_in_plan";

    missing.push({ store, reason });
    reasonOf.set(store.id, reason);
    counts[reason]++;
    if (!REASONS[reason].plottable) notPlottable++;
  }

  missing.sort(
    (a, b) =>
      REASONS[a.reason].rank - REASONS[b.reason].rank ||
      a.store.name.localeCompare(b.store.name)
  );

  return { missing, reasonOf, counts, totalStores: mine.length, scheduled, notPlottable };
}
