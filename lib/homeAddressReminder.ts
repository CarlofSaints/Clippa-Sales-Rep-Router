/**
 * The weekly nudge that gets a rep's home onto the map.
 *
 * A rep's week is planned outwards from where they live. When the app has no
 * coordinates for a rep's home, `generateRepRoute` falls back to the CENTROID of
 * their own stores — a point in the middle of their patch that nobody lives at.
 * Measured on live data 3 Sep 2026: 46 of 64 reps had no home fix, and 18 reps
 * who own active stores were given zero days because of it.
 *
 * ⚠️ "Set their home address" and "has a home the router can use" are NOT the
 * same test, and this module deliberately uses the second one. A typed address
 * that never resolved to a confident geocode leaves `homeGpsLat/Lng` blank, so
 * the rep's day still starts from the centroid while the Reps page shows an
 * address sitting in the field. Chasing the address alone would mark those reps
 * done while nothing about their route had changed. The gate is the same
 * `parseLatLng` the route engine itself calls, so the two can never disagree.
 *
 * Nothing here sends anything or touches storage. It decides WHO and writes the
 * words; the route decides whether today is a day for sending them.
 */

import { parseLatLng } from "./route-engine";
import { BRAND, escapeHtml, resolveAppUrl } from "./welcomeEmail";
import type { Rep, ReminderBlockReason, ReminderStateMap, Store, Team, User } from "./types";

// The persisted shapes (ReminderState, ReminderStateMap, ReminderRun) live in
// lib/types.ts with every other stored record, so lib/data.ts can name them
// without pulling in the route engine and several kilobytes of email markup.
export type { ReminderBlockReason, ReminderRun, ReminderState, ReminderStateMap } from "./types";

export interface OutstandingRep {
  repId: string;
  code: string;
  name: string;
  email: string;
  /** Active (non-closed) stores allocated to this rep code. */
  activeStores: number;
  /** An address is on file but it never became coordinates. */
  hasAddressWithoutGps: boolean;
  teamId: string;
  teamName: string;
  managerName: string;
  managerEmail: string;
  /** Reminders already sent, before this run. */
  timesReminded: number;
  lastRemindedAt: string | null;
}

export interface BlockedRep extends OutstandingRep {
  reason: ReminderBlockReason;
}

export interface SettledRep {
  repId: string;
  code: string;
  name: string;
  /** How many reminders it took. 0 means they did it without being asked. */
  timesReminded: number;
}

export interface ReminderPlan {
  /** Every rep the router cannot start from home, regardless of contactability. */
  outstanding: OutstandingRep[];
  /** Of those, the ones there is somewhere to write to. */
  mailable: OutstandingRep[];
  /** Of those, the ones there is NOT — with the reason, so it can be fixed. */
  blocked: BlockedRep[];
  /** Reps who have a home fix now and had been reminded before. */
  settled: SettledRep[];
  /** One entry per manager who has at least one outstanding rep AND an address. */
  managerDigests: ManagerDigest[];
  /**
   * Outstanding reps with no manager to copy — no team, or a team whose manager
   * has no email address. Reported rather than silently dropped: on live data
   * this is most of them, and a summary that did not say so would read as if
   * every manager had been told.
   */
  repsWithNoManagerContact: number;
  totalReps: number;
  repsWithHome: number;
}

export interface ManagerDigest {
  managerName: string;
  managerEmail: string;
  teamName: string;
  reps: OutstandingRep[];
}

export interface ClassifyInput {
  reps: Rep[];
  users: User[];
  teams: Team[];
  stores: Store[];
  state: ReminderStateMap;
}

/**
 * Has this rep got a home the route engine will actually anchor on?
 *
 * Delegates to the engine's own parser rather than re-testing "both fields are
 * non-blank". The engine rejects (0,0) and out-of-range values too, and a rep
 * carrying "0"/"0" would otherwise be counted as done here and still routed from
 * the centroid there.
 */
export function hasRoutableHome(rep: Rep): boolean {
  return parseLatLng(rep.homeGpsLat, rep.homeGpsLng) !== null;
}

/** The same shape the Reps page uses, so both agree on an unusable address. */
export function hasUsableEmail(rep: Pick<Rep, "email">): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((rep.email || "").trim());
}

