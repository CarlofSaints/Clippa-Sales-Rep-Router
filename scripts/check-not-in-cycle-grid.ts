/**
 * Assertions for the "stores not in a cycle" grid.
 *
 * Run: npx tsx scripts/check-not-in-cycle-grid.ts
 *
 * The grid is a to-do list, so the ways it can mislead are about what it hides
 * and how it orders. The cases below are the ones that would quietly matter: a
 * store with no sales figure sorting as the worst seller, the open/closed split
 * losing a row, and a team filter reaching past what a user may see.
 *
 * The reason logic itself lives in check-not-in-cycle; this covers the
 * row-level filtering and sorting the page layers on top.
 */

import { findNotInCycle, REASONS, type NotInCycleReason } from "../lib/notInCycle";
import { matchesTeam, NO_TEAM, type TeamSelection } from "../lib/teamFilter";
import { buildStoreRanks } from "../lib/storeRanks";
import { knownSixMonthSales } from "../lib/storeValue";
import { isClosed } from "../lib/closedStores";
import type { Channel, Rep, RoutePlanDocument, RouteDayPlan, Store, Team } from "../lib/types";

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

function store(id: string, over: Partial<Store> = {}): Store {
  return {
    id, placeId: id, name: `Store ${id}`, channelId: "spar", repCode: "R1",
    gpsLat: "-26.1", gpsLng: "28.0", monthlySales: 0,
    frequency: "monthly", duration: 30, dayOfWeek: "", weekNumber: "", ...over,
  } as Store;
}

const channels: Channel[] = [
  { id: "spar", name: "SPAR", frequency: "monthly", duration: 30 } as Channel,
  { id: "wholesale", name: "Wholesale", frequency: "monthly", duration: 30, notARepChannel: true } as Channel,
];

const teams: Team[] = [
  { id: "t1", name: "Pretoria", managerName: "Alec", managerEmail: "alec@example.com" } as Team,
];

const reps: Rep[] = [
  { id: "1", code: "R1", name: "Rep One", teamId: "t1" } as Rep,
  { id: "2", code: "R2", name: "Rep Two", teamId: "" } as Rep,
];

function day(ids: string[]): RouteDayPlan {
  return {
    day: "Monday", week: "Wk1",
    stops: ids.map((id, i) => ({
      storeId: id, storeName: id, lat: -26.1, lng: 28.0, visitDuration: 30,
      travelTimeFromPrev: 0, distanceFromPrev: 0, arrivalTime: "08:00",
      departureTime: "08:30", sequence: i + 1,
    })),
    totalTravelTime: 0, totalVisitTime: 30, totalTime: 30, totalDistance: 0, overCapacity: false,
  };
}

const routes = {
  generatedAt: "", repPlans: [
    { repCode: "R1", repName: "Rep One", homeLatLng: { lat: -26, lng: 28 }, workingHoursPerDay: 8.5,
      generatedAt: "", days: [day(["visited"])],
      stats: { totalStores: 0, unassignedStores: [
        { storeId: "big", storeName: "big", reason: "Over the 8 calls per day target" },
        { storeId: "small", storeName: "small", reason: "Over the 8 calls per day target" },
        { storeId: "unmeasured", storeName: "unmeasured", reason: "Over the 8 calls per day target" },
      ] } },
  ],
} as RoutePlanDocument;

const stores: Store[] = [
  store("visited", { sixMonthSales: 10_000 }),
  store("big", { sixMonthSales: 500_000 }),
  store("small", { sixMonthSales: 1_000 }),
  store("unmeasured"),                                  // no figure at all
  store("shut", { sixMonthSales: 900_000, closed: true }),
  store("nochannel", { channelId: "wholesale", sixMonthSales: 50_000 }),
  store("otherrep", { repCode: "R2", sixMonthSales: 70_000 }),
];

const base = { stores, channels, overrides: [], subChannels: [], routes };
const result = findNotInCycle(base);
const ranks = buildStoreRanks(stores);
const rows = result.missing;

