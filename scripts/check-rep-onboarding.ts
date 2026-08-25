/**
 * Assertions for getting reps INTO the app and giving them a login.
 *
 * Run: npx tsx scripts/check-rep-onboarding.ts
 *
 * Everything here is pure — no blob, no session, no network — so it can be run
 * against the real shipped modules rather than a copy of them.
 */

import { applyRepImport, parseRepSheet, tidyName, looksLikeEmail } from "../lib/repImport";
import { buildCoverageReport } from "../lib/coverage";
import { isRepAllowedPath } from "../lib/repAccess";
import { generateTempPassword } from "../lib/tempPassword";
import { Rep, Store } from "../lib/types";

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

const rep = (over: Partial<Rep> = {}): Rep => ({
  id: over.id ?? crypto.randomUUID(),
  code: over.code ?? "GAU001",
  name: over.name ?? "Existing Person",
  email: over.email ?? "",
  cell: over.cell ?? "",
  homeAddress: over.homeAddress ?? "",
  homeGpsLat: over.homeGpsLat ?? "",
  homeGpsLng: over.homeGpsLng ?? "",
  teamId: over.teamId ?? "",
  workingHoursPerDay: over.workingHoursPerDay ?? 8.5,
});

const store = (over: Partial<Store> = {}): Store => ({
  id: over.id ?? crypto.randomUUID(),
  placeId: over.placeId ?? "P1",
  name: over.name ?? "A Shop",
  channelId: over.channelId ?? "independent",
  repCode: over.repCode ?? "GAU001",
  gpsLat: over.gpsLat ?? "-26.1",
  gpsLng: over.gpsLng ?? "28.0",
  monthlySales: over.monthlySales ?? 0,
  frequency: over.frequency ?? "monthly",
  duration: over.duration ?? 30,
  dayOfWeek: over.dayOfWeek ?? "",
  weekNumber: over.weekNumber ?? "",
  province: over.province,
  region: over.region,
});

console.log("\n--- rep import: matching and creation ---\n");

{
  const existing = [rep({ code: "GAU001", name: "Existing Person" })];
  const r = applyRepImport(existing, [
    { code: "gau001", email: "one@clippasales.com" },
    { code: "NW002", name: "CHANEL COETZEE", email: "chanel@clippasales.com" },
  ]);
  eq("an existing code is matched case-insensitively", r.updated.length, 1);
  eq("an unknown code is created", r.created.length, 1);
  eq("the created rep keeps the file's casing of the code", r.reps[1].code, "NW002");
  eq("a SHOUTED name is tidied on create", r.reps[1].name, "Chanel Coetzee");
  eq("the email lands on the existing rep", r.reps[0].email, "one@clippasales.com");
  eq("a new rep starts with no home GPS", [r.reps[1].homeGpsLat, r.reps[1].homeGpsLng], ["", ""]);
  eq("a new rep gets the default working day", r.reps[1].workingHoursPerDay, 8.5);
}

{
  const existing = [rep({ code: "GAU001", email: "already@clippasales.com" })];
  const r = applyRepImport(existing, [{ code: "GAU001", email: "already@clippasales.com" }]);
  eq("re-importing the same email changes nothing", r.updated.length, 0);
  eq("...and is counted as unchanged", r.unchanged, 1);
}

console.log("\n--- rep import: what it refuses to do ---\n");

{
  // The whole point of the rule: a cut-down sheet must not wipe what it omits.
  const existing = [rep({ code: "GAU001", email: "keep@clippasales.com", cell: "0821234567" })];
  const r = applyRepImport(existing, [{ code: "GAU001", email: "keep@clippasales.com" }]);
  eq("a column absent from the file leaves the field alone", r.reps[0].cell, "0821234567");
}

{
  const existing = [rep({ code: "GAU001", email: "keep@clippasales.com" })];
  const r = applyRepImport(existing, [{ code: "GAU001", email: "" }]);
  eq("a BLANK email cell does not wipe the address", r.reps[0].email, "keep@clippasales.com");
  eq("...and nothing is reported as updated", r.updated.length, 0);
}