/**
 * Does this rep have a login they could sign in with?
 *
 * By `repId` first, which is what the Create Account button stores, falling back
 * to the email match — the same order `resolveOwnRep` uses. Getting this wrong
 * in the lenient direction is the expensive one: mailing "sign in and set your
 * address" to somebody with no account sends them at a login screen that will
 * refuse them, and they have no way of knowing why.
 */
export function findRepLogin(rep: Rep, users: User[]): User | null {
  const byId = users.find((u) => u.repId && u.repId === rep.id);
  if (byId) return byId;
  const email = (rep.email || "").toLowerCase().trim();
  if (!email) return null;
  return users.find((u) => (u.email || "").toLowerCase().trim() === email) ?? null;
}

/** Active stores per rep code. Closed shops are not a reason to chase anybody. */
function activeStoresByCode(stores: Store[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of stores) {
    if (s.closed) continue;
    const code = String(s.repCode || "").trim().toUpperCase();
    if (!code) continue;
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  return counts;
}

export function classifyReps(input: ClassifyInput): ReminderPlan {
  const { reps, users, teams, stores, state } = input;
  const counts = activeStoresByCode(stores);
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const outstanding: OutstandingRep[] = [];
  const settled: SettledRep[] = [];
  let repsWithHome = 0;

  for (const rep of reps) {
    const prior = state[rep.id];

    if (hasRoutableHome(rep)) {
      repsWithHome++;
      // Only worth reporting if we had been chasing them. A rep who was set up
      // correctly on day one is not news every week for the rest of time.
      if (prior && prior.count > 0) {
        settled.push({
          repId: rep.id,
          code: rep.code,
          name: rep.name,
          timesReminded: prior.count,
        });
      }
      continue;
    }

    const team = rep.teamId ? teamById.get(rep.teamId) : undefined;
    outstanding.push({
      repId: rep.id,
      code: rep.code,
      name: rep.name,
      email: (rep.email || "").trim(),
      activeStores: counts.get(String(rep.code || "").trim().toUpperCase()) ?? 0,
      hasAddressWithoutGps: !!(rep.homeAddress || "").trim(),
      teamId: rep.teamId || "",
      teamName: team?.name || "",
      managerName: team?.managerName || "",
      managerEmail: (team?.managerEmail || "").trim(),
      timesReminded: prior?.count ?? 0,
      lastRemindedAt: prior?.lastSentAt ?? null,
    });
  }

  // Most stores first. When Carl reads the summary, the person costing the most
  // driving should be the first name he sees, not whoever sorts alphabetically.
  outstanding.sort((a, b) => b.activeStores - a.activeStores || a.code.localeCompare(b.code));

  const mailable: OutstandingRep[] = [];
  const blocked: BlockedRep[] = [];
  const repById = new Map(reps.map((r) => [r.id, r]));

  for (const o of outstanding) {
    const rep = repById.get(o.repId)!;
    if (!hasUsableEmail(rep)) {
      blocked.push({ ...o, reason: "no_email" });
      continue;
    }
    if (!findRepLogin(rep, users)) {
      blocked.push({ ...o, reason: "no_login" });
      continue;
    }
    mailable.push(o);
  }

  // Managers are copied about their own team only, and only when there is an
  // address to copy. A team whose manager record has a blank email is common
  // here — one of the three live teams is exactly that — so it is counted.
  const digests = new Map<string, ManagerDigest>();
  let repsWithNoManagerContact = 0;
  for (const o of outstanding) {
    const key = o.managerEmail.toLowerCase();
    if (!key || !hasUsableEmail({ email: o.managerEmail })) {
      repsWithNoManagerContact++;
      continue;
    }
    const existing = digests.get(key);
    if (existing) existing.reps.push(o);
    else
      digests.set(key, {
        managerName: o.managerName,
        managerEmail: o.managerEmail,
        teamName: o.teamName,
        reps: [o],
      });
  }

  return {
    outstanding,
    mailable,
    blocked,
    settled,
    managerDigests: [...digests.values()],
    repsWithNoManagerContact,
    totalReps: reps.length,
    repsWithHome,
  };
}

// ── The mails ────────────────────────────────────────────────────────────

/** Shared chrome, so all three read as one system and one brand. */
function shell(title: string, preview: string, body: string): string {
  const logoUrl = `${resolveAppUrl()}/clippa-logo.jpg`;
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:${BRAND.tint};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preview}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.tint};">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #f0e2e2;border-radius:14px;overflow:hidden;">
            <tr>
              <td align="center" style="padding:30px 32px 22px 32px;background:#ffffff;">
                <img src="${logoUrl}" alt="Clippa" width="150" style="display:block;border:0;outline:none;text-decoration:none;width:150px;height:auto;">
              </td>
            </tr>
            <tr><td style="height:4px;line-height:4px;font-size:0;background:${BRAND.red};">&nbsp;</td></tr>
