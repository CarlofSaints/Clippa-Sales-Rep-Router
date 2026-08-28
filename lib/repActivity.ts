import type { Rep, Store, RoutePlanDocument } from "./types";
import { getMonthlyRate } from "./types";
import type { MapRow } from "./mapStatus";
import { computeCommission, type CommissionSettings, type CommissionResult } from "./commission";

/**
 * One rep, across every system that has an opinion about them.
 *
 * The router, Repsly and IMS each hold a different answer to "which stores are
 * this person's", and the value of this page is that it puts the three next to
 * each other instead of picking one and calling it the truth.
 *
 * ⚠️ Counts and revenue come from DIFFERENT populations on purpose:
 *  - the Repsly count is what the router holds, which is what the Places
 *    exports put there,
 *  - the IMS count is what the client invoices under that rep code, including
 *    outlets no rep is routed to at all,
 *  - revenue is only ever what IMS has actually invoiced.
 * They are not meant to agree, and a page that made them agree would be hiding
 * the finding.
 */
export interface RepActivityRow {
  repCode: string;
  repName: string;
  teamId: string;
  teamName: string;

  /** Stores carrying this rep code in the router, which arrived from Repsly. */
  storesRepsly: number;
  /** Outlets IMS bills under this rep code, routed or not. */
  storesIms: number;
  /** Of those, the ones no store in the router matches. */
  storesImsOnly: number;

  /** Calls a month implied by the store frequencies the rep carries. */
  callsPerMonth: number;

  /**
   * Six-month IMS value across the rep's stores, and the same figure per month.
   *
   * ⚠️ Absent is not zero. A store IMS has never invoiced contributes nothing
   * and is counted separately, so a low portfolio can be read as either quiet
   * stores or unmatched ones.
   */
  portfolioSixMonth: number;
  portfolioMonthly: number;
  /** How many of the rep's stores carry no IMS figure at all. */
  storesWithoutSales: number;

  commission: CommissionResult;

  /** The same three numbers again for the plan being compared against. */
  newCycleStores: number | null;
  newCyclePortfolioMonthly: number | null;
  newCycleCommission: CommissionResult | null;
}

export interface RepActivityInput {
  reps: Rep[];
  stores: Store[];
  teams: { id: string; name: string }[];
  /** The IMS snapshot: per-store rows plus outlets nobody is routed to. */
  imsRows: Record<string, MapRow>;
  imsGhosts: MapRow[];
  commission: CommissionSettings;
  /**
   * The plan the "new cycle" columns describe. Null leaves them blank rather
   * than defaulting to the current allocation, because a new cycle that
   * silently equals the old one is the most misleading thing this page could
   * show.
   */
  newCyclePlan: RoutePlanDocument | null;
}

const code = (v: unknown) => String(v ?? "").trim().toUpperCase();
const key = (s: Store) => code(s.placeId || s.id);

export function buildRepActivity(input: RepActivityInput): RepActivityRow[] {
  const { reps, stores, teams, imsRows, imsGhosts, commission, newCyclePlan } = input;

  const teamName = new Map(teams.map((t) => [t.id, t.name]));

  // ── What IMS says, counted per rep code ──────────────────────────────
  // Both directions: stores the router also has, and outlets it does not.
  const imsCount = new Map<string, number>();
  const imsOnlyCount = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => {
    if (!k) return;
    m.set(k, (m.get(k) ?? 0) + 1);
  };
  for (const row of Object.values(imsRows)) bump(imsCount, code(row.imsRepCode));
  for (const ghost of imsGhosts) {
    bump(imsCount, code(ghost.imsRepCode));
    bump(imsOnlyCount, code(ghost.imsRepCode));
  }

  // ── Stores in the plan being compared against ────────────────────────
  // A store visited four times a month is still ONE store, so the set is
  // deduplicated before it is counted or valued.
  const planStores = new Map<string, Set<string>>();
  for (const plan of newCyclePlan?.repPlans ?? []) {
    const set = planStores.get(code(plan.repCode)) ?? new Set<string>();
    for (const day of plan.days) for (const stop of day.stops) set.add(code(stop.storeId));
    planStores.set(code(plan.repCode), set);
  }

  const storeById = new Map(stores.map((s) => [code(s.id), s]));
  const byRep = new Map<string, Store[]>();
  for (const s of stores) {
    const c = code(s.repCode);
    if (!c) continue;
    const list = byRep.get(c) ?? [];
    list.push(s);
    byRep.set(c, list);
  }

  return reps.map((rep) => {
    const c = code(rep.code);
    const mine = byRep.get(c) ?? [];

    let portfolioSixMonth = 0;
    let storesWithoutSales = 0;
    let callsPerMonth = 0;
    for (const s of mine) {
      // Prefer the store's own six-month figure, falling back to the snapshot
      // for a store the apply-sales step has not written yet.
      const six = s.sixMonthSales ?? imsRows[key(s)]?.sixMonthSales ?? null;
      if (six == null) storesWithoutSales++;
      else portfolioSixMonth += six;
      callsPerMonth += getMonthlyRate(s.frequency);
    }
    const portfolioMonthly = portfolioSixMonth / 6;

    const planned = planStores.get(c) ?? null;
    let newCyclePortfolioMonthly: number | null = null;
    if (planned) {
      let six = 0;
      for (const id of planned) {
        const s = storeById.get(id);
        if (!s) continue;
        six += s.sixMonthSales ?? imsRows[key(s)]?.sixMonthSales ?? 0;
      }
      newCyclePortfolioMonthly = six / 6;
    }

    return {
      repCode: rep.code,
      repName: rep.name,
      teamId: rep.teamId || "",
      teamName: teamName.get(rep.teamId || "") || "",
      storesRepsly: mine.length,
      storesIms: imsCount.get(c) ?? 0,
      storesImsOnly: imsOnlyCount.get(c) ?? 0,
      callsPerMonth: Math.round(callsPerMonth * 10) / 10,
      portfolioSixMonth,
      portfolioMonthly,
      storesWithoutSales,
      commission: computeCommission(portfolioMonthly, commission),
      newCycleStores: planned ? planned.size : null,
      newCyclePortfolioMonthly,
      newCycleCommission:
        newCyclePortfolioMonthly === null
          ? null
          : computeCommission(newCyclePortfolioMonthly, commission),
    };
  });
}

/** Column totals, for a footer row that survives filtering. */
export function totalRepActivity(rows: RepActivityRow[]) {
  const sum = (f: (r: RepActivityRow) => number) => rows.reduce((t, r) => t + f(r), 0);
  return {
    reps: rows.length,
    storesRepsly: sum((r) => r.storesRepsly),
    storesIms: sum((r) => r.storesIms),
    callsPerMonth: Math.round(sum((r) => r.callsPerMonth) * 10) / 10,
    portfolioMonthly: sum((r) => r.portfolioMonthly),
    earning: sum((r) => r.commission.earning),
    qualifying: rows.filter((r) => r.commission.qualifies).length,
    newCycleStores: sum((r) => r.newCycleStores ?? 0),
    newCyclePortfolioMonthly: sum((r) => r.newCyclePortfolioMonthly ?? 0),
    newCycleEarning: sum((r) => r.newCycleCommission?.earning ?? 0),
  };
}
