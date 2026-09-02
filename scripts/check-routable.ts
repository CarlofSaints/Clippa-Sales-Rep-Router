/**
 * Assertions for which stores a rep may be sent to.
 *
 * Run: npx tsx scripts/check-routable.ts
 *
 * Three rules compose here — closed, channel, override — and the ones that
 * matter most are where they DISAGREE: a shut store in a rep channel, an open
 * store in an excluded channel, and the single store a manager has excused from
 * that exclusion. Getting the last one wrong silently strands the exception
 * Ago made on purpose.
 */

import {
  isRepChannel,
  approvedOverrideStoreIds,
  routableStores,
  countExclusions,
  callPolicy,
  exclusionReason,
  storeCountsByChannel,
} from "../lib/routable";
import type { Channel, Store, StoreOverride, SubChannel } from "../lib/types";

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`PASS  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}${detail ? `  — ${detail}` : ""}`);
  }
}
const eq = (label: string, actual: unknown, expected: unknown) =>
  ok(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

const channel = (id: string, o: Partial<Channel> = {}): Channel => ({
  id,
  name: o.name ?? id,
  frequency: o.frequency ?? "monthly",
  duration: o.duration ?? 30,
  ...(o.notARepChannel !== undefined ? { notARepChannel: o.notARepChannel } : {}),
});

const store = (id: string, channelId: string, o: Partial<Store> = {}): Store => ({
  id,
  placeId: id,
  name: `Store ${id}`,
  channelId,
  repCode: o.repCode ?? "R1",
  gpsLat: "-26",
  gpsLng: "28",
  monthlySales: 0,
  frequency: "monthly",
  duration: 30,
  dayOfWeek: "",
  weekNumber: "",
  ...o,
});

const override = (storeId: string, status: "pending" | "approved"): StoreOverride => ({
  id: `o-${storeId}`,
  storeId,
  storeName: `Store ${storeId}`,
  placeId: storeId,
  channelId: "makro",
  repCode: "R1",
  defaultFrequency: "monthly",
  defaultDuration: 30,
  frequency: "weekly",
  duration: 45,
  approvalStatus: status,
  createdBy: "test",
  createdAt: "",
  updatedAt: "",
});

const CHANNELS = [channel("indep"), channel("makro", { notARepChannel: true })];

// ── The flag reads the safe way round ───────────────────────────────────────
{
  // 🔴 Absent means a rep channel. Every channel in the live app predates this
  // field; if absence excluded them, shipping it would empty every call cycle.
  ok("a channel with no flag is called on", isRepChannel(channel("c")));
  ok("an explicit false is called on", isRepChannel(channel("c", { notARepChannel: false })));
  ok("only an explicit true excludes", !isRepChannel(channel("c", { notARepChannel: true })));
  // A store whose channel was deleted must keep being visited rather than
  // silently vanish from every route.
  ok("an unknown channel is called on", isRepChannel(undefined));
}

// ── Only an APPROVED override excuses a store ───────────────────────────────
{
  const ids = approvedOverrideStoreIds([override("a", "approved"), override("b", "pending")]);
  ok("an approved override counts", ids.has("a"));
  // Otherwise anyone who can raise an override can undo a channel exclusion for
  // themselves, without a manager ever seeing it.
  ok("a PENDING override does not", !ids.has("b"), "pending must not excuse a store");
}

// ── The three rules together ────────────────────────────────────────────────
{
  const stores = [
    store("open-indep", "indep"),
    store("shut-indep", "indep", { closed: true, closedReason: "manual" }),
    store("open-makro", "makro"),
    store("excused-makro", "makro"),
    store("pending-makro", "makro"),
    store("shut-makro", "makro", { closed: true, closedReason: "manual" }),
  ];
  const overrides = [override("excused-makro", "approved"), override("pending-makro", "pending")];

  const routable = routableStores({ stores, channels: CHANNELS, overrides }).map((s) => s.id).sort();
  eq("only the open, called-on and excused stores route", routable, ["excused-makro", "open-indep"]);

  const byId = new Map(CHANNELS.map((c) => [c.id, c]));
  const excused = approvedOverrideStoreIds(overrides);
  eq("an ordinary store has no reason", exclusionReason(stores[0], byId, excused), null);
  eq("a shut store says closed", exclusionReason(stores[1], byId, excused), "closed");
  eq("an excluded channel says so", exclusionReason(stores[2], byId, excused), "channel_not_called_on");
  eq("an excused store has no reason", exclusionReason(stores[3], byId, excused), null);
  eq("a pending override does not excuse", exclusionReason(stores[4], byId, excused), "channel_not_called_on");

  // 🔴 Closure wins over the channel. Reporting a shut store as a channel
  // problem sends somebody to fix the wrong thing — and un-excluding the
  // channel would not bring it back, because it is still shut.
  eq("a shut store in an excluded channel reads as closed", exclusionReason(stores[5], byId, excused), "closed");

  const counts = countExclusions({ stores, channels: CHANNELS, overrides });
  eq("the split is counted, not hidden", counts, {
    routable: 2,
    closed: 2,
    channelNotCalledOn: 2,
    excusedByOverride: 1,
  });
}

// ── An override on a NORMAL channel is not an "exception" ───────────────────
{
  // Overrides mostly exist to change frequency, and most are on channels reps
  // already call on. Counting those as exceptions would report hundreds where
  // there are none.
  const stores = [store("a", "indep"), store("b", "indep")];
  const counts = countExclusions({
    stores,
    channels: CHANNELS,
    overrides: [override("a", "approved")],
  });
  eq("an override on a called-on channel is not counted as an exception", counts.excusedByOverride, 0);
  eq("and both stores still route", counts.routable, 2);
}

// ── What the Channels page shows before anyone ticks anything ───────────────
{
  const stores = [
    store("a", "makro"),
    store("b", "makro"),
    store("c", "makro", { closed: true, closedReason: "manual" }),
    store("d", "indep"),
  ];
  const counts = storeCountsByChannel(stores, [override("a", "approved")]);
  eq("total counts every store in the channel", counts.get("makro")?.total, 3);
  // The number that matters when deciding: closed stores are already out.
  eq("open excludes the shut ones", counts.get("makro")?.open, 2);
  eq("excused counts the exceptions in force", counts.get("makro")?.excused, 1);
  eq("a channel nobody has touched still reports", counts.get("indep")?.open, 1);
}

// ── Nothing configured ──────────────────────────────────────────────────────
{
  eq("no stores is not an error", routableStores({ stores: [], channels: [], overrides: [] }), []);
  // No channels loaded must not silently exclude the whole store base.
  const stores = [store("a", "indep")];
  eq(
    "no channels loaded still routes everything",
    routableStores({ stores, channels: [], overrides: [] }).length,
    1
  );
}


// -- Channel vs sub-channel: the most specific setting wins ------------------
//
// Pick n Pay is the case that forces this. Some formats are visited and some
// order automatically, so a sub-channel must be able to override its parent in
// BOTH directions, and "no opinion" has to stay distinct from "called on".
{
  const sub = (id: string, channelId: string, notARepChannel?: boolean): SubChannel => ({
    id, name: id, channelId,
    ...(notARepChannel === undefined ? {} : { notARepChannel }),
  });

  const CH = [channel("pnp"), channel("makro", { notARepChannel: true })];
  const SUBS = [
    sub("pnp_hyper", "pnp", true),      // excluded inside a channel reps DO call on
    sub("pnp_express", "pnp", false),   // explicitly called on
    sub("pnp_family", "pnp"),           // no opinion: follow the channel
    sub("makro_liquor", "makro", false),// called on inside an EXCLUDED channel
    sub("makro_food", "makro"),         // no opinion: follow the channel
  ];
  const chById = new Map(CH.map((c) => [c.id, c]));
  const subById = new Map(SUBS.map((c) => [c.id, c]));

  const at = (channelId: string, subChannelId?: string) =>
    callPolicy(store("s", channelId, subChannelId ? { subChannelId } : {}), chById, subById);

  // Inside a channel reps call on.
  ok("a sub-channel can be excluded inside a channel reps call on", at("pnp", "pnp_hyper").calledOn === false);
  eq("and says the sub-channel decided it", at("pnp", "pnp_hyper").decidedBy, "sub_channel");
  ok("a sub-channel with no opinion follows its channel", at("pnp", "pnp_family").calledOn === true);
  eq("and says the CHANNEL decided it", at("pnp", "pnp_family").decidedBy, "default");

  // 🔴 The other direction. Without this, excluding Makro would strand a
  // format the client genuinely visits, and the only fix would be a per-store
  // override on every branch.
  ok("a sub-channel can be CALLED ON inside an excluded channel", at("makro", "makro_liquor").calledOn === true);
  eq("and says the sub-channel decided it", at("makro", "makro_liquor").decidedBy, "sub_channel");
  ok("a sub-channel with no opinion inherits the exclusion", at("makro", "makro_food").calledOn === false);
  eq("and says the channel decided it", at("makro", "makro_food").decidedBy, "channel");

  // A store with no sub-channel at all is the common case and must be untouched.
  ok("no sub-channel means follow the channel", at("makro").calledOn === false);
  ok("and in a called-on channel it still routes", at("pnp").calledOn === true);

  // A dangling id must not silently exclude the store.
  ok("a sub-channel id that no longer exists falls back to the channel", at("pnp", "gone").calledOn === true);

  // The whole pipeline, not just the policy.
  const stores = [
    store("a", "pnp", { subChannelId: "pnp_hyper" }),
    store("b", "pnp", { subChannelId: "pnp_express" }),
    store("c", "pnp"),
    store("d", "makro", { subChannelId: "makro_liquor" }),
    store("e", "makro"),
  ];
  const routable = routableStores({ stores, channels: CH, overrides: [], subChannels: SUBS })
    .map((s) => s.id).sort();
  eq("the pipeline honours both directions", routable, ["b", "c", "d"]);

  // Passing no sub-channels must behave exactly as before the feature existed.
  const withoutSubs = routableStores({ stores, channels: CH, overrides: [] }).map((s) => s.id).sort();
  eq("with no sub-channels configured, only the channel decides", withoutSubs, ["a", "b", "c"]);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