${body}
            <tr>
              <td style="padding:26px 32px 26px 32px;">
                <div style="height:1px;background:#f2eaea;font-size:0;line-height:0;">&nbsp;</div>
              </td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
            <tr>
              <td align="center" style="padding:16px 12px 0 12px;font-family:Helvetica,Arial,sans-serif;font-size:11px;color:${BRAND.grey};">
                Clippa Rep Router &middot; Powered by OuterJoin
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export interface RepReminderInput {
  name: string;
  /** Reminders already sent. 0 means this is the first one. */
  timesReminded: number;
  activeStores: number;
  /** They typed an address but it never resolved, so the ask is different. */
  hasAddressWithoutGps: boolean;
}

/**
 * The mail the rep gets.
 *
 * It asks for ONE thing and gives the reason in the rep's own currency: less
 * driving. Nothing is escalated as the count rises — a mail that starts polite
 * and turns stern reads as an automated telling-off, and the person on the
 * receiving end usually never got the first one. It does carry a forgot-password
 * link, because "sign in" is useless advice to somebody whose welcome mail is
 * three weeks buried or never arrived at all.
 */
export function buildRepReminderEmail(input: RepReminderInput): {
  subject: string;
  html: string;
  text: string;
} {
  const appUrl = resolveAppUrl();
  const accountUrl = `${appUrl}/account`;
  const forgotUrl = `${appUrl}/forgot-password`;
  const name = escapeHtml(input.name);

  const storeLine =
    input.activeStores > 0
      ? `You call on <strong>${input.activeStores} ${
          input.activeStores === 1 ? "store" : "stores"
        }</strong>, and right now every one of those days is planned from the middle of your area instead of from your front door.`
      : `Your week is planned from the middle of your area instead of from your front door.`;

  const ask = input.hasAddressWithoutGps
    ? `We have an address for you, but we could not pin it on the map — so your route still cannot start from home. ` +
      `Standing at home, open your profile and tap <strong>Use my current location</strong>. That fixes it exactly.`
    : `Open your profile and tell us where you live. It takes about a minute.`;

  const body = `
            <tr>
              <td style="padding:32px 32px 8px 32px;font-family:Helvetica,Arial,sans-serif;">
                <h1 style="margin:0 0 6px 0;font-size:22px;line-height:1.3;color:${BRAND.dark};font-weight:bold;">Where does your day start?</h1>
                <p style="margin:0;font-size:14px;color:${BRAND.grey};">About a minute, and it saves you driving</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${BRAND.dark};">
                <p style="margin:0 0 14px 0;">Hi ${name},</p>
                <p style="margin:0 0 14px 0;">${storeLine}</p>
                <p style="margin:0;">${ask}</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:26px 32px 6px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" style="background:${BRAND.red};border-radius:8px;">
                      <a href="${accountUrl}" style="display:inline-block;padding:13px 30px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">Set my home address</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:12px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${BRAND.grey};">
                or paste this into your browser:<br>
                <a href="${accountUrl}" style="color:${BRAND.redDark};text-decoration:none;">${accountUrl}</a>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.tint};border:1px solid ${BRAND.redLight};border-radius:10px;">
                  <tr>
                    <td style="padding:16px 20px 18px 20px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.7;color:${BRAND.dark};">
                      <strong style="font-size:14px;">How to do it</strong><br>
                      1. Sign in and open <strong>Account</strong>.<br>
                      2. Find <strong>Where your day starts</strong>.<br>
                      3. Standing at home, tap <strong>Use my current location</strong>.<br>
                      <span style="color:${BRAND.grey};">Step 3 is the one that matters: it pins your home exactly, even if your address is hard to find on a map.</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-left:3px solid ${BRAND.red};">
                  <tr>
                    <td style="padding:2px 0 2px 14px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${BRAND.dark};">
                      Can't sign in? <a href="${forgotUrl}" style="color:${BRAND.redDark};">Set a new password here</a> and we'll email you a link.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${BRAND.dark};">
                <p style="margin:0;">Thanks,<br><strong>The Clippa Sales Team</strong></p>
              </td>
            </tr>`;

  const text = [
    `Hi ${input.name},`,
    ``,
    input.activeStores > 0
      ? `You call on ${input.activeStores} ${
          input.activeStores === 1 ? "store" : "stores"
        }, and right now every one of those days is planned from the middle of your area instead of from your front door.`
      : `Your week is planned from the middle of your area instead of from your front door.`,
    ``,
    input.hasAddressWithoutGps
      ? `We have an address for you, but we could not pin it on the map, so your route still cannot start from home. Standing at home, open your profile and tap "Use my current location". That fixes it exactly.`
      : `Open your profile and tell us where you live. It takes about a minute.`,
    ``,
    `Set your home address: ${accountUrl}`,
    ``,
    `How to do it:`,
    `  1. Sign in and open Account.`,
    `  2. Find "Where your day starts".`,
    `  3. Standing at home, tap "Use my current location".`,
    ``,
    `Step 3 is the one that matters: it pins your home exactly, even if your`,
    `address is hard to find on a map.`,
    ``,
    `Can't sign in? Set a new password at ${forgotUrl} and we'll email you a link.`,
    ``,
    `Thanks,`,
    `The Clippa Sales Team`,
  ].join("\n");

  return {
    subject: "Please set your home address on Clippa Rep Router",
    html: shell(
      "Where does your day start?",
      "Your route is planned from your front door, once we know where it is.",
      body
    ),
    text,
  };
}

