import type { Store } from "./types";
import type { MapRow } from "./mapStatus";

/**
 * Which stores are shut, and therefore must not be visited.
 *
 * Ago confirmed on 30 Aug 2026 that IMS reuses the REP CODE field to park dead
 * accounts: a store whose IMS rep code is `ACCC` is a closed account, not a
 * store belonging to a rep called ACCC. That is why 89 of them were being held
 * back by the allocation as "a rep code with no rep record" — the allocation was
 * right to refuse, but for the wrong reason.
 *
 * ⚠️ IMS says this TWICE and the two do not agree. `Closed Status` is its own
 * boolean field and covers 178 stores that are NOT on ACCC, while 8 ACCC stores
 * are not flagged. Neither is a superset, so they are kept as separate reasons
 * and the caller chooses. Measured, not assumed — see the counts in the tests.
 */

/** Why a store is shut. Manual is never overwritten by an automatic pass. */
export type ClosedReason = "ims_accc" | "ims_flag" | "manual";

export const CLOSED_REASON_LABEL: Record<ClosedReason, string> = {
  ims_accc: "IMS account closed (ACCC)",
  ims_flag: "IMS closed status",
  manual: "Closed by hand",
};

/** The IMS rep code that means "this account is closed", not "this rep owns it". */
export const ACCC_CODE = "ACCC";

const norm = (v: unknown) => String(v ?? "").trim().toUpperCase();

/**
 * Is this store shut?
 *
 * The single definition. Every consumer that plans or measures a VISIT reads
 * this rather than testing the field itself, so there is one place to change
 * when the rule moves.
 */
export function isClosed(store: Store): boolean {
  return store.closed === true;
}

/** Stores a rep should actually be routed to. */
export function activeStores(stores: Store[]): Store[] {
  return stores.filter((s) => !isClosed(s));
}

/** What the status badge says, and what the filter groups on. */
export type StoreStatus = "active" | "closed";

export function storeStatus(store: Store): StoreStatus {
  return isClosed(store) ? "closed" : "active";
}

/**
 * Why this store is shut, in words, or null when it is open.
 *
 * Read by the grid so "why is this shut?" is answerable without opening the
 * IMS page. An older record closed before `closedReason` existed falls back to
 * the generic label rather than rendering an empty tooltip.
 */
export function closedReasonLabel(store: Store): string | null {
  if (!isClosed(store)) return null;
  const reason = store.closedReason as ClosedReason | undefined;
  return reason ? CLOSED_REASON_LABEL[reason] : "Closed";
}

/**
 * The fields to write when a PERSON flips a store between active and closed.
 *
 * Pure, and returns a patch rather than mutating, because this is the write
 * that stops a rep being sent to a shop. It is asserted directly instead of
 * being inferred from the route that calls it.
 *
 * Closing by hand always records `manual` as the reason, never the IMS reason
 * that happens to also apply. That is what protects the decision from the next
 * automatic pass, and a hand-close that recorded `ims_flag` would be silently
 * undone the first time IMS changed its mind.
 *
 * Reopening CLEARS the reason and the timestamp — a store that is open has no
 * reason to be shut, and leaving the old one behind is how a reopened shop goes
 * on showing "IMS account closed" in its tooltip forever.
 */
export function setStatusByHand(
  store: Store,
  closed: boolean,
  now: string = new Date().toISOString()
): Pick<Store, "closed" | "closedReason" | "closedAt" | "statusDecidedByHand"> {
  if (closed) {
    return {
      closed: true,
      closedReason: "manual",
      closedAt: now,
      statusDecidedByHand: true,
    };
  }
  return {
    closed: false,
    closedReason: undefined,
    closedAt: undefined,
    statusDecidedByHand: true,
  };
}

export interface ClosureMove {
  storeId: string;
  placeId: string;
  name: string;
  repCode: string;
  reason: ClosedReason;
  /** Six-month IMS sales, so a "closed" store that is still buying is visible. */
  sixMonthSales: number | null;
}

