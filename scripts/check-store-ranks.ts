/**
 * Assertions for the ranks shown on a store's card.
 *
 * Run: npx tsx scripts/check-store-ranks.ts
 *
 * Two things must hold or the card lies about a shop. A store IMS has never
 * measured must not be ranked at all — printing "6 812th of 7 080" against 38.5%
 * of the base invents a fact and reads as a judgement. And two shops on the same
 * money must share a position, or somebody goes looking for a difference that
 * is not there.
 */

import { buildDayRanks, buildStoreRanks, formatRank } from "../lib/storeRanks";
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

/** `six` omitted = IMS has never reported this store. */
function store(id: string, six?: number, repCode = "R1"): Store {
  const s: Store = {
    id, placeId: id, name: `Store ${id}`, channelId: "c1", repCode,
    gpsLat: "-26.1", gpsLng: "28.0", monthlySales: six === undefined ? 0 : six / 6,
    frequency: "monthly", duration: 30, dayOfWeek: "", weekNumber: "",
  } as Store;
  if (six !== undefined) s.sixMonthSales = six;
  return s;
}

// ── Overall ranking ───────────────────────────────────────────────────────
{
  const stores = [store("a", 100), store("b", 300), store("c", 200)];
  const r = buildStoreRanks(stores);
  ok("best seller is 1st", r.get("b")!.overall!.position === 1);
  ok("middle is 2nd", r.get("c")!.overall!.position === 2);
  ok("weakest is 3rd", r.get("a")!.overall!.position === 3);
  ok("the denominator is the number ranked", r.get("b")!.overall!.of === 3);
}

// ── 🔴 Unmeasured stores are NOT ranked ───────────────────────────────────
{
  const stores = [store("known1", 100), store("unknown"), store("known2", 300)];
  const r = buildStoreRanks(stores);
  ok("a store with no figure has no overall rank", r.get("unknown")!.overall === null);
  ok("a store with no figure has no rep rank", r.get("unknown")!.rep === null);
  ok(
    "🔴 and it is EXCLUDED from the denominator, not counted as last",
    r.get("known1")!.overall!.of === 2,
    `of=${r.get("known1")!.overall!.of}`
  );
  ok("the measured ones still rank normally", r.get("known2")!.overall!.position === 1);

  // A reported ZERO is a real figure and IS ranked — bottom, where it belongs.
  const withZero = buildStoreRanks([store("z", 0), store("k", 100), store("u")]);
  ok("a reported zero is ranked", withZero.get("z")!.overall !== null);
  ok("and it ranks last of the measured", withZero.get("z")!.overall!.position === 2);
  ok("while the unmeasured one still is not", withZero.get("u")!.overall === null);
}

// ── Ties share a position ─────────────────────────────────────────────────
{
  const r = buildStoreRanks([store("a", 500), store("b", 500), store("c", 100)]);
  ok("two stores on the same money share 1st",
    r.get("a")!.overall!.position === 1 && r.get("b")!.overall!.position === 1);
  ok("the next store takes the position after the tied block, not 2nd",
    r.get("c")!.overall!.position === 3, String(r.get("c")!.overall!.position));
}

// ── Rep rank is a different question from overall ─────────────────────────
{
  const stores = [
    store("big1", 1000, "R1"), store("big2", 900, "R1"),
    store("small1", 50, "R2"), store("small2", 10, "R2"),
  ];
  const r = buildStoreRanks(stores);
  ok("a small shop can be TOP of its own rep", r.get("small1")!.rep!.position === 1);
  ok("while sitting third overall", r.get("small1")!.overall!.position === 3);
  ok("rep denominators count only that rep's measured stores",
    r.get("small1")!.rep!.of === 2 && r.get("big1")!.rep!.of === 2);
  ok("a rep's best is 1st for them", r.get("big1")!.rep!.position === 1);
}

// ── Day rank ──────────────────────────────────────────────────────────────
{
  const stores = [store("a", 100), store("b", 300), store("c", 200), store("d")];
  const byId = new Map(stores.map((s) => [s.id, s]));
  const days = buildDayRanks(
    [
      { key: "Wk1|Monday", storeIds: ["a", "b", "d"] },
      { key: "Wk1|Tuesday", storeIds: ["a", "c"] },
    ],
    byId
  );
  ok("best on Monday is 1st of its day", days.get("Wk1|Monday")!.get("b")!.position === 1);
  ok("the day denominator counts only that day's MEASURED stores",
    days.get("Wk1|Monday")!.get("b")!.of === 2, String(days.get("Wk1|Monday")!.get("b")!.of));
  ok("an unmeasured store on the day is not ranked", !days.get("Wk1|Monday")!.has("d"));

  // 🔴 The same store ranks differently on different days — which is the whole
  // reason day ranks are keyed by day rather than stored on the store.
  ok("store a is 2nd on Monday", days.get("Wk1|Monday")!.get("a")!.position === 2);
  ok("and 2nd of two on Tuesday", days.get("Wk1|Tuesday")!.get("a")!.position === 2);
  ok("with a different denominator each day",
    days.get("Wk1|Monday")!.get("a")!.of === 2 && days.get("Wk1|Tuesday")!.get("a")!.of === 2);

  ok("a day with no stores yields an empty ranking",
    buildDayRanks([{ key: "x", storeIds: [] }], byId).get("x")!.size === 0);
  ok("a store id the page does not have is skipped, not crashed",
    buildDayRanks([{ key: "y", storeIds: ["ghost"] }], byId).get("y")!.size === 0);
}

// ── Formatting ────────────────────────────────────────────────────────────
{
  ok("1st", formatRank({ position: 1, of: 10 }) === "1st of 10");
  ok("2nd", formatRank({ position: 2, of: 10 }) === "2nd of 10");
  ok("3rd", formatRank({ position: 3, of: 10 }) === "3rd of 10");
  ok("4th", formatRank({ position: 4, of: 10 }) === "4th of 10");
  // The teens are the ones a naive suffix rule gets wrong.
  ok("11th, not 11st", formatRank({ position: 11, of: 100 }) === "11th of 100");
  ok("12th, not 12nd", formatRank({ position: 12, of: 100 }) === "12th of 100");
  ok("13th, not 13rd", formatRank({ position: 13, of: 100 }) === "13th of 100");
  ok("21st", formatRank({ position: 21, of: 100 }) === "21st of 100");
  ok("111th, not 111st", formatRank({ position: 111, of: 200 }) === "111th of 200");
  ok("no rank renders as nothing at all", formatRank(null) === null);
}

// ── Nothing configured ────────────────────────────────────────────────────
{
  ok("no stores, no ranks", buildStoreRanks([]).size === 0);
  const noneMeasured = buildStoreRanks([store("a"), store("b")]);
  ok("nothing measured: every rank is absent",
    noneMeasured.get("a")!.overall === null && noneMeasured.get("b")!.rep === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
