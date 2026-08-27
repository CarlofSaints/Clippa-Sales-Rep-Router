/**
 * Assertions for Map Status and the IMS backfill.
 *
 * Run: npx tsx scripts/check-map-status.ts
 *
 * The backfill is the dangerous half: it writes to live stores. Several of these
 * assert that it does NOT write — over a value the app already holds, or into a
 * channel this app has never heard of.
 */

import { buildStoreMap, planBackfill, hasGaps, gapList } from "../lib/mapStatus";
import type { ImsStore } from "../lib/imsReconCore";
import type { Store } from "../lib/types";

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

function store(placeId: string, extra: Partial<Store> = {}): Store {
  return {
    id: placeId,
    placeId,
    name: `Store ${placeId}`,
    channelId: "independent",
    province: "GAUTENG",
    repCode: "GAU001",
    gpsLat: "-26.1",
    gpsLng: "28.1",
    monthlySales: 0,
    ...extra,
  } as Store;
}

function ims(code: string, extra: Partial<ImsStore> = {}): ImsStore {
  return {
    "Store Code": code,
    "Store Name": `IMS ${code}`,
    Province: "GAUTENG",
    "Store Channel": "INDEPENDENT",
    "Store Sub Channel": "",
    Group: "",
    "Store Category": "",
    "Rep Code": "GAU001",
    "Closed Status": "false",
    ...extra,
  };
}

const build = (stores: Store[], sales: [string, number][], sales12: string[], master: [string, ImsStore][]) =>
  buildStoreMap({
    stores,
    sales: new Map(sales),
    sales12: new Set(sales12),
    master: new Map(master),
  });

// ── gap detection ───────────────────────────────────────────────────────────
ok("a complete record has no gaps", !hasGaps(store("A")));
ok("a blank channel is a gap", hasGaps(store("A", { channelId: "" })));
ok("a blank province is a gap", hasGaps(store("A", { province: "" })));
ok("a missing longitude alone is a gap", hasGaps(store("A", { gpsLng: "" })),
  "a latitude without a longitude is no more usable than neither");
ok("whitespace counts as blank", hasGaps(store("A", { channelId: "   " })));
ok("gapList names each missing field",
  gapList(store("A", { channelId: "", gpsLat: "" })).join(",") === "channel,GPS");

// ── the five statuses ───────────────────────────────────────────────────────
{
  const m = build(
    [
      store("MATCH"),
      store("GAPS", { channelId: "", province: "" }),
      store("RRONLY"),
    ],
    [["MATCH", 100], ["GAPS", 50], ["GHOST", 700], ["NOREP", 30]],
    ["MATCH", "GAPS", "GHOST", "NOREP"],
    [
      ["MATCH", ims("MATCH")],
      ["GAPS", ims("GAPS")],
      ["GHOST", ims("GHOST")],
      ["NOREP", ims("NOREP", { "Rep Code": "" })],
    ]
  );

  ok("in both and complete is matched", m.rows.MATCH.status === "matched");
  ok("in both with a blank field is matched_gaps", m.rows.GAPS.status === "matched_gaps");
  ok("in the app only is rr_only", m.rows.RRONLY.status === "rr_only");
  ok("an IMS code with no store becomes a ghost", m.ghosts.some((g) => g.placeId === "GHOST"));
  ok("a ghost with an IMS rep is ims_only",
    m.ghosts.find((g) => g.placeId === "GHOST")!.status === "ims_only");
  ok("a ghost with NO IMS rep is ims_only_no_rep",
    m.ghosts.find((g) => g.placeId === "NOREP")!.status === "ims_only_no_rep");
  ok("a routed store never appears as a ghost", !m.ghosts.some((g) => g.placeId === "MATCH"));
  ok("ghosts are ordered by value", m.ghosts[0].placeId === "GHOST");
  ok("IMS values are carried onto the row", m.rows.MATCH.imsProvince === "GAUTENG");
}

// ── flags ───────────────────────────────────────────────────────────────────
{
  const m = build(
    [
      store("SILENT"),
      store("QUIET"),
      store("SHUT"),
      store("WRONGREP", { repCode: "GAU001" }),
      store("CMRREP", { repCode: "KZN021" }),
    ],
    [],
    ["QUIET"],
    [
      ["SILENT", ims("SILENT")],
      ["QUIET", ims("QUIET")],
      ["SHUT", ims("SHUT", { "Closed Status": "true" })],
      ["WRONGREP", ims("WRONGREP", { "Rep Code": "GAU083" })],
      ["CMRREP", ims("CMRREP", { "Rep Code": "KZN021CMR" })],
    ]
  );
  ok("no sales in twelve months flags noSales", m.rows.SILENT.flags.noSales);
  ok("sales inside twelve months flags dormant, not noSales",
    m.rows.QUIET.flags.dormant && !m.rows.QUIET.flags.noSales);
  ok("closed in IMS is flagged", m.rows.SHUT.flags.closedInIms);
  ok("a different IMS rep is flagged", m.rows.WRONGREP.flags.repMismatch);
  ok("the CMR spelling is NOT flagged", !m.rows.CMRREP.flags.repMismatch,
    "KZN021 and KZN021CMR are one person");
}

