/**
 * Assertions for an IMS-led store allocation.
 *
 *   npx tsx scripts/check-allocation.ts
 *
 * This decides which human is credited with which shop, and there is no store
 * backup to diff against afterwards. The assertions that matter most are the
 * ones about what it must NOT do: move a store onto a rep code that is not a
 * person, and un-assign a store IMS has no opinion about.
 */

import { planImsAllocation, canonicalRepCode, DEFAULT_ALLOCATION, type AllocationSettings } from "../lib/allocationSource";
import type { Rep, Store } from "../lib/types";
import type { MapRow } from "../lib/mapStatus";

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

const IMS: AllocationSettings = { ...DEFAULT_ALLOCATION, source: "ims" };
const LOOSE: AllocationSettings = { ...IMS, allowUnknownReps: true };

const rep = (code: string, name: string): Rep => ({
  id: code, code, name, email: "", cell: "", homeAddress: "", homeGpsLat: "", homeGpsLng: "", teamId: "",
});
const store = (placeId: string, repCode: string): Store => ({
  id: placeId, placeId, name: placeId, channelId: "c", repCode,
  gpsLat: "-26", gpsLng: "28", monthlySales: 0, sixMonthSales: 60000,
  frequency: "monthly", duration: 30, dayOfWeek: "", weekNumber: "",
});
const row = (placeId: string, imsRepCode: string | null): MapRow => ({
  placeId, status: "matched",
  flags: { noSales: false, dormant: false, duplicateAccount: false, repMismatch: false, closedInIms: false },
  imsName: placeId, imsProvince: null, imsChannel: null,
    imsSubChannel: null, imsRepCode,
  sixMonthSales: 60000, twinCode: null,
});

const REPS = [rep("GAU083", "Mawethu Nikani"), rep("GAU012", "Khethiwe Molekwa")];

// ── The core move ────────────────────────────────────────────────────
{
  const plan = planImsAllocation(
    [store("S1", "GAU086"), store("S2", "GAU012")],
    REPS,
    { S1: row("S1", "GAU083"), S2: row("S2", "GAU012") },
    IMS
  );
  ok("a store IMS assigns elsewhere is moved", plan.moves.length === 1 && plan.moves[0].to === "GAU083");
  ok("a store both systems agree on is left alone", plan.unchanged === 1);
  ok("the move names the destination rep", plan.moves[0].toRepName === "Mawethu Nikani");
  ok("the move records where it came from", plan.moves[0].from === "GAU086");
}

// ── 🔴 What it must refuse to do ─────────────────────────────────────
{
  const plan = planImsAllocation(
    [store("S1", "GAU012"), store("S2", "GAU012"), store("S3", "GAU012")],
    REPS,
    { S1: row("S1", "ACCC"), S2: row("S2", "JHB"), S3: row("S3", "ACCC") },
    IMS
  );
  ok("a store is NOT moved onto a rep code with no rep record",
    plan.moves.length === 0,
    "ACCC and JHB are branch codes, not people; a store behind one vanishes from every map and route");
  ok("those stores are held back and counted", plan.held.length === 3);
  ok("the unknown codes are named, so they can be created if they are real",
    plan.unknownCodes.map((u) => u.code).sort().join(",") === "ACCC,JHB",
    JSON.stringify(plan.unknownCodes));
  ok("the biggest offender is listed first", plan.unknownCodes[0].code === "ACCC" && plan.unknownCodes[0].stores === 2);

  const loose = planImsAllocation(
    [store("S1", "GAU012")],
    REPS,
    { S1: row("S1", "ACCC") },
    LOOSE
  );
  ok("the override exists for when the codes ARE people", loose.moves.length === 1);
  ok("but it still reports the code as unknown", loose.unknownCodes.length === 1);
  ok("holding back is the DEFAULT", DEFAULT_ALLOCATION.allowUnknownReps === false);
}

// ── Silence is not an instruction ────────────────────────────────────
{
  const plan = planImsAllocation(
    [store("S1", "GAU012"), store("S2", "GAU012"), store("S3", "GAU012")],
    REPS,
    { S1: row("S1", null), S2: row("S2", "") },
    IMS
  );
  ok("a store IMS has no rep for keeps its current rep",
    plan.moves.length === 0 && plan.imsSilent === 3,
    "S3 has no IMS row at all, which is the same kind of silence");
  ok("silence is never counted as agreement", plan.unchanged === 0,
    "conflating the two would make the report claim IMS confirmed something it never saw");
}

// ── The CMR spelling is the same person ──────────────────────────────
{
  ok("CMR is stripped", canonicalRepCode("GAU012CMR") === "GAU012");
  ok("case and padding do not matter", canonicalRepCode("  gau012  ") === "GAU012");
  ok("a code that merely contains CMR mid-string is untouched", canonicalRepCode("CMRINL") === "CMRINL");

  const plan = planImsAllocation(
    [store("S1", "GAU012")],
    REPS,
    { S1: row("S1", "GAU012CMR") },
    IMS
  );
  ok("GAU012 and GAU012CMR are not treated as a disagreement",
    plan.moves.length === 0 && plan.unchanged === 1,
    "IMS carries a parallel spelling of the same person; moving on it would churn for nothing");
}

// ── The report a human reads before pressing the button ──────────────
{
  const plan = planImsAllocation(
    [store("A", "X1"), store("B", "X1"), store("C", "X1")],
    [rep("GAU083", "Mawethu Nikani"), rep("X1", "Old Owner")],
    { A: row("A", "GAU083"), B: row("B", "GAU083"), C: row("C", "GAU083") },
    IMS
  );
  const gain = plan.netByRep.find((r) => r.code === "GAU083")!;
  ok("gains are counted per rep", gain.gained === 3);
  ok("the value arriving with them is summed", gain.valueGained === 180000, String(gain.valueGained));
  const loss = plan.netByRep.find((r) => r.code === "X1")!;
  ok("losses are counted too", loss.lost === 3);
}

// ── Nothing may throw on an empty or absent snapshot ─────────────────
{
  const plan = planImsAllocation([store("S1", "GAU012")], REPS, {}, IMS);
  ok("an empty snapshot moves nothing", plan.moves.length === 0 && plan.imsSilent === 1,
    "no snapshot must never be read as 'IMS says nobody owns anything'");
  const none = planImsAllocation([], [], {}, IMS);
  ok("no stores at all does not throw", none.moves.length === 0 && none.unchanged === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
