/**
 * Turns a generated call cycle into rows Repsly's schedule import accepts.
 *
 * The cycle is four weeks (Wk1..Wk4) of Monday..Friday. Each visit becomes ONE
 * row that repeats every 4 weeks from the date its cycle week and day first
 * falls on. That reproduces the whole cycle forever: a monthly store is one row,
 * a weekly store is four rows (one per cycle week), and nothing runs out after
 * a fixed number of months the way one-off dated visits did.
 *
 * Column names: the four Repsly marks mandatory in its Excel import
 * ("Representative ID", "Place ID", "From Date", "Repeat every (x) week") are
 * Repsly's own. The optional ones mirror the API's ScheduledTime and
 * ScheduledDuration (https://repsly-dev.readme.io/reference/schedule) and should
 * be checked against the template Repsly offers for download.
 */

import type { DayLabel, RepRoutePlan } from "./types";

export const CYCLE_WEEKS = 4;

export const REPSLY_IMPORT_HEADERS = [
  "Representative ID",
  "Place ID",
  "From Date",
  "Repeat every (x) week",
  "Time",
  "Duration",
] as const;

const DAY_OFFSET: Record<DayLabel, number> = {
  Monday: 0,
  Tuesday: 1,
  Wednesday: 2,
  Thursday: 3,
  Friday: 4,
};

const DAY_MS = 86400000;

export interface RepslyScheduleRow {
  repCode: string;
  placeId: string;
  fromDate: string; // YYYY-MM-DD
  repeatEveryWeeks: number;
  time: string; // HH:mm
  duration: number; // minutes
  // Reference only, never imported
  repName: string;
  storeName: string;
  cycleWeek: string;
  day: DayLabel;
  sequence: number;
}

/** The given date if it is a Monday, else the next Monday. UTC, date only. */
export function cycleStartMonday(from: Date): Date {
  const base = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const dow = new Date(base).getUTCDay(); // 0=Sun..6=Sat
  return new Date(base + ((1 - dow + 7) % 7) * DAY_MS);
}

/**
 * Reads "YYYY-MM-DD"; null for anything that is not a real calendar date.
 * A year before 2000 is refused: a date input emits "0002-..." mid-typing.
 */
export function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value || !/^2\d{3}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? d : null;
}

function weekIndex(week: string): number | null {
  const m = /^Wk([1-4])$/.exec(week);
  return m ? Number(m[1]) - 1 : null;
}

export function buildRepslyScheduleRows(
  plans: RepRoutePlan[],
  placeIdByStoreId: Map<string, string>,
  startMonday: Date,
): RepslyScheduleRow[] {
  const rows: RepslyScheduleRow[] = [];
  for (const plan of plans) {
    for (const dp of plan.days) {
      const w = weekIndex(dp.week);
      const offset = DAY_OFFSET[dp.day];
      if (w === null || offset === undefined) continue;
      const fromDate = new Date(startMonday.getTime() + (w * 7 + offset) * DAY_MS)
        .toISOString()
        .slice(0, 10);
      for (const stop of dp.stops) {
        rows.push({
          repCode: plan.repCode,
          placeId: placeIdByStoreId.get(stop.storeId) || stop.storeId,
          fromDate,
          repeatEveryWeeks: CYCLE_WEEKS,
          time: stop.arrivalTime,
          duration: stop.visitDuration,
          repName: plan.repName,
          storeName: stop.storeName,
          cycleWeek: dp.week,
          day: dp.day,
          sequence: stop.sequence,
        });
      }
    }
  }
  return rows.sort(
    (a, b) =>
      a.repCode.localeCompare(b.repCode) ||
      a.fromDate.localeCompare(b.fromDate) ||
      a.time.localeCompare(b.time) ||
      a.sequence - b.sequence,
  );
}

export function toImportCells(r: RepslyScheduleRow): (string | number)[] {
  return [r.repCode, r.placeId, r.fromDate, r.repeatEveryWeeks, r.time, r.duration];
}
