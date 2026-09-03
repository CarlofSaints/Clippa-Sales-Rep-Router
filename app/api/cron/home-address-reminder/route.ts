import { NextRequest, NextResponse } from "next/server";
import {
  getReps,
  getStores,
  getTeams,
  getUsers,
  getSettings,
  remindersEnabled,
  getReminderState,
  saveReminderState,
  getReminderRuns,
  appendReminderRun,
} from "@/lib/data";
import { getSession, sessionHasPermission } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { sendEmail } from "@/lib/welcomeEmail";
import {
  classifyReps,
  buildRepReminderEmail,
  buildManagerDigestEmail,
  buildAdminSummaryEmail,
  type ReminderPlan,
} from "@/lib/homeAddressReminder";
import type { ReminderRun, ReminderStateMap } from "@/lib/types";

/**
 * The Monday morning nudge for reps with no home address.
 *
 * Three ways in, and they are NOT interchangeable:
 *
 *   GET  + Bearer CRON_SECRET   the schedule firing. Sends for real.
 *   GET  + an admin session     read-only. Returns who WOULD be written to and
 *                               when the job last ran. Writes nothing, sends
 *                               nothing — the Reps page calls it on every load.
 *   POST + an admin session     send by hand, or `{ dryRun: true }` to get the
 *                               summary mail without troubling any rep.
 *
 * ⚠️ Sending is paced. Resend rate-limits at roughly two requests a second and
 * there are 46 people on this list today; firing them in a Promise.all would
 * have most of them come back 429 and look, from the run log, like 40 reps with
 * broken email addresses.
 *
 * The schedule lives in vercel.json, which cannot carry a comment, so it is
 * recorded here: `0 6 * * 1`. Vercel cron expressions are UTC and this client is
 * SAST (UTC+2), so 06:00 UTC is 08:00 Monday morning where the reps are. South
 * Africa has no daylight saving, so that holds all year.
 */

// 46 reps paced at ~0.6s each, plus managers and the summary. Well inside this,
// but the budget is what stops a slow ESP turning a partial send into a 504 with
// no run ever written — which is the state nobody can diagnose afterwards.
export const maxDuration = 300;

