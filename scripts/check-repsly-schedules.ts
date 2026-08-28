/**
 * Assertions for the Repsly visit-schedule parser.
 *
 *   npx tsx scripts/check-repsly-schedules.ts
 *
 * ⚠️ Why this file exists: `/export/visitschedules` has never been called
 * against a live Repsly account from here, so its response shape is a guess
 * informed by the other four endpoints. The parser is therefore written to
 * tolerate several plausible shapes, and this is what proves the tolerance is
 * real rather than intended.
 *
 * The assertions that matter most are the ones about SILENCE: a parser that
 * quietly returns zero rows for a shape it does not recognise is worse than one
 * that fails, because "no schedules this week" and "I could not read the reply"
 * look identical on screen.
 */

import { parseVisitSchedules, pick, ymd } from "../lib/repslyApi";

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`PASS  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

// The shape the other Repsly endpoints use: a named envelope around the rows.
{
  const r = parseVisitSchedules({
    MetaCollectionResult: { TotalCount: 1 },
    VisitSchedules: [
      {
        ScheduleCode: "SC-1",
        ScheduleDate: "2026-09-01T00:00:00",
        RepresentativeCode: "GAU075",
        RepresentativeName: "Sefrey Dikolomela",
        ClientCode: "S1000",
        ClientName: "SOWETO OLD POTCH - SUPA STORE",
        DateTimeStart: "2026-09-01T08:30:00",
        DateTimeEnd: "2026-09-01T09:00:00",
        VisitNote: "Monthly call",
      },
    ],
  });
  ok("the documented envelope is recognised", r.envelope === "VisitSchedules", String(r.envelope));
  ok("one row parses to one schedule", r.schedules.length === 1);
  const s = r.schedules[0];
  ok("the schedule id is taken from Repsly when it gives one", s.scheduleId === "SC-1");
  ok("the date is trimmed to a day", s.date === "2026-09-01", s.date);
  ok("the rep code survives", s.repCode === "GAU075");
  ok("the client code survives", s.clientCode === "S1000");
  ok("the note survives", s.note === "Monthly call");
  ok("the raw first row is kept for diagnosis", r.rawSample !== null);
}

// A bare array, which two of Repsly's endpoints already return.
{
  const r = parseVisitSchedules([
    { RepresentativeCode: "MP001", ClientCode: "S960", DueDate: "2026-09-04" },
  ]);
  ok("a bare array is recognised", r.envelope === "(bare array)", String(r.envelope));
  ok("a bare array still parses", r.schedules.length === 1);
  ok("DueDate is accepted where ScheduleDate is absent", r.schedules[0].date === "2026-09-04");
}

// 🔴 The assertion this whole file is for.
{
  const r = parseVisitSchedules({ SomethingElseEntirely: [{ a: 1 }] });
  ok("an unrecognised shape reports envelope null, not an empty success",
    r.envelope === null,
    "the caller turns this into a visible warning; without it a shape change reads as an empty diary");
  ok("an unrecognised shape yields no invented rows", r.schedules.length === 0);

  const empty = parseVisitSchedules({ VisitSchedules: [] });
  ok("a genuinely empty week is NOT reported as unrecognised",
    empty.envelope === "VisitSchedules" && empty.schedules.length === 0,
    "this is the case that must be distinguishable from the one above");
}

// Nothing at all must not throw: a 200 with an empty body is a real outcome.
{
  ok("null does not throw", parseVisitSchedules(null).schedules.length === 0);
  ok("a string does not throw", parseVisitSchedules("").schedules.length === 0);
  ok("a number does not throw", parseVisitSchedules(0).schedules.length === 0);
  ok("null reports an unrecognised envelope", parseVisitSchedules(null).envelope === null);
}

// Field lookup is case and whitespace insensitive, because the exact casing is
// exactly what is unverified here.
{
  ok("a lower-case key is found", pick({ representativecode: "X1" }, "RepresentativeCode") === "X1");
  ok("a padded key is found", pick({ "  ClientCode  ": "C9" }, "ClientCode") === "C9");
  ok("an empty value falls through to the next candidate",
    pick({ ScheduleDate: "", DueDate: "2026-09-09" }, "ScheduleDate", "DueDate") === "2026-09-09");
  ok("a missing key yields an empty string, never 'undefined'",
    pick({}, "Nope") === "");
  ok("a numeric value is stringified", pick({ ID: 41 }, "ID") === "41");
}

// A schedule with no id of its own still has to deduplicate.
{
  const r = parseVisitSchedules({
    VisitSchedules: [
      { RepresentativeCode: "GAU075", ClientCode: "S1000", ScheduleDate: "2026-09-01" },
      { RepresentativeCode: "GAU075", ClientCode: "S1000", ScheduleDate: "2026-09-01" },
      { RepresentativeCode: "GAU075", ClientCode: "S1000", ScheduleDate: "2026-09-08" },
    ],
  });
  const ids = r.schedules.map((s) => s.scheduleId);
  ok("two identical calls derive the SAME composite id", ids[0] === ids[1], ids.join(" / "));
  ok("the same call on a different day derives a DIFFERENT id", ids[0] !== ids[2],
    "a weekly cycle must not collapse to one visit");
  ok("the composite id names its parts", ids[0] === "GAU075|S1000|2026-09-01", ids[0]);
}

// Date path segments: a wrong format here is a 404, not a bad parse.
{
  ok("a single-digit month is padded", ymd(new Date(2026, 0, 5)) === "2026-01-05", ymd(new Date(2026, 0, 5)));
  ok("a double-digit day survives", ymd(new Date(2026, 11, 31)) === "2026-12-31");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