// ── What lands on the list ────────────────────────────────────────────────
{
  ok("a visited store is not on the list", !rows.some((r) => r.store.id === "visited"));
  ok("every other store is", rows.length === stores.length - 1, String(rows.length));
  ok("the numbers reconcile", result.scheduled + rows.length === result.totalStores);
}

// ── 🔴 Open / closed must not lose a row ──────────────────────────────────
{
  const open = rows.filter((r) => !isClosed(r.store));
  const closed = rows.filter((r) => isClosed(r.store));
  ok("open + closed accounts for every row", open.length + closed.length === rows.length);
  ok("the closed store is in the closed bucket only",
    closed.length === 1 && closed[0].store.id === "shut");
  // The default view is OPEN, and it must not hide a high-value open store.
  ok("the biggest OPEN store is on the default view",
    open.some((r) => r.store.id === "big"));
  ok("a closed store is still reachable, not deleted",
    closed.some((r) => r.store.id === "shut"));
}

// ── 🔴 Sorting: no figure must not read as the worst seller ───────────────
{
  const sortValue = (s: Store) => {
    const v = knownSixMonthSales(s);
    return v === null ? -Infinity : v;
  };
  // Sorted within the DEFAULT view (open only) — the closed R900k store
  // legitimately outsells everything, and would top an unfiltered sort.
  const desc = rows
    .filter((r) => !isClosed(r.store))
    .sort((a, b) => sortValue(b.store) - sortValue(a.store));
  ok("best OPEN seller sorts first descending", desc[0].store.id === "big", desc[0].store.id);
  ok("and the closed bigger seller tops the sort when closed rows are included",
    [...rows].sort((a, b) => sortValue(b.store) - sortValue(a.store))[0].store.id === "shut");
  ok("the unmeasured store sorts LAST descending, not among the zeros",
    desc[desc.length - 1].store.id === "unmeasured", desc[desc.length - 1].store.id);

  // And it is shown as a dash, never as R 0 — which the rank confirms.
  ok("an unmeasured store has no rank to show", ranks.get("unmeasured")!.overall === null);
  ok("a measured one does", ranks.get("big")!.overall !== null);
}

// ── Team filtering, and the store whose rep has no team ───────────────────
{
  const pretoria: TeamSelection = { leaderId: "alec@example.com", teamId: "t1" };
  const repByCode = new Map(reps.map((r) => [r.code, r]));
  const inTeam = (s: Store) => matchesTeam(teams, pretoria, repByCode.get(s.repCode)?.teamId);

  ok("a Pretoria rep's store passes the Pretoria filter", inTeam(store("x", { repCode: "R1" })));
  ok("another rep's store does not", !inTeam(store("y", { repCode: "R2" })));

  const noTeam: TeamSelection = { leaderId: "", teamId: NO_TEAM };
  ok("the teamless rep's store is reachable under No team",
    matchesTeam(teams, noTeam, repByCode.get("R2")?.teamId));
  // 🔴 A store whose rep code matches NO rep record at all still has to be
  // reachable, or it is invisible on every filter and can never be fixed.
  ok("a store on an unknown rep code counts as having no team",
    matchesTeam(teams, noTeam, repByCode.get("GHOST")?.teamId));
}

// ── Reason filter ─────────────────────────────────────────────────────────
{
  for (const r of Object.keys(REASONS) as NotInCycleReason[]) {
    const matching = rows.filter((x) => x.reason === r);
    ok(`reason "${r}" filters to exactly its counted rows`,
      matching.length === result.counts[r],
      `${matching.length} vs ${result.counts[r]}`);
  }
  ok("the counts add up to the whole list",
    (Object.keys(REASONS) as NotInCycleReason[]).reduce((s, r) => s + result.counts[r], 0) === rows.length);
}

// ── Role scoping is not a filter ──────────────────────────────────────────
{
  // A user who may only see R2 must not be shown R1's gaps, whatever they pick.
  const scoped = findNotInCycle({ ...base, visibleRepCodes: new Set(["R2"]) });
  ok("role scoping hides another rep's stores entirely",
    scoped.missing.every((r) => r.store.repCode === "R2"),
    scoped.missing.map((r) => r.store.repCode).join(","));
  ok("and the totals reflect only what may be seen", scoped.totalStores === 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
