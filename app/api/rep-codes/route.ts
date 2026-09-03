import { NextRequest, NextResponse } from "next/server";
import { getReps, getStores, getRepCodeRules, saveRepCodeRules } from "@/lib/data";
import { getImsSnapshot } from "@/lib/imsSnapshot";
import { getSession, sessionHasPermission } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import {
  normaliseRepCode,
  summariseRepCodes,
  setRepCodeDecision,
  addRepCodePrefix,
  removeRepCodePrefix,
  resolveRepCode,
  type CodeFacts,
} from "@/lib/repCodeRules";

/**
 * Every rep code any system has an opinion about, and whether it is a rep.
 *
 * The candidate list is the UNION of three sources, not one of them:
 *   - the app's own rep records,
 *   - `store.repCode` in the router,
 *   - `Rep Code` on every IMS outlet, routed or not.
 *
 * It has to be the union. A code with no rep record and no router store is
 * exactly the case this page exists for — `CMRINL` bills R21.9m and appears in
 * neither of the first two.
 */

export const maxDuration = 60;

async function requireManageReps() {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!(await sessionHasPermission(session, "manage_reps"))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

async function gatherFacts(): Promise<CodeFacts[]> {
  const [reps, stores, snapshot] = await Promise.all([
    getReps(),
    getStores(),
    // The snapshot enriches this page, it does not carry it: without it the
    // page still lists the codes the router knows. A failed read must not take
    // the page down, the same rule /api/rep-activity follows.
    getImsSnapshot().catch(() => null),
  ]);

  const facts = new Map<string, CodeFacts>();
  const touch = (rawCode: unknown): CodeFacts | null => {
    const code = normaliseRepCode(rawCode);
    if (!code) return null;
    const existing = facts.get(code);
    if (existing) return existing;
    const fresh: CodeFacts = {
      code,
      imsOutlets: 0,
      imsUnrouted: 0,
      sixMonthSales: 0,
      unroutedSixMonthSales: 0,
      routerStores: 0,
      repName: null,
    };
    facts.set(code, fresh);
    return fresh;
  };

  for (const rep of reps) {
    const f = touch(rep.code);
    if (f) f.repName = rep.name;
  }

  for (const store of stores) {
    // Closed shops still count here. A code is or is not a rep regardless of
    // how many of its shops have shut, and hiding them would make a code that
    // has been wound down look like it was never used.
    const f = touch(store.repCode);
    if (f) f.routerStores++;
  }

  for (const row of Object.values(snapshot?.rows ?? {})) {
    const f = touch(row.imsRepCode);
    if (!f) continue;
    f.imsOutlets++;
    f.sixMonthSales += row.sixMonthSales ?? 0;
  }

  for (const ghost of snapshot?.ghosts ?? []) {
    const f = touch(ghost.imsRepCode);
    if (!f) continue;
    f.imsOutlets++;
    f.imsUnrouted++;
    f.sixMonthSales += ghost.sixMonthSales ?? 0;
    f.unroutedSixMonthSales += ghost.sixMonthSales ?? 0;
  }

  return [...facts.values()];
}

export async function GET() {
  try {
    const gate = await requireManageReps();
    if (gate.error) return gate.error;

    const [facts, rules, snapshot] = await Promise.all([
      gatherFacts(),
      getRepCodeRules(),
      getImsSnapshot().catch(() => null),
    ]);

    return NextResponse.json({
      ...summariseRepCodes(facts, rules),
      rules,
      snapshotFetchedAt: snapshot?.fetchedAt ?? null,
      hasSnapshot: !!snapshot && Object.keys(snapshot.rows).length > 0,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * Body is one of:
 *   { code, routable: boolean | null, note? }   decide one code, null clears it
 *   { prefix, label }                            add a "starts with" rule
 *
 * Deliberately not a single generic "save the rules" PUT. A whole-object write
 * from a page that had stale data would silently undo somebody else's decision;
 * these each change one thing.
 */
export async function POST(request: NextRequest) {
  try {
    const gate = await requireManageReps();
    if (gate.error) return gate.error;
    const session = gate.session!;

    const body = await request.json().catch(() => ({}));
    const current = await getRepCodeRules();

    if (typeof body.prefix === "string") {
      const { rules, error } = addRepCodePrefix(current, body.prefix, String(body.label ?? ""), session.email);
      if (error) return NextResponse.json({ error }, { status: 400 });
      await saveRepCodeRules(rules);
      const prefix = normaliseRepCode(body.prefix);
      // How many codes it caught, because a rule that matched nothing is a typo
      // and a rule that matched 40 is a mistake — both worth seeing at once.
      const caught = (await gatherFacts()).filter(
        (f) => resolveRepCode(f.code, rules).prefix === prefix
      );
      logActivity({
        action: "Excluded rep codes by prefix",
        actor: session.email,
        actorName: session.name,
        summary: `Codes starting with ${prefix} are not reps (${caught.length} code${
          caught.length === 1 ? "" : "s"
        } matched): ${String(body.label ?? "").trim() || "no label"}`,
      });
      return NextResponse.json({ ok: true, matched: caught.map((c) => c.code) });
    }

    if (typeof body.code === "string") {
      const code = normaliseRepCode(body.code);
      if (!code) return NextResponse.json({ error: "No rep code given." }, { status: 400 });
      const routable = body.routable === null ? null : body.routable === true;
      const rules = setRepCodeDecision(current, code, routable, session.email, body.note);
      await saveRepCodeRules(rules);
      logActivity({
        action: "Set whether a rep code is a rep",
        actor: session.email,
        actorName: session.name,
        summary:
          routable === null
            ? `${code} follows the prefix rules again`
            : `${code} is ${routable ? "a rep" : "NOT a rep"}${
                body.note ? ` — ${String(body.note).trim()}` : ""
              }`,
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Send either a code or a prefix." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const gate = await requireManageReps();
    if (gate.error) return gate.error;
    const session = gate.session!;

    const id = request.nextUrl.searchParams.get("prefixId");
    if (!id) return NextResponse.json({ error: "No rule named." }, { status: 400 });

    const current = await getRepCodeRules();
    const rule = current.prefixes.find((p) => p.id === id);
    if (!rule) return NextResponse.json({ error: "That rule no longer exists." }, { status: 404 });

    await saveRepCodeRules(removeRepCodePrefix(current, id));
    logActivity({
      action: "Removed a rep code prefix rule",
      actor: session.email,
      actorName: session.name,
      summary: `Codes starting with ${rule.prefix} count as reps again`,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
