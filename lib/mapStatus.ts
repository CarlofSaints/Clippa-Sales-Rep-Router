import type { Store } from "./types";
import type { ImsStore } from "./imsReconCore";
import { norm, suffixOf, gradeTwin, sameRep } from "./imsReconCore";

/**
 * Where a store sits across the two systems — the Rep Router and the client's
 * IMS database — and what is missing from it.
 *
 * Deliberately about PRESENCE and COMPLETENESS, not trading. Whether an outlet
 * is currently buying is a separate axis and lives in the flags, because a store
 * can be perfectly matched and still not have sold anything, and collapsing the
 * two into one column makes both unreadable.
 */

export type MapStatus =
  /** In both systems, and the app's own record is complete. */
  | "matched"
  /** In both systems, but the app is missing channel, province or coordinates. */
  | "matched_gaps"
  /** In the app only. IMS has never heard of this code. */
  | "rr_only"
  /** In IMS only. No store in the router, so no rep is calling on it. */
  | "ims_only"
  /** In IMS only, and IMS does not name a rep either. Nobody owns it at all. */
  | "ims_only_no_rep";

export const MAP_STATUS_LABEL: Record<MapStatus, string> = {
  matched: "Matched",
  matched_gaps: "Matched, missing data",
  rr_only: "In RR only",
  ims_only: "In IMS only",
  ims_only_no_rep: "In IMS, no rep",
};

export const MAP_STATUS_HINT: Record<MapStatus, string> = {
  matched: "In the router and in IMS, with channel, province and coordinates all present.",
  matched_gaps: "In both systems, but this app is missing channel, province or GPS. IMS usually holds the first two.",
  rr_only: "A rep is routed to this store but IMS has no record of the code at all.",
  ims_only: "Clippa invoices this outlet but no store in the router matches it, so no rep is scheduled to visit.",
  ims_only_no_rep: "Invoiced by Clippa, absent from the router, and IMS names no rep either.",
};

/** Facts that can be true alongside any status. A row may carry several. */
export interface MapFlags {
  /** In IMS, but nothing invoiced in the twelve-month window. */
  noSales: boolean;
  /** Sold six to twelve months ago, then went quiet. */
  dormant: boolean;
  /** Not selling, but a same-suffix account IS — likely the same shop, billed elsewhere. */
  duplicateAccount: boolean;
  /** IMS names a different rep, the CMR spelling of the same person excluded. */
  repMismatch: boolean;
  /** IMS has this outlet flagged closed. */
  closedInIms: boolean;
}

export const FLAG_LABEL: Record<keyof MapFlags, string> = {
  noSales: "No sales",
  dormant: "Dormant",
  duplicateAccount: "Duplicate account",
  repMismatch: "Rep mismatch",
  closedInIms: "Closed in IMS",
};

export interface MapRow {
  placeId: string;
  status: MapStatus;
  flags: MapFlags;
  /** What IMS holds, so the page can offer it where the app's own field is blank. */
  imsName: string | null;
  imsProvince: string | null;
  imsChannel: string | null;
  imsRepCode: string | null;
  sixMonthSales: number | null;
  /** The account code the sales appear to be going to instead, when there is one. */
  twinCode: string | null;
}

const blank = (v: unknown) => !String(v ?? "").trim();

/**
 * Is the app's own record incomplete?
 *
 * GPS counts as one field: a latitude without a longitude is no more usable than
 * neither, and the pair always moves together everywhere else in this app.
 */
export function hasGaps(store: Store): boolean {
  return blank(store.channelId) || blank(store.province) || blank(store.gpsLat) || blank(store.gpsLng);
}

/** Which specific fields are missing, for explaining the status in a tooltip. */
export function gapList(store: Store): string[] {
  const gaps: string[] = [];
  if (blank(store.channelId)) gaps.push("channel");
  if (blank(store.province)) gaps.push("province");
  if (blank(store.gpsLat) || blank(store.gpsLng)) gaps.push("GPS");
  return gaps;
}

export interface MapInputs {
  stores: Store[];
  /** Place ID to six-month value. */
  sales: Map<string, number>;
  /** Place IDs with any sale inside twelve months. */
  sales12: Set<string>;
  master: Map<string, ImsStore>;
}

export interface StoreMap {
  /** One row per store in the router, keyed by Place ID. */
  rows: Record<string, MapRow>;
  /** Outlets IMS invoices that have no store in the router at all. */
  ghosts: MapRow[];
}

function isClosed(m: ImsStore | undefined): boolean {
  return !!m && String(m["Closed Status"]).trim().toLowerCase() === "true";
}

