/**
 * Assertions for the weekly home-address reminder.
 *
 * Run: npx tsx scripts/check-home-address-reminder.ts
 *
 * Pure — no blob, no session, no network — so it runs against the real shipped
 * modules rather than a copy of them. The one thing that cannot be asserted here
 * is that Resend accepted the mail; everything about WHO gets one and what it
 * says can be, and that is where the damage would be done.
 */

import {
  classifyReps,
  hasRoutableHome,
  hasUsableEmail,
  findRepLogin,
  buildRepReminderEmail,
  buildManagerDigestEmail,
  buildAdminSummaryEmail,
} from "../lib/homeAddressReminder";
import { remindersEnabled, type AppSettings } from "../lib/data";
import { findTeamForManager, normaliseEmail } from "../lib/manager";
import { isRepAllowedPath } from "../lib/repAccess";
import { isPublicPath } from "../lib/publicPaths";
import type { Rep, Store, Team, User, ReminderStateMap } from "../lib/types";

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

const rep = (over: Partial<Rep> = {}): Rep => ({
  id: over.id ?? "rep-1",
  code: over.code ?? "GAU001",
  name: over.name ?? "Test Person",
  email: over.email ?? "test.person@example.com",
  cell: over.cell ?? "",
  homeAddress: over.homeAddress ?? "",
  homeGpsLat: over.homeGpsLat ?? "",
  homeGpsLng: over.homeGpsLng ?? "",
  teamId: over.teamId ?? "",
  workingHoursPerDay: over.workingHoursPerDay ?? 8.5,
});

const user = (over: Partial<User> = {}): User => ({
  id: over.id ?? "user-1",
  name: over.name ?? "Test Person",
  email: over.email ?? "test.person@example.com",
  password: "hash",
  role: over.role ?? "rep",
  forcePasswordChange: over.forcePasswordChange ?? true,
  repId: over.repId,
});

const store = (over: Partial<Store> = {}): Store =>
  ({
    id: over.id ?? crypto.randomUUID(),
    placeId: over.placeId ?? "P1",
    name: over.name ?? "Shop",
    channelId: "c1",
    repCode: over.repCode ?? "GAU001",
    gpsLat: "-26.1",
    gpsLng: "28.0",
    monthlySales: 0,
    frequency: "monthly",
    duration: 30,
    dayOfWeek: "",
    weekNumber: "",
    closed: over.closed,
  }) as Store;

const team = (over: Partial<Team> = {}): Team => ({
  id: over.id ?? "team-1",
  name: over.name ?? "REGION A",
  managerId: "u-mgr",
  managerName: over.managerName ?? "Manager One",
  managerEmail: over.managerEmail ?? "manager.one@example.com",
  managerCell: "",
  area: "",
});

// ── 1. What counts as "has a home" ───────────────────────────────────────
{
  ok("blank coordinates are not a home", hasRoutableHome(rep()) === false);
  ok(
    "a real fix is a home",
    hasRoutableHome(rep({ homeGpsLat: "-26.1076", homeGpsLng: "28.0567" })) === true
  );
  // The whole point of delegating to the engine's parser. A rep carrying these
  // would be counted done here and still routed from a store centroid there.
  ok(
    "(0,0) is not a home",
    hasRoutableHome(rep({ homeGpsLat: "0", homeGpsLng: "0" })) === false
  );
  ok(
    "an out-of-range latitude is not a home",
    hasRoutableHome(rep({ homeGpsLat: "412", homeGpsLng: "28.05" })) === false
  );
  ok(
    "one coordinate on its own is not a home",
    hasRoutableHome(rep({ homeGpsLat: "-26.1", homeGpsLng: "" })) === false
  );
  // An address is NOT the test. This is the distinction the whole module rests on.
  ok(
    "an address with no coordinates is still outstanding",
    hasRoutableHome(rep({ homeAddress: "Stand no 644, next to the shop" })) === false
  );
}

