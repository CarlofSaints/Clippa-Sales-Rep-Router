/**
 * Assertions for the call cycle handed to Repsly.
 *
 * Run: npx tsx scripts/check-repsly-export.ts
 *
 * What matters: every visit in the 4-week cycle becomes exactly one row that
 * repeats every 4 weeks from the date its week and day first fall on, the
 * store goes out under its Repsly Place ID, and a bad start date can never
 * shift the whole cycle onto a Tuesday.
 */

import {
  REPSLY_IMPORT_HEADERS,
  buildRepslyScheduleRows,
  cycleStartMonday,
  parseIsoDate,
  toImportCells,
} from "../lib/repslySchedule";
import { buildRepslyWorkbook } from "../lib/repslyWorkbook";
import XLSX from "xlsx";
import type { DayLabel, RepRoutePlan, RoutePlanDocument, RouteStop, Store, WeekLabel } from "../lib/types";

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

const iso = (d: Date) => d.toISOString().slice(0, 10);

const stop = (storeId: string, sequence: number, arrivalTime: string, visitDuration = 30): RouteStop => ({
  storeId, storeName: `Store ${storeId}`, lat: -26, lng: 28, visitDuration,
  travelTimeFromPrev: 10, distanceFromPrev: 5, arrivalTime, departureTime: arrivalTime, sequence,
});
const day = (week: WeekLabel, d: DayLabel, stops: RouteStop[]) => ({
  day: d, week, stops, totalTravelTime: 0, totalVisitTime: 0, totalTime: 0, totalDistance: 0, overCapacity: false,
});
const plan = (repCode: string, days: ReturnType<typeof day>[]): RepRoutePlan => ({
  repCode, repName: `Rep ${repCode}`, homeLatLng: null, workingHoursPerDay: 8,
  generatedAt: "2026-09-02T00:00:00Z", days,
  stats: { totalStores: 0, unassignedStores: [] },
});

// ── Mandatory Repsly columns, by Repsly's own names ──
eq("first four headers are Repsly's mandatory columns", REPSLY_IMPORT_HEADERS.slice(0, 4), [
  "Representative ID", "Place ID", "From Date", "Repeat every (x) week",
]);

// ── Start date ──
eq("a Monday stays that Monday", iso(cycleStartMonday(new Date("2026-09-21T00:00:00Z"))), "2026-09-21");
eq("a Friday moves to the next Monday", iso(cycleStartMonday(new Date("2026-09-18T00:00:00Z"))), "2026-09-21");
eq("a Sunday moves to the next day", iso(cycleStartMonday(new Date("2026-09-20T00:00:00Z"))), "2026-09-21");
eq("parse a real date", parseIsoDate("2026-09-21") && iso(parseIsoDate("2026-09-21")!), "2026-09-21");
eq("a partial year from a date input is refused", parseIsoDate("0202-09-21"), null);
eq("an impossible date is refused", parseIsoDate("2026-02-30"), null);
eq("garbage is refused", parseIsoDate("21/09/2026"), null);
eq("absent is refused", parseIsoDate(null), null);

// ── Rows ──
const start = new Date("2026-09-21T00:00:00Z");
const places = new Map([["s1", "P-001"], ["s2", "P-002"], ["w", "P-WEEKLY"]]);
const rows = buildRepslyScheduleRows(
  [
    plan("GAU053", [
      day("Wk1", "Monday", [stop("s2", 2, "09:10", 45), stop("s1", 1, "08:15")]),
      day("Wk3", "Thursday", [stop("s3", 1, "08:30")]),
      ...(["Wk1", "Wk2", "Wk3", "Wk4"] as WeekLabel[]).map((w) => day(w, "Tuesday", [stop("w", 1, "08:00")])),
    ]),
    plan("CPT004", [day("Wk2", "Friday", [stop("s1", 1, "10:00")])]),
  ],
  places,
  start,
);

eq("one row per visit", rows.length, 8);
ok("every row repeats every 4 weeks", rows.every((r) => r.repeatEveryWeeks === 4));
eq("rep code order, CPT004 first", rows[0].repCode, "CPT004");
eq("Wk2 Friday lands on the second Friday", rows[0].fromDate, "2026-10-02");