export function buildStoreMap({ stores, sales, sales12, master }: MapInputs): StoreMap {
  // Selling codes indexed by suffix, so a silent store can be shown the account
  // its sales appear to be going to instead.
  const sellingBySuffix = new Map<string, string[]>();
  for (const code of sales.keys()) {
    const suf = suffixOf(code);
    if (!suf) continue;
    const list = sellingBySuffix.get(suf);
    if (list) list.push(code);
    else sellingBySuffix.set(suf, [code]);
  }

  const appIds = new Set(stores.map((s) => norm(s.placeId || s.id)));
  const rows: Record<string, MapRow> = {};

  for (const store of stores) {
    const code = norm(store.placeId || store.id);
    const m = master.get(code);
    const value = sales.get(code);

    const status: MapStatus = !m ? "rr_only" : hasGaps(store) ? "matched_gaps" : "matched";

    let twinCode: string | null = null;
    if (value === undefined) {
      const suf = suffixOf(code);
      const candidates = suf ? (sellingBySuffix.get(suf) ?? []).filter((c) => c !== code) : [];
      if (suf && candidates.length) {
        const best = candidates.reduce((a, b) => ((sales.get(b) ?? 0) > (sales.get(a) ?? 0) ? b : a));
        // STRONG only. The Reconciliation page can show a weak match beside a
        // confidence chip; this is a bare flag with nowhere to express doubt, so
        // anything less than a distinctive suffix would assert more than is known.
        // A short numeric suffix like "01" collides by accident.
        if (gradeTwin(suf, candidates.length) === "strong") twinCode = best;
      }
    }

    rows[code] = {
      placeId: store.placeId || store.id,
      status,
      flags: {
        noSales: !!m && value === undefined && !sales12.has(code),
        dormant: value === undefined && sales12.has(code),
        duplicateAccount: value === undefined && twinCode !== null,
        repMismatch: !!m && !sameRep(store.repCode, m["Rep Code"]),
        closedInIms: isClosed(m),
      },
      imsName: m?.["Store Name"] ?? null,
      imsProvince: m?.Province ?? null,
      imsChannel: m?.["Store Channel"] ?? null,
      imsRepCode: m?.["Rep Code"] ?? null,
      sixMonthSales: value ?? null,
      twinCode,
    };
  }

  // The other direction: outlets IMS invoices that nobody is routed to.
  const ghosts: MapRow[] = [];
  for (const [code, value] of sales) {
    if (appIds.has(code)) continue;
    const m = master.get(code);
    const imsRep = m?.["Rep Code"] ?? null;
    ghosts.push({
      placeId: code,
      status: blank(imsRep) ? "ims_only_no_rep" : "ims_only",
      flags: {
        noSales: false,
        dormant: false,
        duplicateAccount: false,
        // Nothing in the router claims it, so there is no disagreement to report.
        repMismatch: false,
        closedInIms: isClosed(m),
      },
      imsName: m?.["Store Name"] ?? null,
      imsProvince: m?.Province ?? null,
      imsChannel: m?.["Store Channel"] ?? null,
      imsRepCode: imsRep,
      sixMonthSales: value,
      twinCode: null,
    });
  }
  ghosts.sort((a, b) => (b.sixMonthSales ?? 0) - (a.sixMonthSales ?? 0));

  return { rows, ghosts };
}

/**
 * What a backfill from IMS would write.
 *
 * ⚠️ Only ever fills a BLANK field. A value the app already holds is never
 * overwritten, because the router's own channel mapping is what routes and
 * capacity are built on and IMS's channel vocabulary is not the same one.
 */
export interface BackfillChange {
  placeId: string;
  name: string;
  channel?: string;
  province?: string;
}

export function planBackfill(
  stores: Store[],
  master: Map<string, ImsStore>,
  channelIdFor: (imsChannelName: string) => string | null
): { changes: BackfillChange[]; channelCount: number; provinceCount: number; unmappedChannels: Map<string, number> } {
  const changes: BackfillChange[] = [];
  const unmappedChannels = new Map<string, number>();
  let channelCount = 0;
  let provinceCount = 0;

  for (const store of stores) {
    const m = master.get(norm(store.placeId || store.id));
    if (!m) continue;

    const change: BackfillChange = { placeId: store.placeId || store.id, name: store.name };
    let touched = false;

    if (blank(store.channelId) && !blank(m["Store Channel"])) {
      const mapped = channelIdFor(m["Store Channel"]);
      if (mapped) {
        change.channel = mapped;
        channelCount++;
        touched = true;
      } else {
        // Reported rather than silently skipped: an IMS channel with no match in
        // this app is a channel somebody needs to create before it can be filled.
        const key = m["Store Channel"].trim();
        unmappedChannels.set(key, (unmappedChannels.get(key) ?? 0) + 1);
      }
    }

    if (blank(store.province) && !blank(m.Province)) {
      change.province = m.Province.trim();
      provinceCount++;
      touched = true;
    }

    if (touched) changes.push(change);
  }

  return { changes, channelCount, provinceCount, unmappedChannels };
}
