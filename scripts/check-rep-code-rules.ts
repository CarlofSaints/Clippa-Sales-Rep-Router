/**
 * Assertions for "which rep codes are actually a rep".
 *
 * Run: npx tsx scripts/check-rep-code-rules.ts
 *
 * Pure — no blob, no session, no network — so it runs against the real shipped
 * modules. The precedence rules are the whole feature: a prefix that could not
 * be overridden, or an absent decision that read as "excluded", would silently
 * unroute the entire book.
 */

import {
  normaliseRepCode,
  resolveRepCode,
  isRoutableRepCode,
  setRepCodeDecision,
  addRepCodePrefix,
  removeRepCodePrefix,
  summariseRepCodes,
  EMPTY_REP_CODE_RULES,
  type CodeFacts,
} from "../lib/repCodeRules";
import { applyRepImport } from "../lib/repImport";
import { generateRepRoute } from "../lib/route-engine";
import type { Rep, RepCodeRules, Store } from "../lib/types";

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

const WHO = "carl@example.com";

const facts = (over: Partial<CodeFacts> = {}): CodeFacts => ({
  code: over.code ?? "GAU001",
  imsOutlets: over.imsOutlets ?? 0,
  imsUnrouted: over.imsUnrouted ?? 0,
  sixMonthSales: over.sixMonthSales ?? 0,
  unroutedSixMonthSales: over.unroutedSixMonthSales ?? 0,
  routerStores: over.routerStores ?? 0,
  repName: over.repName ?? null,
});

const rep = (over: Partial<Rep> = {}): Rep => ({
  id: over.id ?? "rep-1",
  code: over.code ?? "GAU001",
  name: over.name ?? "Test Person",
  email: over.email ?? "test@example.com",
  cell: "",
  homeAddress: "",
  homeGpsLat: over.homeGpsLat ?? "",
  homeGpsLng: over.homeGpsLng ?? "",
  teamId: "",
  workingHoursPerDay: 8.5,
});

const store = (over: Partial<Store> = {}): Store =>
  ({
    id: over.id ?? crypto.randomUUID(),
    placeId: over.placeId ?? "P1",
    name: over.name ?? "Shop",
    channelId: "c1",
    repCode: over.repCode ?? "GAU001",
    gpsLat: over.gpsLat ?? "-26.10",
    gpsLng: over.gpsLng ?? "28.05",
    monthlySales: 0,
    frequency: over.frequency ?? "monthly",
    duration: 30,
    dayOfWeek: "",
    weekNumber: "",
  }) as Store;

// ── 1. Normalisation ─────────────────────────────────────────────────────
{
  ok("a code is upper-cased", normaliseRepCode("cmrinl") === "CMRINL");
  ok("and trimmed", normaliseRepCode("  CMRINL  ") === "CMRINL");
  ok("both at once", normaliseRepCode(" cmrinl ") === "CMRINL");
  ok("absent becomes empty", normaliseRepCode(undefined) === "" && normaliseRepCode(null) === "");
}

// ── 2. Absent rules mean EVERY code is a rep ─────────────────────────────
{
  // The single most expensive thing to get wrong. Defaulting the other way
  // would have unrouted all 64 reps the moment this deployed.
  const v = resolveRepCode("GAU001", EMPTY_REP_CODE_RULES);
  ok("with no rules at all, a code is a rep", v.routable === true);
  ok("and the reason says nobody decided", v.reason === "default");
  ok("even a code that looks like an agent", resolveRepCode("CMRINL", EMPTY_REP_CODE_RULES).routable === true);
  // A blank code belongs to nobody, so it is not a rep to plan for.
  ok("a blank code is not routable", isRoutableRepCode("", EMPTY_REP_CODE_RULES) === false);
  ok("nor is whitespace", isRoutableRepCode("   ", EMPTY_REP_CODE_RULES) === false);
}