// ── 2. Contactability ────────────────────────────────────────────────────
{
  ok("a normal address is usable", hasUsableEmail({ email: "a.b@example.com" }) === true);
  ok("a blank address is not", hasUsableEmail({ email: "" }) === false);
  ok("a name with no domain is not", hasUsableEmail({ email: "notanemail" }) === false);
  ok("whitespace is trimmed before judging", hasUsableEmail({ email: "  a@b.co  " }) === true);

  const r = rep({ id: "r9", email: "changed@example.com" });
  const linked = user({ id: "u9", repId: "r9", email: "old@example.com" });
  ok(
    "a login is found by repId even after the rep's email changed",
    findRepLogin(r, [linked])?.id === "u9"
  );
  ok(
    "a login is found by email when there is no repId",
    findRepLogin(rep({ id: "rX", email: "m@example.com" }), [user({ id: "u5", email: "M@Example.com" })])?.id ===
      "u5"
  );
  ok("no login is found when there is none", findRepLogin(rep(), []) === null);
  ok(
    "a rep with no email is never matched to a login by email",
    findRepLogin(rep({ email: "" }), [user({ email: "" })]) === null
  );
}

// ── 3. Who ends up on the list ───────────────────────────────────────────
{
  const teams = [team({ id: "t1", name: "REGION A", managerEmail: "manager.one@example.com" })];
  const reps = [
    rep({ id: "a", code: "NW002", name: "Big Book", email: "big@example.com", teamId: "t1" }),
    rep({ id: "b", code: "GAU001", name: "Small Book", email: "small@example.com", teamId: "t1" }),
    rep({ id: "c", code: "KZN001", name: "No Email", email: "", teamId: "t1" }),
    rep({ id: "d", code: "EP001", name: "No Login", email: "nologin@example.com", teamId: "t1" }),
    rep({ id: "e", code: "MP001", name: "Done", email: "done@example.com", teamId: "t1", homeGpsLat: "-25.5", homeGpsLng: "30.9" }),
  ];
  const users = [
    user({ id: "ua", repId: "a" }),
    user({ id: "ub", repId: "b" }),
    user({ id: "uc", repId: "c" }),
    user({ id: "ue", repId: "e" }),
  ];
  const stores = [
    ...Array.from({ length: 40 }, () => store({ repCode: "NW002" })),
    ...Array.from({ length: 3 }, () => store({ repCode: "GAU001" })),
    store({ repCode: "NW002", closed: true }),
  ];
  const state: ReminderStateMap = {
    e: { repId: "e", repCode: "MP001", count: 3, firstSentAt: "x", lastSentAt: "y", lastResult: "sent" },
  };

  const plan = classifyReps({ reps, users, teams, stores, state });

  ok("reps with a home are not chased", plan.outstanding.length === 4, String(plan.outstanding.length));
  ok("the biggest book is first", plan.outstanding[0].code === "NW002", plan.outstanding[0].code);
  ok("closed stores are not a reason to chase anybody", plan.outstanding[0].activeStores === 40, String(plan.outstanding[0].activeStores));
  ok("only the contactable are mailed", plan.mailable.length === 2, String(plan.mailable.length));
  ok("the rest are blocked, not dropped", plan.blocked.length === 2, String(plan.blocked.length));
  ok(
    "a missing email is named as the reason",
    plan.blocked.find((b) => b.code === "KZN001")?.reason === "no_email"
  );
  // The expensive mistake: telling someone with no account to go and sign in.
  ok(
    "a missing login is named as the reason",
    plan.blocked.find((b) => b.code === "EP001")?.reason === "no_login"
  );
  ok("every outstanding rep is either mailable or blocked", plan.mailable.length + plan.blocked.length === plan.outstanding.length);
  // The reason each row can also say why. Two lists cannot drift from one field.
  ok("a mailable rep carries no block reason", plan.mailable.every((m) => !m.blockedReason));
  ok("a blocked rep carries the same reason on the row", plan.outstanding.find((o) => o.code === "EP001")?.blockedReason === "no_login");
  ok("a rep who has complied is reported", plan.settled.length === 1 && plan.settled[0].code === "MP001");
  ok("and says how many asks it took", plan.settled[0].timesReminded === 3);
  ok("the totals are the whole rep list", plan.totalReps === 5 && plan.repsWithHome === 1);

  // Never asked, so not news. Without this every correctly-set-up rep would be
  // listed as a fresh win in every summary, forever.
  const quiet = classifyReps({ reps, users, teams, stores, state: {} });
  ok("a rep who was never chased is not reported as a win", quiet.settled.length === 0);
}

