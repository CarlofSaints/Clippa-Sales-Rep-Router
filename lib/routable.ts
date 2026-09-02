import type { Channel, Store, StoreOverride, SubChannel } from "./types";
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

/** Where the answer for a store came from, so a screen can explain itself. */
export type CallPolicySource = "sub_channel" | "channel" | "default";

export interface CallPolicy {
  calledOn: boolean;
  decidedBy: CallPolicySource;
  /** The sub-channel or channel that settled it, for showing in the UI. */
  decidedByName: string | null;
}

/**
 * Whether reps call on a store, before any per-store override.
 *
 * 🔴 THE MOST SPECIFIC SETTING WINS, and it wins in BOTH directions. Pick n Pay
 * is the case that forces it: some of its formats are visited and some order
 * automatically, so a sub-channel has to be able to be excluded inside a channel
 * reps call on, AND called on inside one they do not.
 *
 * The sub-channel therefore has three states and its absence is meaningful:
 *
 *   sub-channel says true    → excluded, whatever the channel says
 *   sub-channel says false   → called on, whatever the channel says
 *   sub-channel says nothing → inherit the channel
 *   no sub-channel at all    → inherit the channel
 *
 * Collapsing "says nothing" into false would make inheritance impossible to
 * express, and every sub-channel the IMS import creates would silently pin
 * itself to "called on" the moment its parent was excluded.
 *
 * The resolution order is written down HERE and nowhere else. A rule this shape
 * is exactly the kind that gets re-implemented slightly differently somewhere
 * else and then quietly disagrees with itself.
 */
export function callPolicy(
  store: Store,
  channelsById: Map<string, Channel>,
  subChannelsById: Map<string, SubChannel>
): CallPolicy {
  const sub = store.subChannelId ? subChannelsById.get(store.subChannelId) : undefined;
  if (sub && sub.notARepChannel !== undefined) {
    return {
      calledOn: sub.notARepChannel !== true,
      decidedBy: "sub_channel",
      decidedByName: sub.name,
    };
  }
  const channel = channelsById.get(store.channelId);
  if (channel && channel.notARepChannel !== undefined) {
    return {
      calledOn: channel.notARepChannel !== true,
      decidedBy: "channel",
      decidedByName: channel.name,
    };
  }
  // Nothing has said. Reps call on it: the safe direction, and where every store
  // in this app sat before any of these flags existed.
  return { calledOn: true, decidedBy: "default", decidedByName: null };
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
  /** Optional, so every existing caller keeps working with none configured. */
  subChannels?: SubChannel[];
}

/** Why a store is not being visited, or null when it is. */
export type ExclusionReason = "closed" | "channel_not_called_on";

export function exclusionReason(
  store: Store,
  channelsById: Map<string, Channel>,
  excused: Set<string>,
  subChannelsById: Map<string, SubChannel> = new Map()
): ExclusionReason | null {
  // Closure wins. A shut shop in a rep channel is still shut, and reporting it
  // as a channel problem would send somebody to fix the wrong thing.
  if (isClosed(store)) return "closed";
  if (callPolicy(store, channelsById, subChannelsById).calledOn) return null;
  // Nobody calls on it, but this one store was excused by a manager.
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
export function routableStores({ stores, channels, overrides, subChannels = [] }: RoutableInput): Store[] {
  const byId = new Map(channels.map((c) => [c.id, c]));
  const subById = new Map(subChannels.map((c) => [c.id, c]));
  const excused = approvedOverrideStoreIds(overrides);
  return stores.filter((s) => exclusionReason(s, byId, excused, subById) === null);
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
export function countExclusions({ stores, channels, overrides, subChannels = [] }: RoutableInput): ExclusionCounts {
  const byId = new Map(channels.map((c) => [c.id, c]));
  const subById = new Map(subChannels.map((c) => [c.id, c]));
  const excused = approvedOverrideStoreIds(overrides);

  let routable = 0;
  let closed = 0;
  let channelNotCalledOn = 0;
  let excusedByOverride = 0;

  for (const s of stores) {
    const reason = exclusionReason(s, byId, excused, subById);
    if (reason === "closed") closed++;
    else if (reason === "channel_not_called_on") channelNotCalledOn++;
    else {
      routable++;
      // Counted only where the channel would otherwise have excluded it, so the
      // number answers "how many exceptions are in force", not "how many
      // overrides exist".
      if (!callPolicy(s, byId, subById).calledOn) excusedByOverride++;
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
export function storeCountsBySubChannel(stores: Store[]): Map<string, { total: number; open: number }> {
  const out = new Map<string, { total: number; open: number }>();
  for (const s of stores) {
    if (!s.subChannelId) continue;
    const e = out.get(s.subChannelId) ?? { total: 0, open: 0 };
    e.total++;
    if (!isClosed(s)) e.open++;
    out.set(s.subChannelId, e);
  }
  return out;
}

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