// ── 3. Prefix rules ──────────────────────────────────────────────────────
{
  const { rules, error } = addRepCodePrefix(EMPTY_REP_CODE_RULES, "cmr", "Third-party agent", WHO);
  ok("a prefix rule is accepted", !error);
  ok("and stored normalised", rules.prefixes[0].prefix === "CMR");

  for (const code of ["CMRINL", "CMRWC", "CMRKZN", "CMRFS", "CMREC", "CMRMP"]) {
    ok(`${code} is caught by CMR*`, resolveRepCode(code, rules).routable === false);
  }
  // The reason this is a prefix rule and not six ticks.
  ok("a CMR region that does not exist yet is caught too", resolveRepCode("CMRLIM", rules).routable === false);
  ok("the verdict names the rule that decided", resolveRepCode("CMRINL", rules).prefix === "CMR");
  ok("and its label, so the page can explain it", resolveRepCode("CMRINL", rules).prefixLabel === "Third-party agent");
  ok("a real rep is untouched", resolveRepCode("GAU001", rules).routable === true);

  // ⚠️ A prefix matches the START only. MP001CMR is a real rep code with a CMR
  // suffix and Carl has NOT decided about those, so it must stay a rep.
  ok("CMR in the MIDDLE or at the END is not caught", resolveRepCode("MP001CMR", rules).routable === true);
  ok("nor is KZN021CMR", resolveRepCode("KZN021CMR", rules).routable === true);
  ok("nor CPT021CMR-GAME", resolveRepCode("CPT021CMR-GAME", rules).routable === true);

  ok("a lower-case code is still caught", resolveRepCode("cmrinl", rules).routable === false);
  ok("and one with stray whitespace", resolveRepCode(" CMRWC ", rules).routable === false);
}

// ── 4. A prefix that would catch the whole book is refused ───────────────
{
  const one = addRepCodePrefix(EMPTY_REP_CODE_RULES, "C", "oops", WHO);
  ok("a one-character prefix is refused", !!one.error, one.error);
  ok("and nothing is stored", one.rules.prefixes.length === 0);
  ok("a blank prefix is refused", !!addRepCodePrefix(EMPTY_REP_CODE_RULES, "  ", "x", WHO).error);

  const first = addRepCodePrefix(EMPTY_REP_CODE_RULES, "CMR", "Agent", WHO).rules;
  const dupe = addRepCodePrefix(first, "cmr", "Agent again", WHO);
  ok("a duplicate prefix is refused", !!dupe.error, dupe.error);
  ok("and does not double up", dupe.rules.prefixes.length === 1);
}

// ── 5. An explicit decision BEATS a prefix, in both directions ───────────
{
  const withRule = addRepCodePrefix(EMPTY_REP_CODE_RULES, "CMR", "Agent", WHO).rules;

  // The escape hatch. Without it a real rep coded CMRJOHN could never be saved.
  const rescued = setRepCodeDecision(withRule, "CMRJOHN", true, WHO, "actually a rep");
  ok("an explicit yes rescues a code from its prefix rule", resolveRepCode("CMRJOHN", rescued).routable === true);
  ok("and says a person decided it", resolveRepCode("CMRJOHN", rescued).reason === "explicit");
  ok("and carries the note", resolveRepCode("CMRJOHN", rescued).note === "actually a rep");
  ok("its siblings are still excluded", resolveRepCode("CMRINL", rescued).routable === false);

  const excluded = setRepCodeDecision(EMPTY_REP_CODE_RULES, "JHB", false, WHO, "house account");
  ok("an explicit no excludes a code with no rule", resolveRepCode("JHB", excluded).routable === false);
  ok("and says it was set by hand", resolveRepCode("JHB", excluded).reason === "explicit");

  // Clearing has to be possible or a mistaken tick is permanent.
  const cleared = setRepCodeDecision(excluded, "JHB", null, WHO);
  ok("clearing a decision returns it to the rules", resolveRepCode("JHB", cleared).reason === "default");
  ok("and it counts as a rep again", resolveRepCode("JHB", cleared).routable === true);
  ok("clearing removes the record rather than storing a third value", cleared.codes.length === 0);

  // Deciding twice must replace, not append, or the first answer could win.
  const twice = setRepCodeDecision(setRepCodeDecision(EMPTY_REP_CODE_RULES, "JHB", false, WHO), "JHB", true, WHO);
  ok("deciding the same code twice keeps one record", twice.codes.length === 1);
  ok("and the last answer wins", resolveRepCode("JHB", twice).routable === true);
  ok("case does not create a second record", setRepCodeDecision(twice, "jhb", false, WHO).codes.length === 1);
}