/** A plain HTML table of reps, used by both the manager and the admin mail. */
function repTable(reps: OutstandingRep[], includeReminderCount: boolean): string {
  const head = ["Rep", "Code", "Stores", ...(includeReminderCount ? ["Reminders"] : [])]
    .map(
      (h) =>
        `<th align="left" style="padding:6px 10px;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${BRAND.grey};border-bottom:1px solid #f0e2e2;">${h}</th>`
    )
    .join("");
  const rows = reps
    .map((r) => {
      const cells = [
        escapeHtml(r.name),
        escapeHtml(r.code),
        String(r.activeStores),
        ...(includeReminderCount ? [String(r.timesReminded)] : []),
      ];
      return `<tr>${cells
        .map(
          (c) =>
            `<td style="padding:7px 10px;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:${BRAND.dark};border-bottom:1px solid #f7f0f0;">${c}</td>`
        )
        .join("")}</tr>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${head}</tr>${rows}</table>`;
}

export interface ManagerDigestEmailInput {
  managerName: string;
  teamName: string;
  reps: OutstandingRep[];
}

/**
 * What a team manager gets: their own reps only, and the fact that the reps have
 * already been written to. A manager who thinks they are the first to hear about
 * it chases people the app has already chased.
 */
export function buildManagerDigestEmail(input: ManagerDigestEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const name = escapeHtml(input.managerName || "there");
  const team = escapeHtml(input.teamName || "your team");
  const n = input.reps.length;
  const stores = input.reps.reduce((sum, r) => sum + r.activeStores, 0);

  const body = `
            <tr>
              <td style="padding:32px 32px 8px 32px;font-family:Helvetica,Arial,sans-serif;">
                <h1 style="margin:0 0 6px 0;font-size:22px;line-height:1.3;color:${BRAND.dark};font-weight:bold;">${n} ${
                  n === 1 ? "rep has" : "reps have"
                } no home address</h1>
                <p style="margin:0;font-size:14px;color:${BRAND.grey};">${team}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${BRAND.dark};">
                <p style="margin:0 0 14px 0;">Hi ${name},</p>
                <p style="margin:0 0 14px 0;">
                  Routes are planned outwards from where a rep lives. Until these ${
                    n === 1 ? "reps" : "reps"
                  } set their home address, their days are planned from the middle of their area instead
                  &mdash; which usually means more driving and fewer calls. Between them they cover
                  <strong>${stores} ${stores === 1 ? "store" : "stores"}</strong>.
                </p>
                <p style="margin:0;">
                  ${n === 1 ? "This rep has" : "They have"} been emailed directly with instructions. You are copied so you know who to ask about it.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 32px 0 32px;">${repTable(input.reps, true)}</td>
            </tr>
            <tr>
              <td style="padding:22px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${BRAND.grey};">
                "Reminders" is how many times we have already asked. All they need to do is sign in,
                open Account, and tap "Use my current location" while standing at home.
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${BRAND.dark};">
                <p style="margin:0;">Thanks,<br><strong>Clippa Rep Router</strong></p>
              </td>
            </tr>`;

  const text = [
    `Hi ${input.managerName || "there"},`,
    ``,
    `${n} ${n === 1 ? "rep" : "reps"} in ${input.teamName || "your team"} ${
      n === 1 ? "has" : "have"
    } no home address on Clippa Rep Router.`,
    ``,
    `Routes are planned outwards from where a rep lives. Until they set it, their`,
    `days are planned from the middle of their area instead, which usually means`,
    `more driving and fewer calls. Between them they cover ${stores} ${
      stores === 1 ? "store" : "stores"
    }.`,
    ``,
    ...input.reps.map(
      (r) =>
        `  ${r.code.padEnd(10)} ${r.name.padEnd(28)} ${String(r.activeStores).padStart(4)} stores   ${
          r.timesReminded
        } reminder(s)`
    ),
    ``,
    `They have been emailed directly with instructions. You are copied so you know`,
    `who to ask about it.`,
    ``,
    `Thanks,`,
    `Clippa Rep Router`,
  ].join("\n");

  return {
    subject: `${n} ${n === 1 ? "rep has" : "reps have"} no home address — ${
      input.teamName || "your team"
    }`,
    html: shell(
      "Reps with no home address",
      `${n} of your reps are still routed from a store centroid rather than home.`,
      body
    ),
    text,
  };
}

export interface AdminSummaryInput {
  plan: ReminderPlan;
  sent: number;
  failed: { code: string; name: string; email: string; reason: string }[];
  dryRun: boolean;
  managersEmailed: number;
  trigger: "cron" | "manual";
}

const BLOCK_REASON_LABEL: Record<ReminderBlockReason, string> = {
  no_email: "No email address on file",
  no_login: "No login yet — create one on the Reps page",
};

/**
 * Carl's summary. It exists for two reasons and the second matters more: it
 * reports the run, and it PROVES the run happened at all. A cron that silently
 * stops is the failure mode this app has already been bitten by, and a weekly
 * mail that stops arriving is the only signal anyone would ever get.
 *
 * So it is sent even when there was nothing to do, and it says so.
 */
export function buildAdminSummaryEmail(input: AdminSummaryInput): {
  subject: string;
  html: string;
  text: string;
} {
  const { plan, sent, failed, dryRun, managersEmailed, trigger } = input;
  const prefix = dryRun ? "[PREVIEW, nothing sent] " : "";

  const stat = (label: string, value: string | number, note = "") => `
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #f7f0f0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:${BRAND.grey};">${label}${
                  note ? `<br><span style="font-size:11px;">${note}</span>` : ""
                }</td>
                <td align="right" style="padding:8px 0;border-bottom:1px solid #f7f0f0;font-family:Helvetica,Arial,sans-serif;font-size:17px;font-weight:bold;color:${BRAND.dark};">${value}</td>
              </tr>`;

  const settledBlock = plan.settled.length
    ? `
            <tr>
              <td style="padding:22px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:${BRAND.dark};">
                <strong>Done since we started asking</strong><br>
                ${plan.settled
                  .map(
                    (s) =>
                      `${escapeHtml(s.code)} ${escapeHtml(s.name)} <span style="color:${BRAND.grey};">(after ${s.timesReminded} reminder${
                        s.timesReminded === 1 ? "" : "s"
                      })</span>`
                  )
                  .join("<br>")}
              </td>
            </tr>`
    : "";

  const blockedBlock = plan.blocked.length
    ? `
            <tr>
              <td style="padding:22px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:${BRAND.dark};">
                <strong>Could not be emailed (${plan.blocked.length})</strong><br>
                <span style="color:${BRAND.grey};font-size:13px;">These reps need a home address but there is no way to ask them for it.</span><br><br>
                ${plan.blocked
                  .map(
                    (b) =>
                      `${escapeHtml(b.code)} ${escapeHtml(b.name)} &mdash; <span style="color:${BRAND.redDark};">${
                        BLOCK_REASON_LABEL[b.reason]
                      }</span> <span style="color:${BRAND.grey};">(${b.activeStores} stores)</span>`
                  )
                  .join("<br>")}
              </td>
            </tr>`
    : "";

  const failedBlock = failed.length
    ? `
            <tr>
              <td style="padding:22px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:${BRAND.dark};">
                <strong style="color:${BRAND.redDark};">Failed to send (${failed.length})</strong><br>
                ${failed
                  .map(
                    (f) =>
                      `${escapeHtml(f.code)} ${escapeHtml(f.name)} &lt;${escapeHtml(f.email)}&gt;<br><span style="color:${BRAND.grey};font-size:12px;">${escapeHtml(
                        f.reason
                      )}</span>`
                  )
                  .join("<br>")}
              </td>
            </tr>`
    : "";

  const top = plan.outstanding.slice(0, 10);

  const body = `
            <tr>
              <td style="padding:32px 32px 8px 32px;font-family:Helvetica,Arial,sans-serif;">
                <h1 style="margin:0 0 6px 0;font-size:22px;line-height:1.3;color:${BRAND.dark};font-weight:bold;">Home address reminders</h1>
                <p style="margin:0;font-size:14px;color:${BRAND.grey};">${
                  dryRun ? "Preview only — no email was sent" : trigger === "cron" ? "Weekly run" : "Sent by hand"
                }</p>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 32px 0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${stat("Reps with no home the router can use", plan.outstanding.length, `of ${plan.totalReps} reps`)}
${stat(dryRun ? "Would be emailed" : "Reminders sent", dryRun ? plan.mailable.length : sent)}
${stat("Team managers copied", managersEmailed, plan.repsWithNoManagerContact > 0 ? `${plan.repsWithNoManagerContact} reps have no manager on file to copy` : "")}
${stat("Reps now anchored on home", plan.repsWithHome)}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 32px 6px 32px;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:${BRAND.dark};">
                <strong>Worst first${plan.outstanding.length > top.length ? `, top ${top.length}` : ""}</strong>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px;">${repTable(top, true)}</td>
            </tr>
${settledBlock}
${blockedBlock}
${failedBlock}
            <tr>
              <td style="padding:26px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${BRAND.grey};">
                A rep counts as done only when the router can actually start from their home &mdash;
                an address that never resolved to coordinates still leaves them planned from the
                middle of their patch. Runs every Monday at 08:00.
              </td>
            </tr>`;

  const text = [
    `${prefix}Home address reminders — ${
      dryRun ? "preview" : trigger === "cron" ? "weekly run" : "sent by hand"
    }`,
    ``,
    `Reps with no usable home: ${plan.outstanding.length} of ${plan.totalReps}`,
    `${dryRun ? "Would be emailed" : "Reminders sent"}:      ${dryRun ? plan.mailable.length : sent}`,
    `Team managers copied:     ${managersEmailed}${
      plan.repsWithNoManagerContact > 0
        ? ` (${plan.repsWithNoManagerContact} reps have no manager on file to copy)`
        : ""
    }`,
    `Reps anchored on home:    ${plan.repsWithHome}`,
    ``,
    `Worst first:`,
    ...top.map(
      (r) =>
        `  ${r.code.padEnd(10)} ${r.name.padEnd(28)} ${String(r.activeStores).padStart(4)} stores   ${
          r.timesReminded
        } reminder(s)`
    ),
    ...(plan.settled.length
      ? [
          ``,
          `Done since we started asking:`,
          ...plan.settled.map((s) => `  ${s.code} ${s.name} (after ${s.timesReminded} reminder(s))`),
        ]
      : []),
    ...(plan.blocked.length
      ? [
          ``,
          `Could not be emailed (${plan.blocked.length}):`,
          ...plan.blocked.map(
            (b) => `  ${b.code} ${b.name} — ${BLOCK_REASON_LABEL[b.reason]} (${b.activeStores} stores)`
          ),
        ]
      : []),
    ...(failed.length
      ? [
          ``,
          `Failed to send (${failed.length}):`,
          ...failed.map((f) => `  ${f.code} ${f.name} <${f.email}> — ${f.reason}`),
        ]
      : []),
    ``,
    `A rep counts as done only when the router can actually start from their home.`,
    `Runs every Monday at 08:00.`,
  ].join("\n");

  return {
    subject: `${prefix}Home addresses: ${plan.outstanding.length} outstanding, ${
      dryRun ? plan.mailable.length : sent
    } ${dryRun ? "would be emailed" : "emailed"}`,
    html: shell("Home address reminders", `${plan.outstanding.length} reps still have no home fix.`, body),
    text,
  };
}
