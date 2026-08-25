/**
 * Assertions for the Data Health checks.
 *
 * Run: npx tsx scripts/check-data-health.ts
 *
 * Each check gets a case that SHOULD fire and a case that should NOT, because a
 * check that reports everything is as useless as one that reports nothing, and
 * only the second kind is obvious from a screenshot.
 */

import { buildDataHealthReport, gpsProblem, HealthIssue } from "../lib/dataHealth";
import { Channel, Rep, Store, StoreOverride } from "../lib/types";

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`PASS  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function eq(label: string, actual: unknown, expected: unknown) {
  ok(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

const rep = (o: Partial<Rep> = {}): Rep => ({
  id: o.id ?? crypto.randomUUID(),
  code: o.code ?? "GAU001",
  name: o.name ?? "A Rep",
  email: o.email ?? "a@clippasales.com",
  cell: o.cell ?? "",
  homeAddress: o.homeAddress ?? "",
  homeGpsLat: o.homeGpsLat ?? "",
  homeGpsLng: o.homeGpsLng ?? "",
  teamId: o.teamId ?? "",
  workingHoursPerDay: o.workingHoursPerDay ?? 8.5,
});

const store = (o: Partial<Store> = {}): Store => ({
  id: o.id ?? crypto.randomUUID(),
  placeId: o.placeId ?? "P1",
  name: o.name ?? "A Shop",
  channelId: o.channelId ?? "indep",
  repCode: o.repCode ?? "GAU001",
  gpsLat: o.gpsLat ?? "-26.10",
  gpsLng: o.gpsLng ?? "28.05",
  monthlySales: o.monthlySales ?? 0,
  frequency: o.frequency ?? "monthly",
  duration: o.duration ?? 30,
  dayOfWeek: o.dayOfWeek ?? "",
  weekNumber: o.weekNumber ?? "",
  province: o.province,
  region: o.region,
  rangeConfirmed: o.rangeConfirmed,
});

const CHANNELS: Channel[] = [{ id: "indep", name: "Independent", frequency: "monthly", duration: 30 }];

const run = (reps: Rep[], stores: Store[], channels = CHANNELS, overrides: StoreOverride[] = []) =>
  buildDataHealthReport({ reps, stores, channels, overrides, outlierRadiusKm: 50 });

const find = (r: ReturnType<typeof run>, id: string): HealthIssue => {
  const i = r.issues.find((x) => x.id === id);
  if (!i) throw new Error(`no check called ${id}`);
  return i;
};

console.log("\n--- the GPS rule ---\n");

eq("a good coordinate has no problem", gpsProblem(store()), null);
eq("a blank latitude is blank", gpsProblem(store({ gpsLat: "" })), "blank");
eq("a blank longitude is blank too", gpsProblem(store({ gpsLng: "  " })), "blank");
eq("non-numeric is blank, not a crash", gpsProblem(store({ gpsLat: "n/a" })), "blank");
eq("0,0 is its own kind", gpsProblem(store({ gpsLat: "0", gpsLng: "0" })), "zero");
eq("San Francisco is outside SA", gpsProblem(store({ gpsLat: "37.79", gpsLng: "-122.40" })), "outside");
eq("a lost minus sign is outside SA", gpsProblem(store({ gpsLat: "26.10", gpsLng: "28.05" })), "outside");
eq("Cape Town is inside", gpsProblem(store({ gpsLat: "-33.92", gpsLng: "18.42" })), null);

console.log("\n--- checks fire when they should ---\n");

{
  const r = run([rep({ code: "GAU001" })], [store({ repCode: "NW002" })]);
  eq("a store naming an unknown rep is caught", find(r, "stores-unknown-rep").count, 1);
  eq("...and counted as blocking", find(r, "stores-unknown-rep").severity, "blocking");
}
{
  const r = run([rep({ code: "GAU001" })], [store({ repCode: "" })]);
  eq("a store with no rep code is caught", find(r, "stores-no-rep").count, 1);
}
{
  const r = run([rep({ code: "GAU001" })], [
    store({ gpsLat: "", gpsLng: "" }),
    store({ gpsLat: "0", gpsLng: "0" }),
    store({ gpsLat: "37.79", gpsLng: "-122.40" }),
    store(),
  ]);
  eq("blank GPS is its own check", find(r, "stores-gps-blank").count, 1);
  eq("0,0 is its own check", find(r, "stores-gps-zero").count, 1);
  eq("outside SA is its own check", find(r, "stores-gps-outside").count, 1);
}
{
  const r = run([rep({ code: "GAU001" }), rep({ code: "GAU002" })], [store({ repCode: "GAU001" })]);
  eq("a rep nobody's stores name is caught", find(r, "reps-no-stores").count, 1);
  eq("...identified by code", find(r, "reps-no-stores").rows[0][0], "GAU002");
}
{
  const r = run(
    [rep({ code: "A1", email: "same@x.com" }), rep({ code: "A2", email: "SAME@x.com" })],
    [store({ repCode: "A1" }), store({ repCode: "A2" })]
  );
  eq("two reps on one email is caught regardless of case", find(r, "reps-shared-email").count, 2);
}
{
  const r = run([rep({ code: "A1", email: "" }), rep({ code: "A2", email: "nope" })], [store({ repCode: "A1" })]);
  eq("a blank and a malformed email are both caught", find(r, "reps-no-email").count, 2);
}
{
  const r = run([rep({ homeAddress: "1 Main Rd" })], [store()]);
  eq("an address with no coordinates is caught", find(r, "reps-address-no-gps").count, 1);
}
{
  const r = run([rep({ code: "GAU001" })], [store({ channelId: "ghost" })]);
  eq("an unknown channel id is caught", find(r, "stores-no-channel").count, 1);
}
{
  const r = run([rep({ code: "GAU001" })], [store({ frequency: "weekly" })]);
  eq("a store out of step with its channel is caught", find(r, "stores-channel-mismatch").count, 1);
  eq("...and only as info, since it still routes", find(r, "stores-channel-mismatch").severity, "info");
}
{
  // Far enough that it clears the 50km radius from the median of the cluster.
  const near = Array.from({ length: 5 }, () => store({ gpsLat: "-26.10", gpsLng: "28.05" }));
  const far = store({ name: "Far Shop", gpsLat: "-29.85", gpsLng: "31.02" });
  const r = run([rep({ code: "GAU001" })], [...near, far]);
  ok("a store far outside the rep's area is caught", find(r, "stores-outliers").count >= 1);
}
{
  const dup = { name: "Same Shop", repCode: "GAU001" };
  const r = run([rep({ code: "GAU001" })], [store({ ...dup, placeId: "P1" }), store({ ...dup, placeId: "P2" })]);
  ok("the same shop recorded twice is caught", find(r, "stores-duplicates").count >= 2);
}

console.log("\n--- and stay quiet when they should ---\n");

{
  const clean = run(
    [rep({ code: "GAU001", email: "a@x.com", homeAddress: "1 Main Rd", homeGpsLat: "-26.1", homeGpsLng: "28.05" })],
    [store({ placeId: "P1", name: "Shop One" }), store({ placeId: "P2", name: "Shop Two" })]
  );
  const noisy = clean.issues.filter((i) => i.count > 0);
  eq("a clean system reports nothing at all", noisy.map((i) => i.id), []);
  eq("...but every check still appears, so a pass is visible", clean.issues.length >= 11, true);
  eq("...with nothing counted as blocking", clean.totals.blocking, 0);
}
{
  const r = run([rep({ code: "GAU001" })], [store({ rangeConfirmed: true, gpsLat: "-29.85", gpsLng: "31.02" }), store(), store(), store(), store()]);
  eq("a store confirmed in-cycle is not reported as an outlier", find(r, "stores-outliers").count, 0);
}
{
  const override = {
    id: "o1", storeId: "S1", storeName: "A Shop", placeId: "P1", channelId: "indep", repCode: "GAU001",
    defaultFrequency: "monthly" as const, defaultDuration: 30, frequency: "weekly" as const, duration: 45,
    approvalStatus: "approved" as const, createdBy: "x", createdAt: "", updatedAt: "",
  };
  const r = run([rep({ code: "GAU001" })], [store({ id: "S1", frequency: "weekly", duration: 45 })], CHANNELS, [override]);
  eq("a store pinned by an approved override is not reported as a mismatch", find(r, "stores-channel-mismatch").count, 0);
}
{
  const r = run([rep({ code: "gau001" })], [store({ repCode: "GAU001" })]);
  eq("rep codes match regardless of case", find(r, "stores-unknown-rep").count, 0);
  eq("...both directions", find(r, "reps-no-stores").count, 0);
}
{
  const r = run([rep({ code: "GAU001" })], [store({ repCode: "" })]);
  eq("a store with NO rep code is not double-counted as an unknown rep", find(r, "stores-unknown-rep").count, 0);
}

console.log("\n--- the report as a whole ---\n");

{
  const r = run([rep({ code: "GAU001" })], [
    store({ repCode: "NW002" }),
    store({ repCode: "" }),
    store({ gpsLat: "", gpsLng: "" }),
    store(),
  ]);
  eq("blocked stores are counted once each, not once per check", r.totals.storesBlocked, 3);
  ok("blocking issues sort above warnings", r.issues[0].severity === "blocking");
  const withRows = r.issues.filter((i) => i.count > 0);
  ok("every reported issue carries its columns", withRows.every((i) => i.columns.length > 0));
  ok("every row has one cell per column", withRows.every((i) => i.rows.every((row) => row.length === i.columns.length)));
  ok("every issue says what to do about it", r.issues.every((i) => i.action.length > 10));
  ok("every issue id is unique", new Set(r.issues.map((i) => i.id)).size === r.issues.length);
  ok("no issue id would break an Excel sheet name", r.issues.every((i) => i.id.length <= 31 && !/[:\\/?*[\]]/.test(i.id)));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
