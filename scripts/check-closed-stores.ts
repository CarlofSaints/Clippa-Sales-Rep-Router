/**
 * Assertions for closing stores.
 *
 * Run: npx tsx scripts/check-closed-stores.ts
 *
 * This decides which shops a rep stops being sent to, so the cases that matter
 * most are the ones where it must stay SILENT: a store IMS has no opinion on, a
 * store closed by a human, and the reopen path, which is the one that can put a
 * dead shop back into a call cycle.
 */

import {
  planClosures,
  isClosed,
  activeStores,
  ACCC_CODE,
  setStatusByHand,
  storeStatus,
  closedReasonLabel,
  type ClosedReason,
} from "../lib/closedStores";
import type { Store } from "../lib/types";
import type { MapRow } from "../lib/mapStatus";

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
    channelId: "c1",
    repCode: "R1",
    gpsLat: "-26",
    gpsLng: "28",
    monthlySales: 0,
    frequency: "monthly",
    duration: 30,
    dayOfWeek: "",
    weekNumber: "",
    ...extra,
  };
}

function row(placeId: string, extra: Partial<MapRow> = {}): MapRow {
  return {
    placeId,
    status: "matched",
    flags: { noSales: false, dormant: false, duplicateAccount: false, repMismatch: false, closedInIms: false },
    imsName: null,
    imsProvince: null,
    imsChannel: null,
    imsRepCode: null,
    sixMonthSales: null,
    twinCode: null,
    ...extra,
  };
}

const rows = (list: MapRow[]) => Object.fromEntries(list.map((r) => [r.placeId, r]));

// ── ACCC is the signal Ago confirmed ────────────────────────────────────
{
  const stores = [store("A1"), store("A2"), store("A3")];
  const map = rows([
    row("A1", { imsRepCode: ACCC_CODE }),
    row("A2", { imsRepCode: "GAU050" }),
    row("A3", { imsRepCode: null }),
  ]);
  const plan = planClosures(stores, map);
  ok("a store on ACCC is closed", plan.toClose.some((m) => m.placeId === "A1"));
  ok("a store on a real rep code is NOT closed", !plan.toClose.some((m) => m.placeId === "A2"));
  ok("a store IMS has no rep code for is NOT closed", !plan.toClose.some((m) => m.placeId === "A3"),
    "silence is not a closure");
  ok("the reason names ACCC", plan.toClose[0]?.reason === "ims_accc");
  ok("byReason counts it under ACCC", plan.byReason.ims_accc === 1 && plan.byReason.ims_flag === 0);
}

// ── The IMS Closed Status flag is a SEPARATE signal, off by default ──────
{
  const stores = [store("B1"), store("B2")];
  const map = rows([
    row("B1", { flags: { noSales: false, dormant: false, duplicateAccount: false, repMismatch: false, closedInIms: true } }),
    row("B2", { imsRepCode: ACCC_CODE }),
  ]);

  const narrow = planClosures(stores, map);
  ok("the closed-status flag is IGNORED by default", !narrow.toClose.some((m) => m.placeId === "B1"),
    "Ago asked about ACCC; the flag covers three times as many stores");
  ok("ACCC still closes when the flag is off", narrow.toClose.some((m) => m.placeId === "B2"));

  const wide = planClosures(stores, map, { includeImsFlag: true });
  ok("the closed-status flag closes when asked for", wide.toClose.some((m) => m.placeId === "B1"));
  ok("the wider pass reports the two reasons separately",
    wide.byReason.ims_accc === 1 && wide.byReason.ims_flag === 1);
}

// ── A store that is BOTH keeps the more specific reason ──────────────────
{
  const map = rows([
    row("C1", {
      imsRepCode: ACCC_CODE,
      flags: { noSales: false, dormant: false, duplicateAccount: false, repMismatch: false, closedInIms: true },
    }),
  ]);
  const plan = planClosures([store("C1")], map, { includeImsFlag: true });
  ok("ACCC wins over the generic flag as the stated reason", plan.toClose[0]?.reason === "ims_accc");
  ok("and it is only counted once", plan.toClose.length === 1);
}

// ── Reopening: the failure that never heals ──────────────────────────────
{
  const map = rows([row("D1", { imsRepCode: "GAU050" })]);

  const auto = planClosures(
    [store("D1", { closed: true, closedReason: "ims_accc" as ClosedReason })],
    map
  );
  ok("a store IMS stopped calling closed is offered for reopening", auto.toReopen.length === 1,
    "without this a shop that reopens is never visited again");
  ok("it is not also in the close list", auto.toClose.length === 0);

  const manual = planClosures(
    [store("D1", { closed: true, closedReason: "manual" as ClosedReason })],
    map
  );
  ok("a HAND-closed store is never auto-reopened", manual.toReopen.length === 0,
    "IMS does not get to overrule a person");

  const stillShut = planClosures(
    [store("D1", { closed: true, closedReason: "ims_accc" as ClosedReason })],
    rows([row("D1", { imsRepCode: ACCC_CODE })])
  );
  ok("a store IMS still calls closed is NOT offered for reopening", stillShut.toReopen.length === 0);
  ok("and it counts as unchanged", stillShut.unchanged === 1);
}

// ── A "closed" store that is still buying is worth doubting ──────────────
{
  const plan = planClosures(
    [store("E1", { closed: true, closedReason: "ims_accc" as ClosedReason })],
    rows([row("E1", { imsRepCode: ACCC_CODE, sixMonthSales: 250000 })])
  );
  ok("a closed store with sales is surfaced", plan.closedButSelling.length === 1,
    "a shop that is still invoicing is not shut");
  ok("its value is carried so it can be judged", plan.closedButSelling[0]?.sixMonthSales === 250000);
}

