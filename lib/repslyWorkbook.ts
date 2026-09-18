/**
 * The Excel file handed to Clippa's CS team to load the call cycle into Repsly.
 *
 * Kept apart from the route so a script can build the identical file from live
 * data without a signed-in session.
 */

import XLSX from "xlsx";
import type { RoutePlanDocument, Store } from "./types";
import {
  CYCLE_WEEKS,
  REPSLY_IMPORT_HEADERS,
  buildRepslyScheduleRows,
  toImportCells,
} from "./repslySchedule";

export interface RepslyWorkbook {
  /** The only sheet Repsly should be given; also what the CSV option returns. */
  importSheet: XLSX.WorkSheet;
  workbook: XLSX.WorkBook;
  summary: { reps: number; storesInCycle: number; visits: number; notInCycle: number; fewerVisits: number };
}

export function buildRepslyWorkbook(
  doc: RoutePlanDocument | null,
  stores: Store[],
  opts: { start: Date; repCode?: string },
): RepslyWorkbook {
  const startStr = opts.start.toISOString().slice(0, 10);
  const placeIdById = new Map(stores.map((s) => [s.id, s.placeId || s.id]));
  const plans = (doc?.repPlans ?? []).filter((p) => !opts.repCode || p.repCode === opts.repCode);
  const rows = buildRepslyScheduleRows(plans, placeIdById, opts.start);

  const importSheet = XLSX.utils.aoa_to_sheet([[...REPSLY_IMPORT_HEADERS], ...rows.map(toImportCells)]);
  importSheet["!cols"] = [{ wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 22 }, { wch: 8 }, { wch: 9 }];

  const checkWs = XLSX.utils.aoa_to_sheet([
    ["Representative ID", "Rep Name", "Cycle Week", "Day", "Stop", "Time", "Duration", "Place ID", "Store Name", "First Visit", "Then Every"],
    ...rows.map((r) => [
      r.repCode, r.repName, r.cycleWeek, r.day, r.sequence, r.time, r.duration,
      r.placeId, r.storeName, r.fromDate, `${r.repeatEveryWeeks} weeks`,
    ]),
  ]);
  checkWs["!cols"] = [
    { wch: 16 }, { wch: 24 }, { wch: 10 }, { wch: 11 }, { wch: 6 }, { wch: 7 },
    { wch: 9 }, { wch: 16 }, { wch: 36 }, { wch: 11 }, { wch: 11 },
  ];

  // unassignedStores holds one entry per DROPPED VISIT, so a weekly store short
  // of one visit is listed again. One row per store here, saying which it is.
  const inCycle = new Set(rows.map((r) => `${r.repCode}|${r.placeId}`));
  const dropped = new Map<string, { cells: (string | number)[]; count: number }>();
  for (const p of plans) {
    for (const u of p.stats.unassignedStores) {
      const placeId = placeIdById.get(u.storeId) || u.storeId;
      const key = `${p.repCode}|${placeId}`;
      const hit = dropped.get(key);
      if (hit) hit.count++;
      else dropped.set(key, { cells: [p.repCode, p.repName, placeId, u.storeName, u.reason], count: 1 });
    }
  }
  const left = [...dropped].map(([key, d]) => [
    ...d.cells, d.count, inCycle.has(key) ? "Yes, fewer visits" : "No, never visited",
  ]);
  const leftWs = XLSX.utils.aoa_to_sheet([
    ["Representative ID", "Rep Name", "Place ID", "Store Name", "Why visits were dropped", "Visits dropped", "Still in the cycle?"],
    ...left,
  ]);
  leftWs["!cols"] = [{ wch: 16 }, { wch: 24 }, { wch: 16 }, { wch: 36 }, { wch: 44 }, { wch: 13 }, { wch: 18 }];

  const summary = {
    reps: plans.length,
    storesInCycle: inCycle.size,
    visits: rows.length,
    notInCycle: left.filter((r) => r[6] === "No, never visited").length,
    fewerVisits: left.filter((r) => r[6] === "Yes, fewer visits").length,
  };

  const readMeWs = XLSX.utils.aoa_to_sheet([
    ["Clippa call cycle for Repsly"],
    [],
    ["Call cycle generated", doc?.generatedAt ? doc.generatedAt.slice(0, 16).replace("T", " ") + " UTC" : "n/a"],
    ["Reps", summary.reps],
    ["Stores in the cycle", summary.storesInCycle],
    ["Visits per 4-week cycle (rows to import)", summary.visits],
    ["Stores never visited (see sheet 'Not in cycle')", summary.notInCycle],
    ["Stores visited less often than planned", summary.fewerVisits],
    ["Week 1 starts on", startStr],
    [],
    ["How to load it"],
    ["1", "In Repsly: Schedules, Import. Upload the sheet 'Repsly Import' only (save it as its own file if Repsly asks for one sheet)."],
    ["2", `Each row is one visit that repeats every ${CYCLE_WEEKS} weeks from its From Date, so the cycle keeps running with no end date.`],
    ["3", "Stores visited weekly appear on four rows, one for each week of the cycle."],
    ["4", "Before loading, end or delete the reps' existing schedules in Repsly. Importing on top of them doubles the visits."],
    ["5", "Representative ID and Place ID must already exist in Repsly. Any that do not will be rejected by Repsly."],
    [],
    ["Sheet 'Check' is the same visits with names, cycle week and stop order, for reading. It is not for importing."],
  ]);
  readMeWs["!cols"] = [{ wch: 44 }, { wch: 110 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, importSheet, "Repsly Import");
  XLSX.utils.book_append_sheet(workbook, checkWs, "Check");
  XLSX.utils.book_append_sheet(workbook, leftWs, "Not in cycle");
  XLSX.utils.book_append_sheet(workbook, readMeWs, "Read me");

  return { importSheet, workbook, summary };
}
