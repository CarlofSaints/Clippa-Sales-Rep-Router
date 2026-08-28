import type { Rep, Store } from "./types";
import type { MapRow } from "./mapStatus";
import { norm } from "./imsReconCore";

/**
 * Which system decides who a store belongs to.
 *
 * "repsly" is how this app has always worked: a Places export carries a
 * Representative ID and the upload writes it. "ims" makes the client's
 * invoicing system the authority instead, because IMS knows who actually bills
 * the outlet and the Places files are a snapshot of whatever Repsly held on the
 * day they were exported.
 *
 * ⚠️ The setting is not only about a one-off re-assignment. It also decides
 * whether the NEXT upload is allowed to overwrite a rep code. Without that half,
 * an IMS allocation survives exactly until somebody loads a spreadsheet.
 */
export type AllocationSource = "repsly" | "ims";

export interface AllocationSettings {
  source: AllocationSource;
  /**
   * Whether to move a store onto an IMS rep code that has no rep record here.
   *
   * 🔴 Default false, and it matters. A store whose rep code matches no rep is
   * dropped from the map, every route and all capacity figures, silently. IMS
   * carries branch and house codes like ACCC, JHB and CMRINL that are not people
   * at all, so obeying IMS blindly would strand real stores behind a code nobody
   * can be assigned to.
   */
  allowUnknownReps: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const DEFAULT_ALLOCATION: AllocationSettings = {
  source: "repsly",
  allowUnknownReps: false,
  updatedAt: null,
  updatedBy: null,
};

/** IMS carries a parallel CMR spelling of the same person, e.g. GAU012 / GAU012CMR. */
export function canonicalRepCode(code: unknown): string {
  return norm(code).replace(/CMR$/, "");
}

export interface AllocationMove {
  storeId: string;
  placeId: string;
  storeName: string;
  from: string;
  to: string;
  /** The rep record the store would land on, or null when the code is unknown here. */
  toRepName: string | null;
  sixMonthSales: number | null;
}

export interface AllocationPlan {
  /** Moves that would be applied. */
  moves: AllocationMove[];
  /** Moves held back because the destination rep code has no rep record. */
  held: AllocationMove[];
  /** Stores where IMS and the router already agree. */
  unchanged: number;
  /** Stores IMS has no rep for. They keep whatever they carry. */
  imsSilent: number;
  /** Unknown destination codes, with how many stores each would strand. */
  unknownCodes: { code: string; stores: number }[];
  /** Net store movement per rep code, for showing who gains and who loses. */
  netByRep: { code: string; name: string | null; gained: number; lost: number; valueGained: number }[];
}

/**
 * What moving to an IMS-led allocation would do, without doing any of it.
 *
 * Pure, and separated from the route that writes, because this decides which
 * human is credited with which shop. It is asserted directly rather than
 * inferred from a page.
 */
export function planImsAllocation(
  stores: Store[],
  reps: Rep[],
  imsRows: Record<string, MapRow>,
  settings: AllocationSettings
): AllocationPlan {
  const repByCode = new Map<string, Rep>();
  for (const r of reps) repByCode.set(canonicalRepCode(r.code), r);

  const moves: AllocationMove[] = [];
  const held: AllocationMove[] = [];
  const unknown = new Map<string, number>();
  let unchanged = 0;
  let imsSilent = 0;

  for (const store of stores) {
    const row = imsRows[norm(store.placeId || store.id)];
    const to = canonicalRepCode(row?.imsRepCode);
    const from = canonicalRepCode(store.repCode);

    // No opinion from IMS is not the same as "belongs to nobody". The store
    // keeps whatever it carries.
    if (!to) {
      imsSilent++;
      continue;
    }
    if (to === from) {
      unchanged++;
      continue;
    }

    const rep = repByCode.get(to) ?? null;
    const move: AllocationMove = {
      storeId: store.id,
      placeId: store.placeId || store.id,
      storeName: store.name,
      from: store.repCode || "",
      to,
      toRepName: rep?.name ?? null,
      sixMonthSales: store.sixMonthSales ?? row?.sixMonthSales ?? null,
    };

    if (!rep && !settings.allowUnknownReps) {
      unknown.set(to, (unknown.get(to) ?? 0) + 1);
      held.push(move);
    } else {
      if (!rep) unknown.set(to, (unknown.get(to) ?? 0) + 1);
      moves.push(move);
    }
  }

  // Who gains and who loses, counted only over the moves that would apply.
  const net = new Map<string, { gained: number; lost: number; valueGained: number }>();
  const touch = (c: string) => {
    if (!net.has(c)) net.set(c, { gained: 0, lost: 0, valueGained: 0 });
    return net.get(c)!;
  };
  for (const m of moves) {
    const g = touch(m.to);
    g.gained++;
    g.valueGained += m.sixMonthSales ?? 0;
    if (m.from) touch(canonicalRepCode(m.from)).lost++;
  }

  return {
    moves,
    held,
    unchanged,
    imsSilent,
    unknownCodes: [...unknown]
      .map(([code, stores]) => ({ code, stores }))
      .sort((a, b) => b.stores - a.stores),
    netByRep: [...net]
      .map(([code, v]) => ({ code, name: repByCode.get(code)?.name ?? null, ...v }))
      .sort((a, b) => b.gained - a.gained),
  };
}