const gau = rows.filter((r) => r.repCode === "GAU053");
eq("Wk1 Monday is the start date, stops in time order",
  gau.slice(0, 2).map((r) => [r.fromDate, r.time, r.placeId]),
  [["2026-09-21", "08:15", "P-001"], ["2026-09-21", "09:10", "P-002"]]);
eq("duration carried from the stop", gau[1].duration, 45);
eq("a weekly store is four rows, a week apart",
  gau.filter((r) => r.placeId === "P-WEEKLY").map((r) => r.fromDate),
  ["2026-09-22", "2026-09-29", "2026-10-06", "2026-10-13"]);
eq("Wk3 Thursday", gau.find((r) => r.storeName === "Store s3")?.fromDate, "2026-10-08");
eq("a store with no Place ID falls back to its id", gau.find((r) => r.storeName === "Store s3")?.placeId, "s3");
eq("import cells match the headers", toImportCells(rows[0]), ["CPT004", "P-001", "2026-10-02", 4, "10:00", 30]);
eq("import cells are as wide as the headers", toImportCells(rows[0]).length, REPSLY_IMPORT_HEADERS.length);

// A malformed week never produces a row dated off the cycle
const odd = buildRepslyScheduleRows(
  [plan("X", [{ ...day("Wk1", "Monday", [stop("s1", 1, "08:00")]), week: "Wk5" as WeekLabel }])],
  places,
  start,
);
eq("an unknown cycle week is skipped, not guessed", odd.length, 0);

eq("no plans, no rows", buildRepslyScheduleRows([], places, start).length, 0);

// 🔴 "10:60" is not a time, and 50 stops in the plan saved on 20 Sep carry one.
// Repsly reads this column, so the export normalises rather than trusting the
// plan to have been regenerated since the engine stopped writing them.
eq("a stop time of 10:60 is exported as 11:00",
  buildRepslyScheduleRows(
    [plan("GAU053", [day("Wk1", "Monday", [stop("s1", 1, "10:60")])])],
    places,
    start
  )[0].time,
  "11:00");

// ── Workbook ──
const withDrops = plan("GAU053", [day("Wk1", "Monday", [stop("w", 1, "08:00")])]);
withDrops.stats.unassignedStores = [
  { storeId: "w", storeName: "Store w", reason: "Over the 8 calls per day target" },
  { storeId: "w", storeName: "Store w", reason: "Over the 8 calls per day target" },
  { storeId: "s2", storeName: "Store s2", reason: "Missing or invalid GPS coordinates" },
  { storeId: "s2", storeName: "Store s2", reason: "Missing or invalid GPS coordinates" },
];
const storesFixture = [
  { id: "w", placeId: "P-WEEKLY" },
  { id: "s2", placeId: "P-002" },
] as unknown as Store[];
const wbDoc = { id: "x", generatedAt: "2026-09-02T14:18:00Z", repPlans: [withDrops, plan("CPT004", [])] } as unknown as RoutePlanDocument;
const built = buildRepslyWorkbook(wbDoc, storesFixture, { start });
eq("sheet order: import first", built.workbook.SheetNames, ["Repsly Import", "Check", "Not in cycle", "Read me"]);
eq("summary counts stores, not dropped visits", built.summary, { reps: 2, storesInCycle: 1, visits: 1, notInCycle: 1, fewerVisits: 1 });
const leftRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(built.workbook.Sheets["Not in cycle"]);
eq("one row per store on Not in cycle", leftRows.length, 2);
eq("a partly dropped store says so",
  leftRows.map((r) => [r["Place ID"], r["Visits dropped"], r["Still in the cycle?"]]),
  [["P-WEEKLY", 2, "Yes, fewer visits"], ["P-002", 2, "No, never visited"]]);
const importRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(built.importSheet);
eq("import sheet carries only the import columns", Object.keys(importRows[0]), [...REPSLY_IMPORT_HEADERS]);
eq("rep filter", buildRepslyWorkbook(wbDoc, storesFixture, { start, repCode: "CPT004" }).summary.reps, 1);
eq("no plan document, empty file not a crash", buildRepslyWorkbook(null, [], { start }).summary.visits, 0);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