// ── 3b. Nobody is chased without their manager (Carl's rule, 3 Sep 2026) ──
{
  const teams = [
    team({ id: "t1", name: "REGION A", managerEmail: "manager.one@example.com" }),
    // Live data really does have one of these: a team whose manager record has
    // a blank email. It must count as NO manager, not as a manager.
    team({ id: "t2", name: "REGION B", managerEmail: "" }),
  ];
  const reps = [
    rep({ id: "a", code: "GAU001", teamId: "t1", email: "a@example.com" }),
    rep({ id: "b", code: "PTA001", teamId: "t2", email: "b@example.com" }),
    rep({ id: "c", code: "CPT001", teamId: "", email: "c@example.com" }),
  ];
  const users = reps.map((r) => user({ id: `u${r.id}`, repId: r.id }));
  const plan = classifyReps({ reps, users, teams, stores: [], state: {} });

  ok("a rep with a reachable manager is emailed", plan.mailable.length === 1 && plan.mailable[0].code === "GAU001");
  ok(
    "a rep whose team manager has no email is held back",
    plan.blocked.find((b) => b.code === "PTA001")?.reason === "no_manager"
  );
  ok(
    "a rep in no team at all is held back",
    plan.blocked.find((b) => b.code === "CPT001")?.reason === "no_manager"
  );
  ok("held-back reps are still counted as outstanding", plan.outstanding.length === 3);
  ok("and counted in the held-back total", plan.repsWithNoManagerContact === 2, String(plan.repsWithNoManagerContact));

  // Order matters: a rep with no login AND no manager should be reported as the
  // fixable data problem, not swallowed by the blanket rule.
  const noLogin = classifyReps({
    reps: [rep({ id: "z", code: "ZZ001", teamId: "", email: "z@example.com" })],
    users: [],
    teams,
    stores: [],
    state: {},
  });
  ok("a missing login is reported ahead of a missing manager", noLogin.blocked[0].reason === "no_login");

  // Turning the rule off would be a silent 5x mail-out, so assert the shape of
  // the whole outcome, not just one row.
  ok("nothing is mailed when nobody has a manager", classifyReps({
    reps: [rep({ id: "q", code: "QQ001", teamId: "", email: "q@example.com" })],
    users: [user({ repId: "q" })],
    teams: [],
    stores: [],
    state: {},
  }).mailable.length === 0);
}

// ── 4. Reminder counts carry through ─────────────────────────────────────
{
  const reps = [rep({ id: "a", code: "NW002" })];
  const users = [user({ repId: "a" })];
  const state: ReminderStateMap = {
    a: { repId: "a", repCode: "NW002", count: 4, firstSentAt: "2026-08-01", lastSentAt: "2026-08-31", lastResult: "sent" },
  };
  const plan = classifyReps({ reps, users, teams: [], stores: [], state });
  ok("prior reminders are carried onto the row", plan.outstanding[0].timesReminded === 4);
  ok("and so is when we last asked", plan.outstanding[0].lastRemindedAt === "2026-08-31");

  const fresh = classifyReps({ reps, users, teams: [], stores: [], state: {} });
  ok("a rep never asked shows zero, not undefined", fresh.outstanding[0].timesReminded === 0);
  ok("and no last-asked date", fresh.outstanding[0].lastRemindedAt === null);
}