{
  const existing = [rep({ code: "GAU001", name: "Tony Debrito" })];
  const r = applyRepImport(existing, [{ code: "GAU001", name: "TONY DE BRITO", email: "t@clippasales.com" }]);
  eq("a differing name is NOT written over the app's version", r.reps[0].name, "Tony Debrito");
  eq("...but it is reported", r.nameDifferences.length, 1);
  eq("...with both spellings", r.nameDifferences[0].inFile, "Tony De Brito");
}

{
  const existing = [rep({ code: "GAU001" })];
  const r = applyRepImport(existing, [{ code: "GAU001", email: "not-an-email" }]);
  eq("a malformed email is rejected, not stored", r.rejected.length, 1);
  eq("...and the rep is untouched", r.reps[0].email, "");
}

{
  const r = applyRepImport([], [{ code: "", email: "x@y.com" }]);
  eq("a row with no rep code is rejected", r.rejected.length, 1);
  eq("...and creates nothing", r.created.length, 0);
}

{
  // Changing an address must drop coordinates derived from the OLD one, or the
  // rep's week anchors on where they used to live.
  const existing = [
    rep({ code: "GAU001", homeAddress: "1 Old Road", homeGpsLat: "-26.1", homeGpsLng: "28.0" }),
  ];
  const r = applyRepImport(existing, [{ code: "GAU001", homeAddress: "2 New Road" }]);
  eq("a changed home address clears the old coordinates", [r.reps[0].homeGpsLat, r.reps[0].homeGpsLng], ["", ""]);
}

{
  const r = applyRepImport([], [
    { code: "CPT004", name: "Jaime Rodrigues", email: "jaime@clippasales.com" },
    { code: "CPT007CB", name: "Jaime Cock And Bull", email: "jaime@clippasales.com" },
  ]);
  ok("two reps sharing one email is warned about", r.warnings.some((w) => w.includes("jaime@clippasales.com")));
  eq("...but both reps are still created", r.created.length, 2);
}

{
  const r = applyRepImport([], [
    { code: "GAU001", email: "first@clippasales.com" },
    { code: "GAU001", email: "second@clippasales.com" },
  ]);
  ok("a code repeated in the file is warned about", r.warnings.some((w) => w.includes("GAU001")));
  eq("...and the last row wins", r.reps[0].email, "second@clippasales.com");
}

console.log("\n--- header parsing ---\n");

{
  const sheet = [
    ["REPCODE", "REPNAME", "REPEMAILADDRESS"],
    ["NW002", "CHANEL COETZEE", "chanel@clippasales.com"],
  ];
  const p = parseRepSheet(sheet);
  eq("the client's own headers are understood", p.rows.length, 1);
  eq("...and map to the right fields", p.rows[0].email, "chanel@clippasales.com");
}

{
  const sheet = [
    ["Rep Code", "Rep Name", "Email", "Cell Number", "Home Address", "Hours/Day"],
    ["NW002", "Chanel Coetzee", "chanel@clippasales.com", "0821234567", "1 Main Rd", "9"],
  ];
  const p = parseRepSheet(sheet);
  eq("the app's own export headers round trip", p.rows.length, 1);
  eq("...including hours as a number", p.rows[0].workingHoursPerDay, 9);
  eq("...and the home address", p.rows[0].homeAddress, "1 Main Rd");
}

{
  const sheet = [
    ["CLIPPA REP LIST"],
    [],
    ["REPCODE", "REPEMAILADDRESS"],
    ["NW002", "chanel@clippasales.com"],
  ];
  const p = parseRepSheet(sheet);
  eq("a title above the headers does not break the parse", p.headerRowIndex, 2);
  eq("...and the rows below are read", p.rows.length, 1);
}

