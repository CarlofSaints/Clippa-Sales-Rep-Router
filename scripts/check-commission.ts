/**
 * Assertions for commission and for the rep activity rollup.
 *
 *   npx tsx scripts/check-commission.ts
 *
 * This decides what people are paid, so it is asserted directly rather than
 * eyeballed on a page. The cases that matter most are the boundary (exactly at
 * the threshold), the two readings of "3.25% from R550k", and the period trap:
 * the threshold is monthly and the portfolio is six-monthly, so anything that
 * forgets to divide clears the bar six times too easily.
 */

import { computeCommission, commissionProblem, DEFAULT_COMMISSION, type CommissionSettings } from "../lib/commission";
import { buildRepActivity, totalRepActivity } from "../lib/repActivity";
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
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

const EXCESS: CommissionSettings = { ...DEFAULT_COMMISSION, ratePercent: 3.25, thresholdMonthly: 550000, basis: "excess" };
const GATE: CommissionSettings = { ...EXCESS, basis: "gate" };

// ── The live deal: 3.25% from R550 000 a month ───────────────────────
{
  const r = computeCommission(750000, EXCESS);
  ok("excess: the rate applies to the amount over the threshold", near(r.commissionable, 200000), String(r.commissionable));
  ok("excess: R750k earns R6 500", near(r.earning, 6500), String(r.earning));

  const g = computeCommission(750000, GATE);
  ok("gate: the rate applies to the whole portfolio", near(g.commissionable, 750000));
  ok("gate: R750k earns R24 375", near(g.earning, 24375), String(g.earning));

  ok("the two bases genuinely differ, which is why it is a setting",
    !near(r.earning, g.earning),
    "if these ever match, the setting has stopped doing anything");
}

// ── Clippa's actual deal, pinned ─────────────────────────────────────
{
  ok("the shipped default is the gate basis",
    DEFAULT_COMMISSION.basis === "gate",
    "a rep under the threshold earns no commission at all; once they reach it the rate applies to the whole portfolio");
  ok("the shipped default rate is 3.25%", DEFAULT_COMMISSION.ratePercent === 3.25);
  ok("the shipped default threshold is R550 000 a month", DEFAULT_COMMISSION.thresholdMonthly === 550000);
  ok("an unsaved config therefore prices a real portfolio correctly",
    near(computeCommission(750000, DEFAULT_COMMISSION).earning, 24375),
    "nobody should have to open the settings page to make the grid right");
}

// ── The boundary. Off-by-one here is somebody's pay. ─────────────────
{
  const at = computeCommission(550000, EXCESS);
  ok("exactly at the threshold counts as qualifying", at.qualifies);
  ok("exactly at the threshold earns nothing on the excess basis", near(at.earning, 0),
    "reaching the bar and clearing it are different things");
  ok("exactly at the threshold has no shortfall", near(at.shortfall, 0));

  const atGate = computeCommission(550000, GATE);
  ok("exactly at the threshold pays in full on the gate basis", near(atGate.earning, 17875), String(atGate.earning));

  const under = computeCommission(549999, EXCESS);
  ok("a rand under the threshold earns nothing", near(under.earning, 0));
  ok("a rand under the threshold does not qualify", !under.qualifies);
  ok("the shortfall is the rands still needed", near(under.shortfall, 1), String(under.shortfall));
}

// ── 🔴 The period trap ───────────────────────────────────────────────
{
  const sixMonthTotal = 1200000; // R200k a month, well under the bar
  ok("a six-month total fed in raw would wrongly qualify",
    computeCommission(sixMonthTotal, EXCESS).qualifies,
    "this is the mistake the caller must not make, asserted so it stays visible");
  ok("the same portfolio priced per month does NOT qualify",
    !computeCommission(sixMonthTotal / 6, EXCESS).qualifies,
    "computeCommission takes MONTHLY revenue");
}

// ── Nothing may throw or invent money ────────────────────────────────
{
  ok("zero revenue earns nothing", near(computeCommission(0, EXCESS).earning, 0));
  ok("negative revenue is floored at zero", near(computeCommission(-5000, EXCESS).monthlyRevenue, 0));
  ok("NaN revenue does not produce NaN pay", near(computeCommission(NaN, EXCESS).earning, 0));
  ok("a zero rate earns nothing", near(computeCommission(9000000, { ...EXCESS, ratePercent: 0 }).earning, 0));
  ok("a zero threshold pays from the first rand",
    near(computeCommission(100000, { ...EXCESS, thresholdMonthly: 0 }).earning, 3250));
}

// ── Validation, because this route is reachable without the form ─────
{
  ok("a rate above 100 is rejected", !!commissionProblem({ ...EXCESS, ratePercent: 325 }),
    "0.0325 typed as a percent would pay somebody their entire portfolio");
  ok("a negative threshold is rejected", !!commissionProblem({ ...EXCESS, thresholdMonthly: -1 }));
  ok("a missing basis is rejected", !!commissionProblem({ ratePercent: 3.25, thresholdMonthly: 550000 }));
  ok("the live settings are valid", commissionProblem(EXCESS) === null);
  ok("100 percent is allowed", commissionProblem({ ...EXCESS, ratePercent: 100 }) === null);
}