// ── 6. The longest matching prefix decides ───────────────────────────────
{
  let rules: RepCodeRules = addRepCodePrefix(EMPTY_REP_CODE_RULES, "CM", "Broad", WHO).rules;
  rules = addRepCodePrefix(rules, "CMRWC", "Western Cape agent", WHO).rules;
  // Both match CMRWC. Naming the broad one would be true but useless.
  ok("the narrower rule is the one reported", resolveRepCode("CMRWC", rules).prefix === "CMRWC");
  ok("and its label", resolveRepCode("CMRWC", rules).prefixLabel === "Western Cape agent");
  ok("a code only the broad rule matches still reports that one", resolveRepCode("CMOTHER", rules).prefix === "CM");
}

// ── 7. Removing a rule ───────────────────────────────────────────────────
{
  const rules = addRepCodePrefix(EMPTY_REP_CODE_RULES, "CMR", "Agent", WHO).rules;
  const gone = removeRepCodePrefix(rules, rules.prefixes[0].id);
  ok("removing a rule lets its codes count as reps again", resolveRepCode("CMRINL", gone).routable === true);
  ok("removing an unknown id changes nothing", removeRepCodePrefix(rules, "nope").prefixes.length === 1);
}

// ── 8. The split totals ──────────────────────────────────────────────────
{
  const rules = addRepCodePrefix(EMPTY_REP_CODE_RULES, "CMR", "Agent", WHO).rules;
  const rows = [
    // 566 outlets, none in the router, R21.9m — all of it unrouted.
    facts({ code: "CMRINL", imsOutlets: 566, imsUnrouted: 560, sixMonthSales: 21_868_717, unroutedSixMonthSales: 21_000_000 }),
    facts({ code: "JHB", imsOutlets: 284, imsUnrouted: 276, sixMonthSales: 34_758_208, unroutedSixMonthSales: 34_000_000 }),
    facts({ code: "MP018", imsOutlets: 259, imsUnrouted: 4, sixMonthSales: 8_100_000, unroutedSixMonthSales: 100_000, routerStores: 259, repName: "A Rep" }),
  ];
  const s = summariseRepCodes(rows, rules);

  ok("every code is listed, excluded or not", s.rows.length === 3);
  ok("the excluded count is right", s.excludedCodes === 1, String(s.excludedCodes));
  ok("biggest value first", s.rows[0].code === "JHB", s.rows[0].code);

  // The number this page exists to separate.
  ok("agent outlets leave the chaseable total", s.chaseable.outlets === 280, String(s.chaseable.outlets));
  ok("and their value with them", s.chaseable.sixMonthSales === 34_100_000, String(s.chaseable.sixMonthSales));
  ok("the excluded half is reported, not dropped", s.excluded.outlets === 560 && s.excluded.sixMonthSales === 21_000_000);
  // Outlets and value must come from the SAME population. Counting unrouted
  // outlets against a code's FULL value overstates the gap by every shop a rep
  // already visits — MP018's R8.1m against 4 unrouted outlets.
  ok(
    "the opportunity uses the UNROUTED value, not the code's total",
    s.chaseable.sixMonthSales < rows[1].sixMonthSales + rows[2].sixMonthSales
  );
  ok("nothing is lost between the two halves", s.chaseable.outlets + s.excluded.outlets === 560 + 276 + 4);

  const none = summariseRepCodes(rows, EMPTY_REP_CODE_RULES);
  ok("with no rules nothing is excluded", none.excludedCodes === 0 && none.excluded.outlets === 0);
  ok("and every outlet is chaseable", none.chaseable.outlets === 840, String(none.chaseable.outlets));
}

