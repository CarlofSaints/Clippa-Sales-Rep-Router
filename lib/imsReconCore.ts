import type { Store } from "./types";

/**
 * The reconciliation logic itself, with no I/O in it.
 *
 * Split from `imsRecon.ts` deliberately: the interesting part of this feature is
 * the classification and the duplicate-account detection, and neither can be
 * asserted if reaching them requires a live SQL proxy and the production blob.
 * Everything here is a pure function of its arguments.
 */

/** One row of the IMS outlet master (dbo.tblStores). */
export interface ImsStore {
  "Store Code": string;
  "Store Name": string;
  Province: string;
  "Store Channel": string;
  "Store Sub Channel": string;
  Group: string;
  "Store Category": string;
  "Rep Code": string;
  /** Free text "true"/"false" in SQL, not a bit. */
  "Closed Status": string;
}

export type MatchStatus =
  /** Has in-market sales inside the six-month window. */
  | "selling"
  /** No sales in six months, but sales in the twelve-month window. */
  | "dormant"
  /** In the IMS outlet master, but no sales in twelve months. */
  | "dark"
  /** Not in the IMS outlet master at all. IMS has never heard of this code. */
  | "absent";

/**
 * How much to believe a suggested twin.
 *
 * The evidence is that Place IDs are `PREFIX-SUFFIX`, the prefix identifies the
 * wholesaler or account the store is invoiced through, and the SUFFIX identifies
 * the physical store. So a dead `2214-GO38` and a selling `13175-GO38` are the
 * same shop billed through two different accounts.
 *
 * That claim was checked against something independent of the code itself: for
 * the `strong` tier, 97.7% of pairs sit in the same province in IMS. A rule that
 * only ever agreed with itself would be worth nothing.
 */
export type TwinConfidence = "strong" | "weak" | "ambiguous";

export interface TwinSuggestion {
  code: string;
  name: string;
  sixMonthSales: number;
  confidence: TwinConfidence;
  /** How many selling codes share this suffix. More than a few means guesswork. */
  candidates: number;
  sameProvince: boolean;
  /** True when the twin is itself a store in this app, so the sales are already visible somewhere. */
  twinIsInRouter: boolean;
}

export interface ReconRow {
  placeId: string;
  name: string;
  repCode: string;
  channelId: string;
  status: MatchStatus;
  sixMonthSales: number | null;
  imsName: string | null;
  imsProvince: string | null;
  imsChannel: string | null;
  imsRepCode: string | null;
  imsClosed: boolean | null;
  twin: TwinSuggestion | null;
}

/** An IMS code with sales that has no store in this app at all. */
export interface OrphanRow {
  placeId: string;
  sixMonthSales: number;
  imsName: string | null;
  imsProvince: string | null;
  imsChannel: string | null;
  imsRepCode: string | null;
  imsClosed: boolean | null;
  /**
   * Looks like a depot, DC, head office or wholesaler rather than a shop.
   *
   * It matters because the biggest unrouted accounts are DCs, and a rep is never
   * going to visit one. Without the flag this list opens on distribution centres
   * and reads as though the whole comparison is wrong. Keyword-based, so treat it
   * as a sort order rather than a fact.
   */
  looksWholesale: boolean;
}

/**
 * Names that mean "this is not a shop a rep calls on".
 *
 * Deliberately conservative: it drives a label and a count, never an exclusion,
 * so a false positive costs a mislabelled row and nothing else.
 */
const WHOLESALE_RE =
  /(DISTRIBUTION|DEPOT|WAREHOUSE|HEAD[\s-]?OFFICE|\bDC\b|WHOLESALE|CASH\s*(&|AND)\s*CARRY|BUYING|GROUP OFFICE)/;

export function looksWholesale(m: ImsStore | undefined): boolean {
  if (!m) return false;
  return (
    WHOLESALE_RE.test(norm(m["Store Name"])) ||
    WHOLESALE_RE.test(norm(m["Store Category"])) ||
    WHOLESALE_RE.test(norm(m.Group))
  );
}

export interface ReconSummary {
  appStores: number;
  imsSalesCodes: number;
  imsMasterCodes: number;
  selling: number;
  dormant: number;
  dark: number;
  absent: number;
  totalValue: number;
  matchedValue: number;
  strandedValue: number;
  orphanCount: number;
  /** Of the orphans, how many look like depots/DCs, and what they are worth. */
  orphanWholesaleCount: number;
  orphanWholesaleValue: number;
  twinStrong: number;
  twinWeak: number;
  twinAmbiguous: number;
  twinValue: number;
}

export interface ReconResult {
  summary: ReconSummary;
  rows: ReconRow[];
  orphans: OrphanRow[];
  monthsBack: number;
}

export const norm = (v: unknown) => String(v ?? "").trim().toUpperCase();

/** Suffix after the first hyphen — the part that appears to identify the physical store. */
export function suffixOf(code: string): string | null {
  const i = code.indexOf("-");
  if (i <= 0) return null;
  const suf = code.slice(i + 1);
  return suf.length ? suf : null;
}

/**
 * Grade a suffix match.
 *
 * A suffix carrying letters and at least three characters (`GO38`, `EF11`) is a
 * real identifier. A short all-numeric one (`01`, `002`) collides by accident —
 * those are still reported, but never as `strong`, because acting on them would
 * merge two genuinely different shops.
 */
export function gradeTwin(suffix: string, candidateCount: number): TwinConfidence {
  if (candidateCount > 3) return "ambiguous";
  const distinctive = /[A-Z]/.test(suffix) && suffix.length >= 3;
  return distinctive ? "strong" : "weak";
}