/** Resend allows ~2/second. Slower than it has to be, and never the problem. */
const SEND_GAP_MS = 600;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isCronCaller(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/** Where the run summary goes. Falls back to the reply-to nobody has to set twice. */
function summaryRecipient(): string {
  return (process.env.REMINDER_SUMMARY_TO || process.env.RESEND_REPLY_TO || "").trim();
}

async function loadPlan() {
  const [reps, users, teams, stores, state] = await Promise.all([
    getReps(),
    getUsers(),
    getTeams(),
    getStores(),
    getReminderState(),
  ]);
  return { plan: classifyReps({ reps, users, teams, stores, state }), state };
}

/**
 * Send, and retry once if the ESP asked us to slow down.
 *
 * A 429 is the one failure here that is not about the recipient. Recording it as
 * "email failed" would put a working address on the list of people to chase, and
 * on a list this size it would be several of them.
 */
async function sendPaced(input: Parameters<typeof sendEmail>[0]) {
  let result = await sendEmail(input);
  if (!result.sent && result.configured && result.reason.includes("(429)")) {
    await sleep(1500);
    result = await sendEmail(input);
  }
  await sleep(SEND_GAP_MS);
  return result;
}

interface RunOptions {
  trigger: "cron" | "manual";
  dryRun: boolean;
  actor: string;
  actorName: string;
}

async function runReminders(options: RunOptions) {
  const startedAt = new Date().toISOString();
  const settings = await getSettings();
  const { plan, state } = await loadPlan();

  const finish = async (run: Omit<ReminderRun, "id" | "startedAt" | "finishedAt">) => {
    const full: ReminderRun = {
      id: crypto.randomUUID(),
      startedAt,
      finishedAt: new Date().toISOString(),
      ...run,
    };
    await appendReminderRun(full);
    return full;
  };

  // The switch is off. Still logged, still counted — a job that goes quiet
  // without saying so is indistinguishable from one that broke.
  if (!remindersEnabled(settings) && options.trigger === "cron") {
    const run = await finish({
      trigger: options.trigger,
      dryRun: options.dryRun,
      outstanding: plan.outstanding.length,
      mailable: plan.mailable.length,
      sent: 0,
      failed: 0,
      blocked: plan.blocked.length,
      managersEmailed: 0,
      summarySent: false,
      settled: plan.settled.length,
      skippedReason: "Home address reminders are switched off in Settings.",
    });
    return { run, plan };
  }

  const failed: { code: string; name: string; email: string; reason: string }[] = [];
  let sent = 0;
  let managersEmailed = 0;
  const nextState: ReminderStateMap = { ...state };
  const now = new Date().toISOString();

  if (!options.dryRun) {
    for (const rep of plan.mailable) {
      const { subject, html, text } = buildRepReminderEmail({
        name: rep.name,
        timesReminded: rep.timesReminded,
        activeStores: rep.activeStores,
        hasAddressWithoutGps: rep.hasAddressWithoutGps,
      });
      const result = await sendPaced({ to: rep.email, subject, html, text });

      const prior = nextState[rep.repId];
      if (result.sent) {
        sent++;
        nextState[rep.repId] = {
          repId: rep.repId,
          repCode: rep.code,
          count: (prior?.count ?? 0) + 1,
          firstSentAt: prior?.firstSentAt ?? now,
          lastSentAt: now,
          lastResult: "sent",
        };
      } else {
        failed.push({ code: rep.code, name: rep.name, email: rep.email, reason: result.reason });
        // The count is NOT advanced on a failure. It reads as "times this rep has
        // been asked", and a mail that bounced asked nobody anything.
        nextState[rep.repId] = {
          repId: rep.repId,
          repCode: rep.code,
          count: prior?.count ?? 0,
          firstSentAt: prior?.firstSentAt ?? now,
          lastSentAt: prior?.lastSentAt ?? now,
          lastResult: "failed",
          lastError: result.reason,
        };
      }
    }

    for (const digest of plan.managerDigests) {
      const { subject, html, text } = buildManagerDigestEmail({
        managerName: digest.managerName,
        teamName: digest.teamName,
        reps: digest.reps,
      });
      const result = await sendPaced({ to: digest.managerEmail, subject, html, text });
      if (result.sent) managersEmailed++;
      else
        failed.push({
          code: "MANAGER",
          name: digest.managerName || digest.teamName,
          email: digest.managerEmail,
          reason: result.reason,
        });
    }

    // Written once, after every send, so a crash mid-run cannot leave the state
    // claiming reminders that were never delivered. One write, one key.
    await saveReminderState(nextState);
  }

  // The summary goes out even when there was nothing to do. It is the only
  // evidence the schedule is alive.
  let summarySent = false;
  const to = summaryRecipient();
  if (to) {
    const { subject, html, text } = buildAdminSummaryEmail({
      plan,
      sent,
      failed,
      dryRun: options.dryRun,
      managersEmailed,
      trigger: options.trigger,
    });
    const result = await sendPaced({ to, subject, html, text });
    summarySent = result.sent;
  }

  const run = await finish({
    trigger: options.trigger,
    dryRun: options.dryRun,
    outstanding: plan.outstanding.length,
    mailable: plan.mailable.length,
    sent,
    failed: failed.length,
    blocked: plan.blocked.length,
    managersEmailed,
    summarySent,
    settled: plan.settled.length,
    ...(to ? {} : { error: "No REMINDER_SUMMARY_TO or RESEND_REPLY_TO set — no summary was sent." }),
  });

  logActivity({
    action: options.dryRun ? "Previewed home address reminders" : "Sent home address reminders",
    actor: options.actor,
    actorName: options.actorName,
    summary: options.dryRun
      ? `${plan.outstanding.length} reps outstanding, ${plan.mailable.length} would be emailed`
      : `${sent} rep${sent === 1 ? "" : "s"} emailed, ${managersEmailed} manager${
          managersEmailed === 1 ? "" : "s"
        } copied, ${plan.outstanding.length} outstanding`,
  });

  return { run, plan, failed };
}

/** What the Reps page shows: the plan, plus the last few runs. */
function publicPlan(plan: ReminderPlan) {
  return {
    outstanding: plan.outstanding,
    mailable: plan.mailable.map((r) => r.repId),
    blocked: plan.blocked,
    settled: plan.settled,
    managerDigests: plan.managerDigests.map((d) => ({
      managerName: d.managerName,
      managerEmail: d.managerEmail,
      teamName: d.teamName,
      repCount: d.reps.length,
    })),
    repsWithNoManagerContact: plan.repsWithNoManagerContact,
    totalReps: plan.totalReps,
    repsWithHome: plan.repsWithHome,
  };
}

export async function GET(request: NextRequest) {
  // The schedule. Vercel Cron issues a GET, which is why the sending path lives
  // on the verb that otherwise only reads.
  if (isCronCaller(request)) {
    try {
      const { run } = await runReminders({
        trigger: "cron",
        dryRun: false,
        actor: "cron",
        actorName: "Scheduled job",
      });
      return NextResponse.json({ ok: true, run });
    } catch (err) {
      // A thrown run is the invisible failure this whole design is guarding
      // against, so it is written down before the 500 goes back.
      console.error("Home address reminder cron failed:", err);
      await appendReminderRun({
        id: crypto.randomUUID(),
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        trigger: "cron",
        dryRun: false,
        outstanding: 0,
        mailable: 0,
        sent: 0,
        failed: 0,
        blocked: 0,
        managersEmailed: 0,
        summarySent: false,
        settled: 0,
        error: String(err),
      }).catch(() => {});
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  // Anything else is a person looking. Read-only, on purpose: this is fetched on
  // every Reps page load, and a route that sent mail when it was merely looked
  // at would be a disaster with 46 real people on the other end.
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await sessionHasPermission(session, "manage_reps"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [{ plan }, settings, runs] = await Promise.all([
      loadPlan(),
      getSettings(),
      getReminderRuns(),
    ]);

    return NextResponse.json({
      enabled: remindersEnabled(settings),
      schedule: "Every Monday at 08:00 (SAST)",
      summaryTo: summaryRecipient() || null,
      cronSecretSet: !!process.env.CRON_SECRET,
      plan: publicPlan(plan),
      runs: runs.slice(0, 10),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await sessionHasPermission(session, "manage_reps"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const dryRun = body?.dryRun === true;

    const { run, plan, failed } = await runReminders({
      trigger: "manual",
      dryRun,
      actor: session.email,
      actorName: session.name,
    });

    return NextResponse.json({ ok: true, run, plan: publicPlan(plan), failed: failed ?? [] });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