{
  const p = parseRepSheet([["Store", "Channel"], ["A", "B"]]);
  ok("a file with no rep code column is refused", !!p.error);
  ok("...and the error quotes the file's real headers", (p.error || "").includes("Store"));
}

console.log("\n--- coverage ---\n");

{
  const reps = [rep({ code: "GAU001" }), rep({ code: "GAU002" })];
  const stores = [
    store({ repCode: "GAU001" }),
    store({ repCode: "GAU001" }),
    store({ repCode: "NW002", province: "North West", gpsLat: "", gpsLng: "" }),
    store({ repCode: "" }),
  ];
  const c = buildCoverageReport(reps, stores);
  eq("stores on a known rep are counted as routable", c.summary.storesOnMatchedReps, 2);
  eq("a rep code with no rep record is flagged", c.summary.unmatchedCodes, 1);
  eq("...with its store count", c.unmatched[0].storeCount, 1);
  eq("...and its provinces", c.unmatched[0].provinces, ["North West"]);
  eq("...and how many of them have unusable GPS", c.unmatched[0].storesWithBadGps, 1);
  eq("a store with no rep code at all is counted separately", c.summary.storesWithNoRepCode, 1);
  eq("a rep nobody's stores name is listed as idle", c.idleReps.map((r) => r.code), ["GAU002"]);
  eq("coverage is a share of ALL stores, not just the coded ones", c.summary.coveragePercent, 50);
}

{
  const c = buildCoverageReport([rep({ code: "GAU001" })], [store({ repCode: "gau001" })]);
  eq("rep codes match regardless of case", c.summary.unmatchedCodes, 0);
}

{
  const c = buildCoverageReport([], []);
  eq("an empty system does not divide by zero", c.summary.coveragePercent, 0);
}

console.log("\n--- what a rep login may reach ---\n");

eq("a rep may open their own profile", isRepAllowedPath("/account"), true);
eq("a rep may call their own profile API", isRepAllowedPath("/api/account/rep-profile"), true);
eq("a rep may sign in and out", isRepAllowedPath("/api/auth"), true);
eq("a rep may change their password on first sign-in", isRepAllowedPath("/api/auth/change-password"), true);
eq("a rep may NOT open the rep list", isRepAllowedPath("/reps"), false);
eq("a rep may NOT read the store table", isRepAllowedPath("/api/stores"), false);
eq("a rep may NOT read routes", isRepAllowedPath("/api/routes"), false);
eq("a rep may NOT reach coverage", isRepAllowedPath("/admin/coverage"), false);
eq("a rep may NOT create logins", isRepAllowedPath("/api/reps/create-account"), false);
// The reason the check is path-segment aware rather than a plain prefix match.
eq("a lookalike path is not let through by /account", isRepAllowedPath("/accounts-payable"), false);
eq("...nor by the API entry", isRepAllowedPath("/api/accounts"), false);

console.log("\n--- temporary passwords ---\n");

{
  const one = generateTempPassword();
  const many = new Set(Array.from({ length: 500 }, generateTempPassword));
  ok("a temp password is prefixed so it is recognisable", one.startsWith("Clippa-"));
  eq("500 draws produce 500 different passwords", many.size, 500);
  ok("no ambiguous characters (0/O/1/l/I) appear", !/[0O1lI]/.test(one.slice(7)));
}

console.log("\n--- email shape ---\n");

eq("a normal address passes", looksLikeEmail("grant.gerber@clippasales.com"), true);
eq("a blank does not", looksLikeEmail("   "), false);
eq("a bare name does not", looksLikeEmail("grant"), false);
eq("an address with a space does not", looksLikeEmail("a b@c.com"), false);
eq("tidyName leaves human casing alone", tidyName("Tony Debrito"), "Tony Debrito");
eq("tidyName handles a hyphen", tidyName("NADIA VD WESTHUIZEN-SMIT"), "Nadia Vd Westhuizen-Smit");

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
