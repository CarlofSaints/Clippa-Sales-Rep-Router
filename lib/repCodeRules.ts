/**
 * Which rep codes are actually a rep.
 *
 * IMS files sales under a "Rep Code" that is not always a person in the field.
 * Read off the 2 Sep 2026 snapshot: `CMRINL`, `CMRWC`, `CMRKZN`, `CMRFS`,
 * `CMREC` and `CMRMP` are a THIRD-PARTY AGENT — 1 072 outlets and R46.1m of
 * six-month sales — and `IRAMWC` belongs to another business entirely. Neither
 * has a rep record here and neither should ever get one. Until this existed
 * they were counted as unrouted opportunity, which made the gap between what
 * Clippa bills and what the router covers R7.7m a month bigger than it is.
 *
 * ⚠️ This deliberately does NOT change route generation. Carl's call, 3 Sep:
 * a store currently linked to one of these codes is more likely to be linked
 * WRONGLY than to be genuinely un-visitable, so dropping it from a route would
 * quietly stop a rep visiting a real shop. The exclusion governs REPORTING and
 * DATA ENTRY only — see the three effects in `lib/repCodeRules` callers.
 *
 * Nothing here reads storage or the network, so the rules can be asserted
 * against the real module.
 */

import type { RepCodeDecision, RepCodePrefixRule, RepCodeRules } from "./types";

export const EMPTY_REP_CODE_RULES: RepCodeRules = { codes: [], prefixes: [] };

/**
 * The one way a rep code is compared, anywhere.
 *
 * Codes arrive from three systems and a spreadsheet, so `cmrinl`, `CMRINL ` and
 * `CMRINL` are the same code and must never be three rows on the page. This is
 * the same normalisation the coverage report and the route engine already use
 * on `store.repCode`; see [[a-string-used-as-a-join-key]].
 */