// ── 5. Manager copies ────────────────────────────────────────────────────
{
  const teams = [
    team({ id: "t1", name: "REGION A", managerName: "Manager One", managerEmail: "manager.one@example.com" }),
    // Live data really does have one of these. A team whose manager has no
    // address must be counted, not silently skipped.
    team({ id: "t2", name: "REGION B", managerName: "Manager Two", managerEmail: "" }),
  ];
  const reps = [
    rep({ id: "a", code: "GAU001", teamId: "t1", email: "a@example.com" }),
    rep({ id: "b", code: "GAU002", teamId: "t1", email: "b@example.com" }),
    rep({ id: "c", code: "PTA001", teamId: "t2", email: "c@example.com" }),
    rep({ id: "d", code: "CPT001", teamId: "", email: "d@example.com" }),
  ];
  const users = reps.map((r) => user({ id: `u${r.id}`, repId: r.id }));
  const plan = classifyReps({ reps, users, teams, stores: [], state: {} });

  ok("one digest per manager, not per rep", plan.managerDigests.length === 1, String(plan.managerDigests.length));
  ok("the digest holds that manager's reps", plan.managerDigests[0].reps.length === 2);
  ok("and names the team", plan.managerDigests[0].teamName === "REGION A");
  ok(
    "reps with no manager to copy are counted, not dropped",
    plan.repsWithNoManagerContact === 2,
    String(plan.repsWithNoManagerContact)
  );
  ok(
    "every outstanding rep is still on the main list",
    plan.outstanding.length === 4,
    String(plan.outstanding.length)
  );

  // A manager must hear about a rep of theirs who cannot be emailed at all —
  // "this one needs a login" is the thing only the manager can chase.
  const withGap = classifyReps({
    reps: [
      rep({ id: "m1", code: "GAU001", teamId: "t1", email: "m1@example.com" }),
      rep({ id: "m2", code: "GAU002", teamId: "t1", email: "" }),
    ],
    users: [user({ id: "um1", repId: "m1" })],
    teams,
    stores: [],
    state: {},
  });
  ok("the digest includes a rep who could not be mailed", withGap.managerDigests[0].reps.length === 2);
  ok("but only one of them is actually mailed", withGap.mailable.length === 1);
}

// ── 6. The rep's mail ────────────────────────────────────────────────────
{
  const first = buildRepReminderEmail({ name: "Big Book", timesReminded: 0, activeStores: 407, hasAddressWithoutGps: false });
  ok("the ask is in the subject", /home address/i.test(first.subject));
  ok("the store count is used as the reason", first.html.includes("407"));
  ok("and in the plain text too", first.text.includes("407"));
  ok("it points at the profile page", first.html.includes("/account"));
  // "Sign in" is useless advice to somebody whose welcome mail never arrived.
  ok("it offers a way back in", first.html.includes("/forgot-password") && first.text.includes("/forgot-password"));
  ok("no password is ever in it", !/password:/i.test(first.text));

  const nagged = buildRepReminderEmail({ name: "Big Book", timesReminded: 6, activeStores: 407, hasAddressWithoutGps: false });
  // Deliberate: the tone does not escalate. The person on the sixth mail is
  // usually the person who never got the first five.
  ok("the sixth reminder reads the same as the first", nagged.html === first.html);

  const stuck = buildRepReminderEmail({ name: "Fuzzy Address", timesReminded: 1, activeStores: 174, hasAddressWithoutGps: true });
  ok(
    "a rep whose address would not pin is asked for something different",
    stuck.html.includes("could not pin it on the map") && stuck.html !== first.html
  );
  ok("and the plain text says it too", stuck.text.includes("could not pin it on the map"));

  const noStores = buildRepReminderEmail({ name: "New Person", timesReminded: 0, activeStores: 0, hasAddressWithoutGps: false });
  ok("a rep with no stores is not told they have 0 stores", !noStores.html.includes("0 store"));
  ok("but is still asked", noStores.html.includes("/account"));

  const one = buildRepReminderEmail({ name: "Solo", timesReminded: 0, activeStores: 1, hasAddressWithoutGps: false });
  ok("one store is singular", one.text.includes("1 store,") && !one.text.includes("1 stores"));

  const nasty = buildRepReminderEmail({ name: 'Bobby <b>"&</b>', timesReminded: 0, activeStores: 5, hasAddressWithoutGps: false });
  ok("a name with markup cannot break the mail", !nasty.html.includes("<b>Bobby") && nasty.html.includes("&lt;b&gt;"));
}