export interface ClosurePlan {
  /** Open stores that IMS says are shut. */
  toClose: ClosureMove[];
  /**
   * Stores marked closed BY AN EARLIER AUTOMATIC PASS that IMS no longer calls
   * shut. Reported separately and applied only on request.
   *
   * 🔴 Without this a closure never heals: a shop that reopens keeps the flag
   * forever and no rep is ever routed to it again, which is a worse failure
   * than visiting a dead store. A store closed BY HAND is never in this list —
   * a person decided that, and IMS does not get to overrule them.
   */
  toReopen: ClosureMove[];
  /** How many would close for each reason, for showing the split before applying. */
  byReason: Record<ClosedReason, number>;
  /** Already closed and still closed. */
  unchanged: number;
  /** Closed stores that nonetheless have sales in the six-month window. */
  closedButSelling: ClosureMove[];
}

export interface ClosureOptions {
  /**
   * Include IMS's own `Closed Status` flag, not only the ACCC code.
   *
   * Defaults to FALSE. Ago's instruction was specifically about ACCC, and the
   * flag sweeps in 178 more stores; widening someone's instruction by a factor
   * of three without being asked is how a "helpful" default becomes a surprise.
   */
  includeImsFlag?: boolean;
}

/**
 * What marking closures would do, without doing any of it.
 *
 * Pure, and separated from the route that writes, because this decides which
 * shops a rep stops visiting. Asserted directly rather than inferred from a page.
 */
export function planClosures(
  stores: Store[],
  mapRows: Record<string, MapRow> | Map<string, MapRow>,
  options: ClosureOptions = {}
): ClosurePlan {
  const rows = mapRows instanceof Map ? mapRows : new Map(Object.entries(mapRows));
  const includeFlag = options.includeImsFlag === true;

  const toClose: ClosureMove[] = [];
  const toReopen: ClosureMove[] = [];
  const closedButSelling: ClosureMove[] = [];
  const byReason: Record<ClosedReason, number> = { ims_accc: 0, ims_flag: 0, manual: 0 };
  let unchanged = 0;

  for (const store of stores) {
    const row = rows.get(norm(store.placeId));
    const sixMonthSales = row?.sixMonthSales ?? null;

    // ACCC is checked first, so a store that is both keeps the more specific
    // reason. The reason is what a human reads when asking "why is this shut?".
    const isAccc = row ? norm(row.imsRepCode) === ACCC_CODE : false;
    const isFlagged = row ? row.flags?.closedInIms === true : false;
    const imsSaysClosed = isAccc || (includeFlag && isFlagged);
    const reason: ClosedReason = isAccc ? "ims_accc" : "ims_flag";

    const move: ClosureMove = {
      storeId: store.id,
      placeId: store.placeId,
      name: store.name,
      repCode: store.repCode,
      reason,
      sixMonthSales,
    };

    // 🔴 A person who has looked at this shop outranks a spreadsheet that has
    // not, in BOTH directions. The old rule protected a hand-CLOSED store from
    // being reopened but left a hand-REOPENED one exposed: IMS still carries the
    // flag, so the next closure run would quietly shut it again and nobody would
    // be told. A store somebody has ruled on is skipped by the automatic pass.
    //
    // It is still COUNTED, and still reported as closed-but-selling, because
    // that is information rather than an action.
    const decidedByHand = store.statusDecidedByHand === true || store.closedReason === "manual";

    if (isClosed(store)) {
      unchanged++;
      if ((sixMonthSales ?? 0) > 0) {
        closedButSelling.push({ ...move, reason: (store.closedReason as ClosedReason) ?? "manual" });
      }
      if (!decidedByHand && !imsSaysClosed) {
        toReopen.push({ ...move, reason: (store.closedReason as ClosedReason) ?? "ims_accc" });
      }
      continue;
    }

    if (imsSaysClosed && !decidedByHand) {
      toClose.push(move);
      byReason[reason]++;
    }
  }

  const bySales = (a: ClosureMove, b: ClosureMove) =>
    (b.sixMonthSales ?? 0) - (a.sixMonthSales ?? 0) || a.name.localeCompare(b.name);
  toClose.sort(bySales);
  toReopen.sort(bySales);
  closedButSelling.sort(bySales);

  return { toClose, toReopen, byReason, unchanged, closedButSelling };
}