export function reconcile(
  stores: Store[],
  sales: Map<string, number>,
  sales12: Set<string>,
  master: Map<string, ImsStore>,
  monthsBack = 6
): ReconResult {
  const sellingBySuffix = new Map<string, string[]>();
  for (const code of sales.keys()) {
    const suf = suffixOf(code);
    if (!suf) continue;
    const list = sellingBySuffix.get(suf);
    if (list) list.push(code);
    else sellingBySuffix.set(suf, [code]);
  }

  const appIds = new Set(stores.map((s) => norm(s.placeId || s.id)));

  const closedOf = (m: ImsStore | undefined) =>
    m ? String(m["Closed Status"]).trim().toLowerCase() === "true" : null;

  const rows: ReconRow[] = [];
  const summary: ReconSummary = {
    appStores: stores.length,
    imsSalesCodes: sales.size,
    imsMasterCodes: master.size,
    selling: 0, dormant: 0, dark: 0, absent: 0,
    totalValue: 0, matchedValue: 0, strandedValue: 0,
    orphanCount: 0, orphanWholesaleCount: 0, orphanWholesaleValue: 0,
    twinStrong: 0, twinWeak: 0, twinAmbiguous: 0, twinValue: 0,
  };

  for (const s of stores) {
    const code = norm(s.placeId || s.id);
    const m = master.get(code);
    const value = sales.get(code);

    let status: MatchStatus;
    if (value !== undefined) status = "selling";
    else if (sales12.has(code)) status = "dormant";
    else if (m) status = "dark";
    else status = "absent";
    summary[status]++;

    if (value !== undefined) summary.matchedValue += value;

    // A twin is only meaningful for a store that is not selling.
    let twin: TwinSuggestion | null = null;
    if (status === "dark" || status === "dormant") {
      const suf = suffixOf(code);
      const candidates = suf ? (sellingBySuffix.get(suf) ?? []).filter((c) => c !== code) : [];
      if (suf && candidates.length) {
        const best = candidates.reduce((a, b) => ((sales.get(b) ?? 0) > (sales.get(a) ?? 0) ? b : a));
        const bestMaster = master.get(best);
        const confidence = gradeTwin(suf, candidates.length);
        twin = {
          code: best,
          name: bestMaster?.["Store Name"] ?? "",
          sixMonthSales: sales.get(best) ?? 0,
          confidence,
          candidates: candidates.length,
          sameProvince: !!m && !!bestMaster && norm(m.Province) === norm(bestMaster.Province),
          twinIsInRouter: appIds.has(best),
        };
        if (confidence === "strong") summary.twinStrong++;
        else if (confidence === "weak") summary.twinWeak++;
        else summary.twinAmbiguous++;
        summary.twinValue += twin.sixMonthSales;
      }
    }

    rows.push({
      placeId: s.placeId || s.id,
      name: s.name,
      repCode: s.repCode,
      channelId: s.channelId,
      status,
      sixMonthSales: value ?? null,
      imsName: m?.["Store Name"] ?? null,
      imsProvince: m?.Province ?? null,
      imsChannel: m?.["Store Channel"] ?? null,
      imsRepCode: m?.["Rep Code"] ?? null,
      imsClosed: closedOf(m),
      twin,
    });
  }

  // The other direction: IMS is invoicing these and no rep is routed to them.
  const orphans: OrphanRow[] = [];
  for (const [code, value] of sales) {
    summary.totalValue += value;
    if (appIds.has(code)) continue;
    const m = master.get(code);
    const wholesale = looksWholesale(m);
    if (wholesale) {
      summary.orphanWholesaleCount++;
      summary.orphanWholesaleValue += value;
    }
    orphans.push({
      placeId: code,
      sixMonthSales: value,
      imsName: m?.["Store Name"] ?? null,
      imsProvince: m?.Province ?? null,
      imsChannel: m?.["Store Channel"] ?? null,
      imsRepCode: m?.["Rep Code"] ?? null,
      imsClosed: closedOf(m),
      looksWholesale: wholesale,
    });
  }
  orphans.sort((a, b) => b.sixMonthSales - a.sixMonthSales);
  summary.orphanCount = orphans.length;
  summary.strandedValue = summary.totalValue - summary.matchedValue;

  rows.sort((a, b) => (b.sixMonthSales ?? -1) - (a.sixMonthSales ?? -1));

  return { summary, rows, orphans, monthsBack };
}

/**
 * Apply IMS sales onto the stores.
 *
 * ⚠️ A store with no IMS figure is LEFT ALONE, never zeroed. Absent means "never
 * supplied", and overwriting that with 0 is exactly the bug that made the Store
 * Upload path destroy `monthlySales` on every sheet that lacked the column.
 *
 * `monthlySales` is kept in step as the six-month average because seventeen
 * readers and the three rank columns depend on it.
 */
export function applySalesToStores(
  stores: Store[],
  sales: Map<string, number>
): { stores: Store[]; updated: number; unchanged: number; untouched: number } {
  let updated = 0;
  let unchanged = 0;
  let untouched = 0;

  const next = stores.map((s) => {
    const value = sales.get(norm(s.placeId || s.id));
    if (value === undefined) {
      untouched++;
      return s;
    }
    const average = Math.round((value / 6) * 100) / 100;
    if (s.sixMonthSales === value && s.monthlySales === average) {
      unchanged++;
      return s;
    }
    updated++;
    return { ...s, sixMonthSales: value, monthlySales: average };
  });

  return { stores: next, updated, unchanged, untouched };
}