// ── 7. The manager and admin mails ───────────────────────────────────────
{
  const reps = [
    rep({ id: "a", code: "NW002", name: "Big Book", email: "a@example.com", teamId: "t1" }),
    rep({ id: "b", code: "GAU001", name: "Small Book", email: "b@example.com", teamId: "t1" }),
    rep({ id: "c", code: "KZN001", name: "No Email", email: "" }),
  ];
  const users = [user({ id: "ua", repId: "a" }), user({ id: "ub", repId: "b" })];
  const stores = Array.from({ length: 407 }, () => store({ repCode: "NW002" }));
  const plan = classifyReps({
    reps,
    users,
    teams: [team({ id: "t1" })],
    stores,
    state: {},
  });

  const mgr = buildManagerDigestEmail({ managerName: "Manager One", teamName: "REGION A", reps: plan.managerDigests[0].reps });
  ok("the manager's mail names their team", mgr.subject.includes("REGION A"));
  ok("it lists their reps", mgr.html.includes("Big Book") && mgr.html.includes("Small Book"));
  // A manager who thinks they are first to hear chases people already chased.
  ok("it says the reps were written to as well", /written to directly/i.test(mgr.html));
  // And a manager who assumes EVERY name got the mail would chase the one
  // person who never received it for ignoring it.
  ok("every row says whether that rep was actually emailed", mgr.html.includes("Emailed"));
  ok("and the plain text carries the same status", /Emailed/.test(mgr.text));
  ok("it does not leak reps from other teams", !mgr.html.includes("No Email"));

  const summary = buildAdminSummaryEmail({ plan, sent: 2, failed: [], dryRun: false, managersEmailed: 1, trigger: "cron" });
  ok("the summary counts what is outstanding", summary.subject.includes("3 outstanding"));
  ok("and what was sent", summary.subject.includes("2 emailed"));
  ok("it names the reps that could not be reached", summary.html.includes("No Email"));
  ok("and why", summary.html.includes("No email address on file"));
  ok("the biggest book is first in the table", summary.html.indexOf("Big Book") < summary.html.indexOf("Small Book"));

  // 37 of 46 reps are held back on live data. An ungrouped list buries the two
  // rows that are a different problem under 37 identical ones.
  const heldBack = classifyReps({
    reps: [
      rep({ id: "h1", code: "AA001", name: "No Team One", email: "h1@example.com" }),
      rep({ id: "h2", code: "AA002", name: "No Team Two", email: "h2@example.com" }),
      rep({ id: "h3", code: "AA003", name: "No Account", email: "h3@example.com", teamId: "t1" }),
    ],
    users: [user({ id: "uh1", repId: "h1" }), user({ id: "uh2", repId: "h2" })],
    teams: [team({ id: "t1" })],
    stores: [],
    state: {},
  });
  const grouped = buildAdminSummaryEmail({
    plan: heldBack,
    sent: 0,
    failed: [],
    dryRun: false,
    managersEmailed: 0,
    trigger: "cron",
  });
  ok("the summary heads the held-back list by count", grouped.html.includes("Not emailed (3)"));
  ok("it groups them by reason", grouped.html.includes("No team manager to copy") && grouped.html.includes("(2)"));
  ok("and says how to fix each", grouped.html.includes("Teams page") && grouped.html.includes("Reps page"));
  ok("the plain text groups them too", grouped.text.includes("No team manager to copy") && grouped.text.includes("No Team One"));
  ok("nobody is reported as sent", grouped.subject.includes("0 emailed"));

  const preview = buildAdminSummaryEmail({ plan, sent: 0, failed: [], dryRun: true, managersEmailed: 0, trigger: "manual" });
  // A preview that looked like a send would be read as 46 mails having gone out.
  ok("a preview says so in the subject", preview.subject.startsWith("[PREVIEW, nothing sent]"));
  ok("and says what WOULD have been sent, not zero", preview.subject.includes("2 would be emailed"));
  ok("and says it in the body", /no email was sent/i.test(preview.html));

  const withFailures = buildAdminSummaryEmail({
    plan,
    sent: 1,
    failed: [{ code: "GAU001", name: "Small Book", email: "b@example.com", reason: "Email failed (422): bad address" }],
    dryRun: false,
    managersEmailed: 1,
    trigger: "cron",
  });
  ok("failures are reported with their reason", withFailures.html.includes("422") && withFailures.text.includes("422"));

  // The whole reason the summary is sent even on a quiet week.
  const empty = classifyReps({ reps: [], users: [], teams: [], stores: [], state: {} });
  const quiet = buildAdminSummaryEmail({ plan: empty, sent: 0, failed: [], dryRun: false, managersEmailed: 0, trigger: "cron" });
  ok("a week with nothing to do still produces a summary", quiet.subject.includes("0 outstanding"));
  ok("and does not claim a failure", !/failed to send/i.test(quiet.html));
}

