import type { Channel, Store, StoreOverride } from "./types";
import { isClosed } from "./closedStores";

/**
 * Which stores a rep may actually be sent to.
 *
 * Three separate rules had grown up around this question and only one of them
 * was written down. A store is visited when it is:
 *
 *   1. not closed                       — lib/closedStores.ts
 *   2. in a channel reps call on        — here
 *   3. or, failing 2, individually excused by an approved Call Override
 *
 * They compose here rather than at each call site, because route generation,
 * the capacity page and Data Health each answered the question separately and
 * a page that disagrees with the routes it is describing is worse than no page.
 *
 * ⚠️ Everything here is PURE and takes the channel and override lists as
 * arguments. It decides which shops a rep drives to; it is asserted directly
 * rather than inferred from a screen.
 */

/** Does anybody call on this channel at all? */
export function isRepChannel(channel: Channel | undefined): boolean {
  // Absent means yes. A channel predating the flag, or a store whose channel
  // has been deleted, must keep being visited rather than silently vanish.
  return channel?.notARepChannel !== true;
}

/**
 * Store ids a manager has individually put back into the cycle.
 *
 * 🔴 APPROVED only. An override starts life pending, and a pending one is a
 * request, not a decision — letting it re-include a store would mean anyone who
 * can raise an override can undo a channel-level exclusion for themselves.
 */
export function approvedOverrideStoreIds(overrides: StoreOverride[]): Set<string> {
  return new Set(overrides.filter((o) => o.approvalStatus === "approved").map((o) => o.storeId));
}

export interface RoutableInput {
  stores: Store[];
  channels: Channel[];
  overrides: StoreOverride[];
}

/** Why a store is not being visited, or null when it is. */
export type ExclusionReason = "closed" | "channel_not_called_on";

export function exclusionReason(
  store: Store,
  channelsById: Map<string, Channel>,
  excused: Set<string>
): ExclusionReason | null {
  // Closure wins. A shut shop in a rep channel is still shut, and reporting it
  // as a channel problem would send somebody to fix the wrong thing.
  if (isClosed(store)) return "closed";
  if (isRepChannel(channelsById.get(store.channelId))) return null;
  // The channel is excluded, but this one store was excused by a manager.
  if (excused.has(store.id)) return null;
  return "channel_not_called_on";
}

/**
 * The stores a call cycle may contain.
 *
 * Replaces a bare `activeStores()` at every routing decision. `activeStores`
 * still exists and still means "not shut" — it is one of the three rules, not
 * the whole answer.
 */
export function routableStores({ stores, channels, overrides }: RoutableInput): Store[] {
  const byId = new Map(channels.map((c) => [c.id, c]));
  const excused = approvedOverrideStoreIds(overrides);
  return stores.filter((s) => exclusionReason(s, byId, excused) === null);
}

export interface ExclusionCounts {
  routable: number;
  closed: number;
  channelNotCalledOn: number;
  /** Stores kept in the cycle by an approved override despite their channel. */
  excusedByOverride: number;
}

/**
 * The same split, counted.
 *
 * Reported rather than silently subtracted: "6 813 stores" and "6 813 stores,
 * of which 2 100 are in channels nobody calls on" are different facts, and only
 * the second one explains why a rep's day looks empty.
 */
export function countExclusions({ stores, channels, overrides }: RoutableInput): ExclusionCounts {
  const byId = new Map(channels.map((c) => [c.id, c]));
  const excused = approvedOverrideStoreIds(overrides);

  let routable = 0;
  let closed = 0;
  let channelNotCalledOn = 0;
  let excusedByOverride = 0;

  for (const s of stores) {
    const reason = exclusionReason(s, byId, excused);
    if (reason === "closed") closed++;
    else if (reason === "channel_not_called_on") channelNotCalledOn++;
    else {
      routable++;
      // Counted only where the channel would otherwise have excluded it, so the
      // number answers "how many exceptions are in force", not "how many
      // overrides exist".
      if (!isRepChannel(byId.get(s.channelId))) excusedByOverride++;
    }
  }

  return { routable, closed, channelNotCalledOn, excusedByOverride };
}

/**
 * How many stores each channel holds, and how many of those a flag would drop.
 *
 * Feeds the Channels page, so ticking "not a rep channel" can say what it is
 * about to remove from the cycle BEFORE it is ticked. A count that only appears
 * afterwards is how somebody excludes 1 484 stores by accident.
 */
export function storeCountsByChannel(
  stores: Store[],
  overrides: StoreOverride[]
): Map<string, { total: number; open: number; excused: number }> {
  const excused = approvedOverrideStoreIds(overrides);
  const out = new Map<string, { total: number; open: number; excused: number }>();
  for (const s of stores) {
    const e = out.get(s.channelId) ?? { total: 0, open: 0, excused: 0 };
    e.total++;
    if (!isClosed(s)) e.open++;
    if (!isClosed(s) && excused.has(s.id)) e.excused++;
    out.set(s.channelId, e);
  }
  return out;
}
