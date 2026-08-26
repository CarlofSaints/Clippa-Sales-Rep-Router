/**
 * Assertions for the IMS reconciliation.
 *
 * Run: npx tsx scripts/check-ims-recon.ts
 *
 * Every check gets a case that SHOULD fire and a case that should NOT. The
 * duplicate-account detector is the part worth distrusting: a rule that matches
 * everything would "explain" all 2 621 dark stores and be worthless, so several
 * of these assert that it stays SILENT where it should.
 */

import {
  reconcile,
  applySalesToStores,
  gradeTwin,
  suffixOf,
  type ImsStore,
} from "../lib/imsReconCore";
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

// ── suffixOf ────────────────────────────────────────────────────────────────
ok("suffixOf splits on the FIRST hyphen", suffixOf("2214-GO38") === "GO38");
ok("suffixOf keeps later hyphens in the suffix", suffixOf("S502-G4-04") === "G4-04");
ok("suffixOf returns null with no hyphen", suffixOf("MR01") === null);
ok("suffixOf returns null for a leading hyphen", suffixOf("-GO38") === null);
ok("suffixOf returns null for a trailing hyphen", suffixOf("2214-") === null);

// ── gradeTwin ───────────────────────────────────────────────────────────────
ok("a lettered suffix with one candidate is strong", gradeTwin("GO38", 1) === "strong");
ok("a short numeric suffix is never strong", gradeTwin("01", 1) === "weak");
ok("a 3-digit numeric suffix is still not strong", gradeTwin("002", 1) === "weak");
ok("a 2-char lettered suffix is not strong", gradeTwin("G4", 1) === "weak");
ok("many candidates make it ambiguous however good the suffix", gradeTwin("GO38", 9) === "ambiguous");
ok("ambiguity beats distinctiveness at the boundary", gradeTwin("GO38", 4) === "ambiguous");
ok("three candidates is still gradeable", gradeTwin("GO38", 3) === "strong");

// ── classification ──────────────────────────────────────────────────────────
{
  const stores = [
    store("A-SELL"),   // has six-month sales
    store("A-DORM"),   // no six-month sales, but sold within twelve
    store("A-DARK"),   // in the master, no sales at all
    store("A-GONE"),   // not in the master
  ];
  const sales = new Map([["A-SELL", 1200]]);
  const sales12 = new Set(["A-SELL", "A-DORM"]);
  const master = new Map([
    ["A-SELL", ims("A-SELL")],
    ["A-DORM", ims("A-DORM")],
    ["A-DARK", ims("A-DARK")],
  ]);
  const r = reconcile(stores, sales, sales12, master);
  const by = (id: string) => r.rows.find((x) => x.placeId === id)!;

  ok("a store with sales is selling", by("A-SELL").status === "selling");
  ok("sales inside 12 months only is dormant", by("A-DORM").status === "dormant");
  ok("in the master with no sales is dark", by("A-DARK").status === "dark");
  ok("absent from the master is absent", by("A-GONE").status === "absent");
  ok("the summary counts each status once", r.summary.selling === 1 && r.summary.dormant === 1 && r.summary.dark === 1 && r.summary.absent === 1);
  ok("a selling store carries its value", by("A-SELL").sixMonthSales === 1200);
  ok("a non-selling store reports null, not zero", by("A-DARK").sixMonthSales === null,
    "null and 0 must stay distinguishable");
  ok("matchedValue counts only routed stores", r.summary.matchedValue === 1200);
}

// ── the duplicate-account detector ──────────────────────────────────────────
{
  const stores = [store("2214-GO38"), store("13175-GO38")];
  const sales = new Map([["13175-GO38", 5000]]);
  const master = new Map([
    ["2214-GO38", ims("2214-GO38", { Province: "GAUTENG" })],
    ["13175-GO38", ims("13175-GO38", { Province: "GAUTENG" })],
  ]);
  const r = reconcile(stores, sales, new Set(["13175-GO38"]), master);
  const dead = r.rows.find((x) => x.placeId === "2214-GO38")!;

  ok("a dark store is offered its selling same-suffix twin", dead.twin?.code === "13175-GO38");
  ok("the twin carries the sales that store is missing", dead.twin?.sixMonthSales === 5000);
  ok("a distinctive suffix with one candidate grades strong", dead.twin?.confidence === "strong");
  ok("same-province agreement is reported", dead.twin?.sameProvince === true);
  ok("a twin already in the router is flagged as such", dead.twin?.twinIsInRouter === true);
  ok("the SELLING store is never given a twin", r.rows.find((x) => x.placeId === "13175-GO38")!.twin === null,
    "only a store missing sales needs explaining");
}