// ── The exclusion helper every consumer shares ───────────────────────────
{
  const list = [store("F1"), store("F2", { closed: true }), store("F3", { closed: false })];
  ok("isClosed is true only for closed", !isClosed(list[0]) && isClosed(list[1]) && !isClosed(list[2]));
  ok("activeStores drops the closed one", activeStores(list).map((s) => s.placeId).join(",") === "F1,F3");
  ok("an absent flag reads as open", !isClosed(store("F4")),
    "these records predate the field, so absent must mean open");
}

// ── Ordering: the biggest thing you are about to close is at the top ─────
{
  const stores = [store("G1"), store("G2"), store("G3")];
  const map = rows([
    row("G1", { imsRepCode: ACCC_CODE, sixMonthSales: 100 }),
    row("G2", { imsRepCode: ACCC_CODE, sixMonthSales: 900000 }),
    row("G3", { imsRepCode: ACCC_CODE, sixMonthSales: null }),
  ]);
  const plan = planClosures(stores, map);
  ok("the highest-value closure sorts first", plan.toClose[0]?.placeId === "G2");
  ok("a store with no figure sinks, it does not read as zero", plan.toClose[2]?.placeId === "G3");
}

// ── A Map works as well as a plain object ───────────────────────────────
{
  const m = new Map<string, MapRow>([["H1", row("H1", { imsRepCode: ACCC_CODE })]]);
  ok("planClosures accepts a Map", planClosures([store("H1")], m).toClose.length === 1);
}

// ── Place IDs are matched case- and space-insensitively ──────────────────
{
  const plan = planClosures([store(" a9 ")], rows([row("A9", { imsRepCode: ACCC_CODE })]));
  ok("a padded, lowercase place id still matches", plan.toClose.length === 1,
    "these ids arrive from spreadsheets");
}


// -- A person setting the status by hand --------------------------------------
//
// This is the half that did not exist. The field, the route engine and the bulk
// IMS pass were all shipped; nothing could set it on ONE store, because the
// stores route never accepted it. These assert the write itself, not the page.
{
  const open = store('H1');
  const closedByHand = { ...open, ...setStatusByHand(open, true, '2026-09-02T10:00:00.000Z') };

  ok("closing by hand sets closed", closedByHand.closed === true);
  ok("closing by hand records manual, never the IMS reason", closedByHand.closedReason === "manual", String(closedByHand.closedReason));
  ok("closing by hand stamps the time", closedByHand.closedAt === "2026-09-02T10:00:00.000Z");
  ok("closing by hand marks it as a human decision", closedByHand.statusDecidedByHand === true);

  // Reopening has to CLEAR the reason. A store that is open has no reason to be
  // shut, and a leftover one shows 'IMS account closed' in the tooltip forever.
  const reopened = { ...closedByHand, ...setStatusByHand(closedByHand, false) };
  ok("reopening clears closed", reopened.closed === false);
  ok("reopening clears the reason", reopened.closedReason === undefined, String(reopened.closedReason));
  ok("reopening clears the timestamp", reopened.closedAt === undefined, String(reopened.closedAt));
  ok("reopening is ALSO a human decision", reopened.statusDecidedByHand === true);

  ok("storeStatus reads closed", storeStatus(closedByHand) === "closed");
  ok("storeStatus reads active", storeStatus(reopened) === "active");
  ok("an open store has no reason label", closedReasonLabel(reopened) === null);
  ok("a hand-closed store says so in words", closedReasonLabel(closedByHand) === "Closed by hand");
  // Closed before the reason field existed. A blank tooltip is not an answer.
  ok("a closed store with no reason still gets a label", closedReasonLabel(store("H9", { closed: true })) === "Closed");
}

// -- A human decision outranks the automatic pass, in BOTH directions ---------
//
// The old rule protected a hand-CLOSED store from being reopened but left a
// hand-REOPENED one exposed: IMS still carries the flag, so the next closure
// run would shut it again and the person who reopened it would never be told.
{
  const imsSaysShut = row('K1', { flags: { noSales: false, dormant: false, duplicateAccount: false, repMismatch: false, closedInIms: true } });

  // Reopened by hand, IMS still flags it.
  const reopenedByHand = store('K1', { closed: false, statusDecidedByHand: true });
  const plan = planClosures([reopenedByHand], { K1: imsSaysShut }, { includeImsFlag: true });
  ok("a hand-reopened store is NOT closed again by the IMS pass", plan.toClose.length === 0, `${plan.toClose.length} would close`);

  // The same store with nobody having ruled on it still closes, so the guard
  // is doing something narrower than switching the feature off.
  const untouched = store('K1');
  const plan2 = planClosures([untouched], { K1: imsSaysShut }, { includeImsFlag: true });
  ok("an untouched store IS still closed by the IMS pass", plan2.toClose.length === 1, `${plan2.toClose.length} would close`);

  // And the direction that already worked still works.
  const closedByHand = store('K2', { closed: true, closedReason: 'manual', statusDecidedByHand: true });
  const silent = row('K2');
  const plan3 = planClosures([closedByHand], { K2: silent }, { includeImsFlag: true });
  ok("a hand-closed store is NOT reopened by the IMS pass", plan3.toReopen.length === 0, `${plan3.toReopen.length} would reopen`);

  // Still counted, and still reported as selling. Skipping the ACTION must not
  // mean hiding the store from the numbers.
  const sellingWhileShut = store('K3', { closed: true, statusDecidedByHand: true });
  const withSales = row('K3', { sixMonthSales: 12345 });
  const plan4 = planClosures([sellingWhileShut], { K3: withSales }, { includeImsFlag: true });
  ok("a hand-decided store is still counted as unchanged", plan4.unchanged === 1);
  ok("a hand-decided store still appears as closed-but-selling", plan4.closedButSelling.length === 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