export function normaliseRepCode(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

export type RepCodeVerdictReason =
  /** A person ticked this exact code. */
  | "explicit"
  /** A "starts with" rule caught it. */
  | "prefix"
  /** Nothing says otherwise, so it is treated as a rep. */
  | "default";

export interface RepCodeVerdict {
  code: string;
  routable: boolean;
  reason: RepCodeVerdictReason;
  /** The prefix that decided it, when `reason` is "prefix". */
  prefix?: string;
  /** The label on that prefix rule, e.g. "Third-party agent". */
  prefixLabel?: string;
  /** Why a person excluded it, when they said. */
  note?: string;
}

/**
 * Is this code a rep the router should be planning for?
 *
 * Precedence, and the order is the whole point of having both mechanisms:
 *
 *   1. an EXPLICIT decision on the exact code wins, in either direction. That
 *      is what lets one code be rescued from a prefix rule that is otherwise
 *      right — without it, `CMR*` could never spare a real rep who happened to
 *      be coded `CMRJOHN`.
 *   2. otherwise a matching prefix rule excludes it.
 *   3. otherwise it is a rep.
 *
 * So the stored decision is genuinely THREE-STATE and is optional rather than
 * defaulted: absent means "follow the rules", `true` means "a rep, whatever the
 * rules say", `false` means "not a rep". Collapsing absent into false would
 * exclude every code in IMS the moment this shipped ([[three-state-flag-absent-is-not-false]]).
 */
export function resolveRepCode(rawCode: unknown, rules: RepCodeRules): RepCodeVerdict {
  const code = normaliseRepCode(rawCode);

  const explicit = rules.codes.find((c) => normaliseRepCode(c.code) === code);
  if (explicit && typeof explicit.routable === "boolean") {
    return { code, routable: explicit.routable, reason: "explicit", note: explicit.note };
  }

  // Longest prefix first, so a narrow rule beats a broad one when both match
  // and the page can name the one that actually decided.
  const matches = rules.prefixes
    .filter((p) => {
      const prefix = normaliseRepCode(p.prefix);
      return !!prefix && code.startsWith(prefix);
    })
    .sort((a, b) => normaliseRepCode(b.prefix).length - normaliseRepCode(a.prefix).length);

  if (matches.length > 0) {
    return {
      code,
      routable: false,
      reason: "prefix",
      prefix: normaliseRepCode(matches[0].prefix),
      prefixLabel: matches[0].label,
    };
  }

  return { code, routable: true, reason: "default" };
}

/** Shorthand for the common question. A blank code is nobody's, so not a rep. */
export function isRoutableRepCode(rawCode: unknown, rules: RepCodeRules): boolean {
  if (!normaliseRepCode(rawCode)) return false;
  return resolveRepCode(rawCode, rules).routable;
}

// ── Editing the rules ────────────────────────────────────────────────────

/**
 * Record a decision about one code, replacing any previous one.
 *
 * `routable: null` REMOVES the decision rather than storing a third value, so
 * the code goes back to following the prefix rules. A page that could only add
 * decisions would give you no way to undo a mistaken tick.
 */
export function setRepCodeDecision(
  rules: RepCodeRules,
  rawCode: unknown,
  routable: boolean | null,
  who: string,
  note?: string
): RepCodeRules {
  const code = normaliseRepCode(rawCode);
  if (!code) return rules;
  const codes = rules.codes.filter((c) => normaliseRepCode(c.code) !== code);
  if (routable === null) return { ...rules, codes };
  codes.push({
    code,
    routable,
    note: note?.trim() || undefined,
    decidedAt: new Date().toISOString(),
    decidedBy: who,
  });
  return { ...rules, codes };
}

export interface AddPrefixResult {
  rules: RepCodeRules;
  error?: string;
}

/**
 * Add a "starts with" rule.
 *
 * Refuses a duplicate, and refuses a prefix so short it would catch the whole
 * book. `CMR` is three characters and catches six codes; `C` is one and would
 * catch every Cape Town rep — a rule that silently unrouted 20 people would be
 * indistinguishable from the feature being broken.
 */
export function addRepCodePrefix(
  rules: RepCodeRules,
  rawPrefix: unknown,
  label: string,
  who: string
): AddPrefixResult {
  const prefix = normaliseRepCode(rawPrefix);
  if (!prefix) return { rules, error: "Type the start of the codes to exclude, for example CMR." };
  if (prefix.length < 2) {
    return {
      rules,
      error: `"${prefix}" is too short — it would catch almost every rep code. Use at least two characters.`,
    };
  }
  if (rules.prefixes.some((p) => normaliseRepCode(p.prefix) === prefix)) {
    return { rules, error: `There is already a rule for codes starting with ${prefix}.` };
  }
  return {
    rules: {
      ...rules,
      prefixes: [
        ...rules.prefixes,
        {
          id: crypto.randomUUID(),
          prefix,
          label: label.trim() || "Not a rep",
          createdAt: new Date().toISOString(),
          createdBy: who,
        },
      ],
    },
  };
}

export function removeRepCodePrefix(rules: RepCodeRules, id: string): RepCodeRules {
  return { ...rules, prefixes: rules.prefixes.filter((p) => p.id !== id) };
}

// ── Reporting ────────────────────────────────────────────────────────────

export interface CodeFacts {
  code: string;
  /** Outlets IMS bills under this code, routed or not. */
  imsOutlets: number;
  /** Of those, how many have no store in the router. */
  imsUnrouted: number;
  /** Six-month IMS value across all of them, routed and not. */
  sixMonthSales: number;
  /**
   * Six-month value of the UNROUTED ones only.
   *
   * Kept separately rather than derived, because it is the opportunity figure
   * and the total is not. Mixing them is the mistake this field exists to stop:
   * counting unrouted OUTLETS against the code's FULL value reports a gap that
   * includes shops a rep already visits every month.
   */
  unroutedSixMonthSales: number;
  /** Stores in the router allocated to this code. */
  routerStores: number;
  /** The rep record, when the app has one. */
  repName: string | null;
}

export interface CodeRow extends CodeFacts {
  verdict: RepCodeVerdict;
}

export interface RepCodeSummary {
  /** Every code seen, decided or not, worst-value first. */
  rows: CodeRow[];
  totalCodes: number;
  excludedCodes: number;
  /**
   * The unrouted opportunity, SPLIT.
   *
   * Both halves are always reported. A single number that had quietly dropped
   * the agent outlets would be unauditable, and the excluded figure is itself
   * worth seeing — R7.7m a month is not a rounding error, it is a business
   * decision somebody made ([[new-exclusion-must-reach-old-reports]]).
   */
  chaseable: { outlets: number; sixMonthSales: number };
  excluded: { outlets: number; sixMonthSales: number };
}

/** Build the page's table and the split totals from facts + rules. */
export function summariseRepCodes(facts: CodeFacts[], rules: RepCodeRules): RepCodeSummary {
  const rows: CodeRow[] = facts.map((f) => ({ ...f, verdict: resolveRepCode(f.code, rules) }));
  rows.sort(
    (a, b) => b.sixMonthSales - a.sixMonthSales || a.code.localeCompare(b.code)
  );

  const chaseable = { outlets: 0, sixMonthSales: 0 };
  const excluded = { outlets: 0, sixMonthSales: 0 };
  for (const r of rows) {
    // Only the UNROUTED outlets are an opportunity: a routed one is already
    // somebody's. Outlets and value must come from the SAME population, which
    // is why `unroutedSixMonthSales` exists rather than being derived here.
    const bucket = r.verdict.routable ? chaseable : excluded;
    bucket.outlets += r.imsUnrouted;
    bucket.sixMonthSales += r.unroutedSixMonthSales;
  }

  return {
    rows,
    totalCodes: rows.length,
    excludedCodes: rows.filter((r) => !r.verdict.routable).length,
    chaseable,
    excluded,
  };
}
