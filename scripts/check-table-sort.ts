/**
 * Assertions for the shared table sorting and the three store rank columns.
 *
 * Run: npx tsx scripts/check-table-sort.ts
 *
 * The rank checks matter most. The old inline version ranked on
 * `monthlySales ?? 0`, which handed a real position to every store IMS has never
 * heard of — 44% of the base. Several of these assert that such a store gets NO
 * rank rather than a flattering one.
 */

import { compareCells, sortRows } from "../lib/tableSort";
import { rankStores, salesForRanking } from "../lib/storeRanking";
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

function store(id: string, extra: Partial<Store> = {}): Store {
  return {
    id,
    placeId: id,
    name: `Store ${id}`,
    channelId: "independent",
    repCode: "GAU001",
    gpsLat: "-26.1",
    gpsLng: "28.1",
    monthlySales: 0,
    ...extra,
  } as Store;
}

// ── compareCells ────────────────────────────────────────────────────────────
const asc = (a: never | string | number | boolean | null, b: typeof a) => compareCells(a, b, "asc");
const desc = (a: never | string | number | boolean | null, b: typeof a) => compareCells(a, b, "desc");

ok("numbers compare numerically", asc(2, 10) < 0 && desc(2, 10) > 0);
ok("numbers are not compared as text", asc(9, 100) < 0, "'9' vs '100' as text inverts this");
ok("strings compare alphabetically", asc("ALPHA", "BETA") < 0);
ok("strings compare numeric-aware", asc("S2", "S10") < 0, "every Place ID is shaped like this");
ok("string compare ignores case", asc("alpha", "ALPHA") === 0);
ok("booleans sort false before true ascending", asc(false, true) < 0);
ok("null sinks ascending", asc(null, 5) > 0);
ok("null sinks descending too", desc(null, 5) > 0, "a blank must never top either direction");
ok("empty string sinks like null", asc("", "X") > 0 && desc("", "X") > 0);
ok("two blanks tie", asc(null, "") === 0);
ok("zero is a value and does not sink", asc(0, 5) < 0 && desc(0, 5) > 0);
ok("negative numbers order correctly", asc(-10, -2) < 0);

// ── sortRows ────────────────────────────────────────────────────────────────
{
  const rows = [{ n: "b", v: 2 }, { n: "a", v: 30 }, { n: "c", v: null as number | null }];
  const acc = { n: (r: typeof rows[0]) => r.n, v: (r: typeof rows[0]) => r.v };

  ok("sortRows orders by the named column", sortRows(rows, acc, "n", "asc").map((r) => r.n).join("") === "abc");
  ok("sortRows sorts numerically where asked", sortRows(rows, acc, "v", "desc")[0].v === 30);
  ok("sortRows sinks the blank in both directions",
    sortRows(rows, acc, "v", "asc")[2].v === null && sortRows(rows, acc, "v", "desc")[2].v === null);
  ok("an unknown column leaves the order alone", sortRows(rows, acc, "nope", "asc")[0].n === "b");

  const original = [...rows];
  sortRows(rows, acc, "v", "desc");
  ok("sortRows does NOT mutate its input", rows[0] === original[0],
    "in-place sorting would reorder the caller's memoised source");
}

// ── salesForRanking ─────────────────────────────────────────────────────────
ok("the six-month figure is used when present", salesForRanking(store("a", { sixMonthSales: 600 })) === 600);
ok("a six-month ZERO is real data", salesForRanking(store("a", { sixMonthSales: 0 })) === 0,
  "IMS saying it bought nothing is a fact, not an absence");
ok("a legacy monthly average is scaled back up",
  salesForRanking(store("a", { monthlySales: 100 })) === 600);
ok("the six-month figure wins over the monthly one",
  salesForRanking(store("a", { monthlySales: 999, sixMonthSales: 60 })) === 60);
ok("no figure at all is unrankable", salesForRanking(store("a", { monthlySales: 0 })) === null);
ok("a zero monthly average is treated as unknown, not zero",
  salesForRanking(store("a", { monthlySales: 0 })) === null,
  "that is the value the old upload bug wrote over thousands of rows");

// ── rankStores ──────────────────────────────────────────────────────────────
{
  const stores = [
    store("big", { sixMonthSales: 900 }),
    store("mid", { sixMonthSales: 500 }),
    store("small", { sixMonthSales: 100 }),
    store("none", { monthlySales: 0 }),
  ];
  const r = rankStores(stores);
  ok("highest sales ranks first", r.overallRank.get("big") === 1);
  ok("ranks run in order", r.overallRank.get("mid") === 2 && r.overallRank.get("small") === 3);
  ok("a store with no figure is UNRANKED", !r.overallRank.has("none"),
    "the old code gave it a rank as though it had sold zero");
  ok("the unranked count is reported", r.rankedCount === 3 && r.unrankedCount === 1);
}

// Ties share a rank, and the next rank skips.
{
  const stores = [
    store("a", { sixMonthSales: 100 }),
    store("b", { sixMonthSales: 50 }),
    store("c", { sixMonthSales: 50 }),
    store("d", { sixMonthSales: 10 }),
  ];
  const r = rankStores(stores);
  ok("equal sales share a rank", r.overallRank.get("b") === 2 && r.overallRank.get("c") === 2);
  ok("the rank after a tie skips", r.overallRank.get("d") === 4,
    "1, 2, 2, 4 — not 1, 2, 2, 3");
}

// Per-rep and per-channel ranks are scoped to their group.
{
  const stores = [
    store("r1a", { repCode: "REP1", channelId: "spar", sixMonthSales: 10 }),
    store("r1b", { repCode: "REP1", channelId: "pnp", sixMonthSales: 90 }),
    store("r2a", { repCode: "REP2", channelId: "spar", sixMonthSales: 50 }),
  ];
  const r = rankStores(stores);
  ok("overall rank spans everyone", r.overallRank.get("r1b") === 1 && r.overallRank.get("r1a") === 3);
  ok("rep rank restarts per rep", r.repRank.get("r1b") === 1 && r.repRank.get("r1a") === 2);
  ok("a rep's only store ranks first for that rep", r.repRank.get("r2a") === 1);
  ok("channel rank restarts per channel",
    r.channelRank.get("r2a") === 1 && r.channelRank.get("r1a") === 2);
  ok("a channel's only store ranks first", r.channelRank.get("r1b") === 1);
}

// Dividing by six cannot reorder anything — the claim the migration rests on.
{
  const stores = [
    store("a", { sixMonthSales: 6000 }),
    store("b", { sixMonthSales: 600 }),
    store("c", { sixMonthSales: 60 }),
  ];
  const bySix = rankStores(stores);
  const byAvg = rankStores(stores.map((s) => store(s.id, { monthlySales: (s.sixMonthSales as number) / 6 })));
  ok("ranking on the average gives the same order as the six-month total",
    ["a", "b", "c"].every((id) => bySix.overallRank.get(id) === byAvg.overallRank.get(id)));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