// ── 9. Effect: a rep is never CREATED from an excluded code ──────────────
{
  const rules = addRepCodePrefix(EMPTY_REP_CODE_RULES, "CMR", "Agent", WHO).rules;

  const blocked = applyRepImport([], [{ code: "CMRINL", name: "Agent Inland", email: "a@example.com" }], rules);
  ok("an excluded code creates no rep", blocked.created.length === 0);
  ok("it is rejected, not silently skipped", blocked.rejected.length === 1);
  ok("and the reason names the rule", blocked.rejected[0].reason.includes("CMR*"), blocked.rejected[0].reason);
  ok("and says where to change it", blocked.rejected[0].reason.includes("Rep Codes page"));

  const allowed = applyRepImport([], [{ code: "GAU001", name: "Real Person", email: "r@example.com" }], rules);
  ok("a normal code still creates a rep", allowed.created.length === 1);

  // Without rules the importer behaves exactly as it did before this existed,
  // which is what keeps every other caller and assertion honest.
  const noRules = applyRepImport([], [{ code: "CMRINL", name: "Agent", email: "a@example.com" }]);
  ok("with no rules passed, nothing new is refused", noRules.created.length === 1);

  // Updating a rep that already exists is deliberately still allowed: the guard
  // is against a spreadsheet inventing a person, not against maintenance.
  const existing = [rep({ id: "x", code: "CMRINL", name: "Already Here", email: "old@example.com" })];
  const updated = applyRepImport(existing, [{ code: "CMRINL", email: "new@example.com" }], rules);
  ok("an existing rep on an excluded code can still be updated", updated.updated.length === 1);
  ok("and is not rejected", updated.rejected.length === 0);
}

// ── 10. 🔴 It must NOT change routing ────────────────────────────────────
// In a function because generateRepRoute is async, and the summary below has to
// wait for it — a suite that printed "all pass" before its last check ran would
// be worse than not having the check.
async function checkRoutingIsUntouched() {
  // Carl's explicit call, 3 Sep: a store linked to one of these codes is more
  // likely linked WRONGLY than genuinely un-visitable, so dropping it from a
  // route would stop a rep visiting a real customer. The route engine takes no
  // rules argument at all, which is the strongest form of this guarantee — but
  // assert the behaviour, because a future signature change would be silent.
  const rules = addRepCodePrefix(EMPTY_REP_CODE_RULES, "CMR", "Agent", WHO).rules;
  const stores = [
    store({ placeId: "S1", repCode: "CMRINL", gpsLat: "-26.10", gpsLng: "28.05" }),
    store({ placeId: "S2", repCode: "CMRINL", gpsLat: "-26.12", gpsLng: "28.07" }),
    store({ placeId: "S3", repCode: "CMRINL", gpsLat: "-26.14", gpsLng: "28.09" }),
  ];
  // No Google key in this environment, so it falls back to Haversine ordering.
  const plan = await generateRepRoute(
    rep({ code: "CMRINL", homeGpsLat: "-26.11", homeGpsLng: "28.06" }),
    stores
  );
  const stops = plan.days.reduce((t, d) => t + d.stops.length, 0);
  ok("stores on an excluded code are still routed", stops === 3, `${stops} stops`);
  ok("the excluded code still gets a plan", plan.repCode === "CMRINL");
  // And the rules module has no say in it: resolveRepCode says "not a rep"
  // while the engine plans all three stops. Both are correct at once.
  ok("the code is excluded and routed at the same time", resolveRepCode("CMRINL", rules).routable === false && stops === 3);
}

checkRoutingIsUntouched()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.log(`FAIL  the routing check threw — ${String(err)}`);
    console.log(`\n${passed} passed, ${failed + 1} failed`);
    process.exit(1);
  });