// The duplicate-account flag only fires on a distinctive suffix.
{
  const m = build(
    [store("2214-GO38"), store("X-01")],
    [["13175-GO38", 500], ["Y-01", 500]],
    ["13175-GO38", "Y-01"],
    [["2214-GO38", ims("2214-GO38")], ["X-01", ims("X-01")]]
  );
  ok("a distinctive shared suffix flags a duplicate account",
    m.rows["2214-GO38"].flags.duplicateAccount && m.rows["2214-GO38"].twinCode === "13175-GO38");
  ok("a short numeric suffix does NOT",
    !m.rows["X-01"].flags.duplicateAccount,
    "'01' collides by accident and would pair two different shops");
}

// A selling store is never flagged as a duplicate of anything.
{
  const m = build(
    [store("A-GO38")],
    [["A-GO38", 10], ["B-GO38", 999]],
    ["A-GO38"],
    [["A-GO38", ims("A-GO38")]]
  );
  ok("a store with its own sales has no duplicate flag", !m.rows["A-GO38"].flags.duplicateAccount);
  ok("a selling store has no twin", m.rows["A-GO38"].twinCode === null);
}

// ── the backfill ────────────────────────────────────────────────────────────
{
  const stores = [
    store("BLANK", { channelId: "", province: "" }),
    store("HASBOTH", { channelId: "spar-id", province: "LIMPOPO" }),
    store("NOIMS", { channelId: "", province: "" }),
    store("UNKNOWNCHAN", { channelId: "", province: "" }),
  ];
  const master = new Map<string, ImsStore>([
    ["BLANK", ims("BLANK", { "Store Channel": "SPAR", Province: "WESTERN CAPE" })],
    ["HASBOTH", ims("HASBOTH", { "Store Channel": "PICK N PAY", Province: "GAUTENG" })],
    ["UNKNOWNCHAN", ims("UNKNOWNCHAN", { "Store Channel": "COCK N BULL", Province: "WESTERN CAPE" })],
  ]);
  const channelIdFor = (n: string) => (n.trim().toUpperCase() === "SPAR" ? "spar-id" : null);

  const plan = planBackfill(stores, master, channelIdFor);
  const forStore = (id: string) => plan.changes.find((c) => c.placeId === id);

  ok("a blank channel is filled from IMS", forStore("BLANK")?.channel === "spar-id");
  ok("a blank province is filled from IMS", forStore("BLANK")?.province === "WESTERN CAPE");
  ok("a store that already has both is untouched", !forStore("HASBOTH"),
    "IMS must never overwrite the router's own channel — routes are built on it");
  ok("a store absent from IMS is untouched", !forStore("NOIMS"));
  ok("an IMS channel with no match here is NOT invented",
    forStore("UNKNOWNCHAN")?.channel === undefined,
    "channels are matched, never created");
  ok("but its province still fills", forStore("UNKNOWNCHAN")?.province === "WESTERN CAPE",
    "one unmappable field must not block the other");
  ok("the unmapped channel is reported by name",
    plan.unmappedChannels.get("COCK N BULL") === 1);
  ok("counts match the changes", plan.channelCount === 1 && plan.provinceCount === 2);
}

// Channel matching ignores case and spacing.
{
  const stores = [store("A", { channelId: "", province: "GAUTENG" })];
  const master = new Map([["A", ims("A", { "Store Channel": "  pick   n  pay " })]]);
  const plan = planBackfill(stores, master, (n) =>
    n.trim().toUpperCase().replace(/\s+/g, " ") === "PICK N PAY" ? "pnp-id" : null
  );
  ok("channel matching tolerates case and spacing", plan.changes[0]?.channel === "pnp-id");
}

// A blank IMS value must not overwrite anything with emptiness.
{
  const stores = [store("A", { channelId: "", province: "" })];
  const master = new Map([["A", ims("A", { "Store Channel": "", Province: "   " })]]);
  const plan = planBackfill(stores, master, () => "anything");
  ok("a blank IMS field writes nothing", plan.changes.length === 0,
    "filling a gap with another gap is still a write");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