// ── 8. The switch ────────────────────────────────────────────────────────
{
  // Absent means ON. This is the unusual default and it is the one asked for:
  // the switch exists to stop a live job, not to start a dormant one.
  ok("an untouched settings blob has reminders on", remindersEnabled({ outlierRadiusKm: 150 } as AppSettings) === true);
  ok("explicitly off is off", remindersEnabled({ outlierRadiusKm: 150, homeAddressRemindersEnabled: false } as AppSettings) === false);
  ok("explicitly on is on", remindersEnabled({ outlierRadiusKm: 150, homeAddressRemindersEnabled: true } as AppSettings) === true);
}

// ── 8b. A manager email is a KEY, not a label ────────────────────────────
{
  // The real value stored on 3 Sep 2026: pasted with a trailing space and in
  // caps. Every login-to-team match in the app compared it raw.
  const messy = "ALEC@CLIPPASALES.COM ";
  ok("case and whitespace are stripped for comparison", normaliseEmail(messy) === "alec@clippasales.com");
  ok("an absent address normalises to empty", normaliseEmail(undefined) === "");
  ok("a whitespace-only address normalises to empty", normaliseEmail("   ") === "");

  const teams = [team({ id: "t1", name: "REGION B", managerEmail: messy })];
  ok("a manager still finds their team", findTeamForManager(teams, "alec@clippasales.com")?.id === "t1");
  ok("and from a messily typed session address too", findTeamForManager(teams, " Alec@Clippasales.com ")?.id === "t1");
  // The bug this replaces: `t.managerEmail.toLowerCase() === email.toLowerCase()`
  // missed, so the manager's teamId silently never resolved at sign-in.
  ok(
    "the old raw comparison would have missed",
    teams.find((t) => t.managerEmail.toLowerCase() === "alec@clippasales.com") === undefined
  );
  ok("an empty address matches nobody", findTeamForManager(teams, "") === undefined);
  // A blank manager email must never make every rep "match" the first team.
  ok(
    "a team with a blank manager email is not a wildcard",
    findTeamForManager([team({ id: "t2", managerEmail: "  " })], "") === undefined
  );

  // And the reminder must count a messily-typed manager as reachable.
  const plan = classifyReps({
    reps: [rep({ id: "a", code: "GAU001", teamId: "t1", email: "a@example.com" })],
    users: [user({ id: "ua", repId: "a" })],
    teams,
    stores: [],
    state: {},
  });
  ok("a rep under a messily-typed manager is still emailed", plan.mailable.length === 1);
  ok("and the digest sends to the trimmed address", plan.managerDigests[0].managerEmail === "ALEC@CLIPPASALES.COM");
}

// ── 9. The cron route's own front door ───────────────────────────────────
{
  // It must NOT be public — the only key is the bearer, checked in middleware
  // and again in the route. A public entry here would let anyone on the
  // internet mail 46 people at will.
  ok("the cron route is not a public path", isPublicPath("/api/cron/home-address-reminder") === false);
  ok("nor is its parent", isPublicPath("/api/cron") === false);
  // A rep must not be able to fire it either. They reach /account and nothing else.
  ok("a rep cannot reach the cron route", isRepAllowedPath("/api/cron/home-address-reminder") === false);
  ok("a rep can still reach the page the mail sends them to", isRepAllowedPath("/account") === true);
  ok("and the profile API behind it", isRepAllowedPath("/api/account/rep-profile") === true);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