// ── The rollup ───────────────────────────────────────────────────────
const rep = (code: string, name: string, teamId = "t1"): Rep => ({
  id: code, code, name, email: "", cell: "", homeAddress: "", homeGpsLat: "", homeGpsLng: "", teamId,
});
const store = (id: string, repCode: string, six: number | undefined): Store => ({
  id, placeId: id, name: id, channelId: "c", repCode,
  gpsLat: "-26", gpsLng: "28", monthlySales: (six ?? 0) / 6,
  ...(six === undefined ? {} : { sixMonthSales: six }),
  frequency: "monthly", duration: 30, dayOfWeek: "", weekNumber: "",
});
const imsRow = (placeId: string, repCode: string): MapRow => ({
  placeId, status: "matched",
  flags: { noSales: false, dormant: false, duplicateAccount: false, repMismatch: false, closedInIms: false },
  imsName: placeId, imsProvince: null, imsChannel: null,
    imsSubChannel: null, imsRepCode: repCode,
  sixMonthSales: null, twinCode: null,
});

{
  const rows = buildRepActivity({
    reps: [rep("GAU075", "Sefrey"), rep("GAU039", "Victor")],
    stores: [
      store("S1", "GAU075", 6000000), // R1m a month
      store("S2", "GAU075", 600000),  // R100k a month
      store("S3", "GAU075", undefined), // never invoiced
      store("S4", "GAU039", 600000),
    ],
    teams: [{ id: "t1", name: "Inland 1" }],
    imsRows: { S1: imsRow("S1", "GAU075"), S2: imsRow("S2", "GAU086"), S4: imsRow("S4", "GAU039") },
    imsGhosts: [imsRow("G1", "GAU075"), imsRow("G2", "GAU075")],
    commission: EXCESS,
    newCyclePlan: null,
  });
  const sefrey = rows.find((r) => r.repCode === "GAU075")!;

  ok("the Repsly count is the router's own allocation", sefrey.storesRepsly === 3, String(sefrey.storesRepsly));
  ok("the IMS count follows the IMS rep code, not the router's",
    sefrey.storesIms === 3,
    "S1 plus two ghosts. S2 belongs to GAU086 in IMS, so it must not count here");
  ok("outlets nobody is routed to are counted separately", sefrey.storesImsOnly === 2);
  ok("a store with no IMS figure is counted, not treated as zero", sefrey.storesWithoutSales === 1);
  ok("portfolio adds only what IMS actually invoiced", near(sefrey.portfolioSixMonth, 6600000));
  ok("portfolio per month is the six-month figure divided by six", near(sefrey.portfolioMonthly, 1100000));
  ok("commission runs on the MONTHLY figure",
    near(sefrey.commission.earning, (1100000 - 550000) * 0.0325),
    String(sefrey.commission.earning));
  ok("the team name is resolved", sefrey.teamName === "Inland 1");

  const victor = rows.find((r) => r.repCode === "GAU039")!;
  ok("a rep under the threshold earns nothing", near(victor.commission.earning, 0));
  ok("and their shortfall is reported", near(victor.commission.shortfall, 450000), String(victor.commission.shortfall));

  ok("new cycle columns stay NULL when no plan is chosen",
    sefrey.newCycleStores === null && sefrey.newCyclePortfolioMonthly === null && sefrey.newCycleCommission === null,
    "a new cycle that silently equals the current one is the worst thing this page could show");

  const totals = totalRepActivity(rows);
  ok("totals count reps", totals.reps === 2);
  ok("totals sum the store counts", totals.storesRepsly === 4);
  ok("totals count only qualifying reps as earning", totals.qualifying === 1);
  ok("totals sum commission", near(totals.earning, sefrey.commission.earning));
}

// A rep with no stores at all must appear, not vanish.
{
  const rows = buildRepActivity({
    reps: [rep("NEW01", "Newcomer")],
    stores: [],
    teams: [],
    imsRows: {},
    imsGhosts: [],
    commission: EXCESS,
    newCyclePlan: null,
  });
  ok("a rep with no stores still gets a row", rows.length === 1,
    "31 reps currently have none, and they are exactly who this page is for");
  ok("their portfolio is zero, not NaN", near(rows[0].portfolioMonthly, 0));
  ok("their calls are zero", rows[0].callsPerMonth === 0);
}

// A plan visiting one store four times is still one store.
{
  const rows = buildRepActivity({
    reps: [rep("GAU075", "Sefrey")],
    stores: [store("S1", "GAU075", 6000000)],
    teams: [],
    imsRows: {},
    imsGhosts: [],
    commission: EXCESS,
    newCyclePlan: {
      id: "p1", generatedAt: "", generatedBy: "", repPlans: [
        {
          repCode: "GAU075", repName: "Sefrey", homeLatLng: null, workingHoursPerDay: 8.5, generatedAt: "",
          days: [
            { day: "Monday", week: "Wk1", stops: [{ storeId: "S1", storeName: "S1", lat: 0, lng: 0, visitDuration: 30, travelTimeFromPrev: 0, distanceFromPrev: 0, arrivalTime: "", departureTime: "", sequence: 1 }], totalTravelTime: 0, totalVisitTime: 0, totalTime: 0, totalDistance: 0, overCapacity: false },
            { day: "Monday", week: "Wk2", stops: [{ storeId: "S1", storeName: "S1", lat: 0, lng: 0, visitDuration: 30, travelTimeFromPrev: 0, distanceFromPrev: 0, arrivalTime: "", departureTime: "", sequence: 1 }], totalTravelTime: 0, totalVisitTime: 0, totalTime: 0, totalDistance: 0, overCapacity: false },
          ],
          stats: { totalStores: 1, unassignedStores: [] },
        },
      ],
      config: { useGoogleMaps: false, defaultStartTime: "08:00" },
    } as never,
  });
  ok("a store visited on two weeks counts ONCE in the new cycle", rows[0].newCycleStores === 1,
    "counting stops would inflate both the store count and the portfolio");
  ok("and its value is counted once", near(rows[0].newCyclePortfolioMonthly!, 1000000));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