// The detector must stay SILENT in these cases.
{
  const stores = [store("MR01"), store("X-ZZ99"), store("2214-GO38")];
  const sales = new Map([["OTHER-AA11", 900]]);
  const master = new Map([
    ["MR01", ims("MR01")],
    ["X-ZZ99", ims("X-ZZ99")],
    ["2214-GO38", ims("2214-GO38")],
  ]);
  const r = reconcile(stores, sales, new Set(), master);
  ok("no hyphen means no twin", r.rows.find((x) => x.placeId === "MR01")!.twin === null);
  ok("a suffix nobody else sells under gets no twin", r.rows.find((x) => x.placeId === "X-ZZ99")!.twin === null);
  ok("a non-matching suffix gets no twin", r.rows.find((x) => x.placeId === "2214-GO38")!.twin === null);
  ok("no twins found means no twin counters", r.summary.twinStrong === 0 && r.summary.twinWeak === 0 && r.summary.twinAmbiguous === 0);
}

// A store must never be offered ITSELF as its own twin.
{
  const stores = [store("2214-GO38")];
  const sales = new Map([["2214-GO38", 100]]);
  const r = reconcile(stores, sales, new Set(["2214-GO38"]), new Map([["2214-GO38", ims("2214-GO38")]]));
  ok("a selling store is not its own twin", r.rows[0].twin === null);
}

// The best twin is the highest-selling candidate, and >3 downgrades to ambiguous.
{
  const stores = [store("A-GO38")];
  const sales = new Map([
    ["B-GO38", 100], ["C-GO38", 900], ["D-GO38", 50], ["E-GO38", 10],
  ]);
  const master = new Map([["A-GO38", ims("A-GO38")]]);
  const r = reconcile(stores, sales, new Set(), master);
  ok("the highest-selling candidate is chosen", r.rows[0].twin?.code === "C-GO38");
  ok("four candidates grade ambiguous", r.rows[0].twin?.confidence === "ambiguous");
  ok("the candidate count is reported", r.rows[0].twin?.candidates === 4);
}

// ── orphans ─────────────────────────────────────────────────────────────────
{
  const stores = [store("A-1")];
  const sales = new Map([["A-1", 10], ["ORPHAN-9", 700]]);
  const master = new Map([["ORPHAN-9", ims("ORPHAN-9", { "Closed Status": "true" })]]);
  const r = reconcile(stores, sales, new Set(), master);
  ok("an IMS code with no router store is an orphan", r.orphans.length === 1 && r.orphans[0].placeId === "ORPHAN-9");
  ok("a routed code is not an orphan", !r.orphans.some((o) => o.placeId === "A-1"));
  ok("orphan value is stranded", r.summary.strandedValue === 700);
  ok("total value spans both sides", r.summary.totalValue === 710);
  ok("Closed Status 'true' becomes a real boolean", r.orphans[0].imsClosed === true);
}

// ── applySalesToStores ──────────────────────────────────────────────────────
{
  const stores = [
    store("HAS", { monthlySales: 999, sixMonthSales: 111 }),
    store("NEW", { monthlySales: 42 }),
    store("NONE", { monthlySales: 7, sixMonthSales: 6 }),
  ];
  const sales = new Map([["HAS", 6000], ["NEW", 3000]]);
  const out = applySalesToStores(stores, sales);
  const by = (id: string) => out.stores.find((x) => x.placeId === id)!;

  ok("an existing figure is replaced", by("HAS").sixMonthSales === 6000);
  ok("monthlySales becomes a sixth of it", by("HAS").monthlySales === 1000);
  ok("a store with no prior figure gets one", by("NEW").sixMonthSales === 3000 && by("NEW").monthlySales === 500);
  ok("a store with NO IMS figure is untouched", by("NONE").sixMonthSales === 6 && by("NONE").monthlySales === 7,
    "absent must never be written as zero");
  ok("counts add up", out.updated === 2 && out.untouched === 1);
  ok("the input array is not mutated", stores[0].sixMonthSales === 111,
    "callers compare before and after, so the original must survive");
}

// Re-applying the same figures must be a no-op, or "updated" lies on every run.
{
  const stores = [store("A", { monthlySales: 1000, sixMonthSales: 6000 })];
  const out = applySalesToStores(stores, new Map([["A", 6000]]));
  ok("re-applying an identical figure counts as unchanged", out.unchanged === 1 && out.updated === 0);
}

// Case and whitespace in a Place ID must not lose a match.
{
  const stores = [store(" a-go38 ")];
  const out = applySalesToStores(stores, new Map([["A-GO38", 1200]]));
  ok("matching is case and whitespace insensitive", out.updated === 1 && out.stores[0].sixMonthSales === 1200);
}

// A real zero from IMS is a value, not an absence.
{
  const stores = [store("Z", { monthlySales: 5, sixMonthSales: 30 })];
  const out = applySalesToStores(stores, new Map([["Z", 0]]));
  ok("a genuine zero IS written", out.stores[0].sixMonthSales === 0 && out.stores[0].monthlySales === 0,
    "0 from IMS means it sold nothing; absent means we were never told");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
