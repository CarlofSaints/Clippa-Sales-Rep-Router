"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AllocationSourceCard from "@/components/AllocationSourceCard";
import ClosedStoresCard from "@/components/ClosedStoresCard";
import * as XLSX from "xlsx";
import { useTableSort, useSortedRows, SortableTh, type TableSort } from "@/components/TableSort";
import { compareCells } from "@/lib/tableSort";
import type { ReconResult, ReconRow, OrphanRow, MatchStatus } from "@/lib/imsReconCore";

/**
 * IMS Reconciliation.
 *
 * Answers, per store, whether the client's invoicing system has ever seen it —
 * and when it has not, offers the account code the sales appear to be going to
 * instead.
 */

type Tab = "all" | MatchStatus | "orphans";

const STATUS_LABEL: Record<MatchStatus, string> = {
  selling: "Selling",
  dormant: "Dormant",
  dark: "No sales",
  absent: "Not in IMS",
};

/**
 * Every status is judged against the SAME six-month window. What separates
 * dormant from no-sales is only what a twelve-month window finds: a dormant
 * store did trade, just not recently, so it has a rep who knows it and a reason
 * to be called on. A no-sales store has not bought in a year.
 */
const STATUS_HINT: Record<MatchStatus, string> = {
  selling: "Has sales inside the six-month window.",
  dormant: "Nothing in six months, but it did buy in the twelve-month window. It went quiet rather than never trading.",
  dark: "In the IMS outlet master, but no sales in twelve months.",
  absent: "IMS has never heard of this code. It is not in the outlet master at all.",
};

const STATUS_STYLE: Record<MatchStatus, string> = {
  selling: "bg-green-100 text-green-800",
  dormant: "bg-amber-100 text-amber-800",
  dark: "bg-red-100 text-red-800",
  absent: "bg-gray-200 text-gray-700",
};

const CONFIDENCE_STYLE: Record<string, string> = {
  strong: "bg-green-100 text-green-800",
  weak: "bg-amber-100 text-amber-800",
  ambiguous: "bg-gray-200 text-gray-600",
};

const rand = (n: number | null | undefined) =>
  n === null || n === undefined ? "" : "R " + Math.round(n).toLocaleString("en-ZA");

/**
 * Status sorts by what it MEANS, not alphabetically.
 *
 * Alphabetical would run absent, dark, dormant, selling — which reads as random
 * to anyone looking at the column. This orders it by how healthy the store is.
 */
const STATUS_RANK: Record<MatchStatus, number> = { selling: 0, dormant: 1, dark: 2, absent: 3 };

/** What each sortable column compares on. Null means "no value", never zero. */
const STORE_SORT: Record<string, (r: ReconRow) => string | number | null> = {
  placeId: (r) => r.placeId,
  name: (r) => r.name,
  imsName: (r) => r.imsName,
  repCode: (r) => r.repCode,
  status: (r) => STATUS_RANK[r.status],
  sixMonthSales: (r) => r.sixMonthSales,
  twin: (r) => r.twin?.code ?? null,
};

const ORPHAN_SORT: Record<string, (r: OrphanRow) => string | number | null> = {
  placeId: (r) => r.placeId,
  imsName: (r) => r.imsName,
  imsProvince: (r) => r.imsProvince,
  imsChannel: (r) => r.imsChannel,
  imsRepCode: (r) => r.imsRepCode,
  sixMonthSales: (r) => r.sixMonthSales,
};

export default function ImsReconciliationPage() {
  const [data, setData] = useState<ReconResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<Record<string, unknown> | null>(null);
  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(null);
  /** When the cached reconciliation was built, and whether this view came from it. */
  const [meta, setMeta] = useState<{ cached: boolean; fetchedAt: string | null } | null>(null);
  const [needsBuild, setNeedsBuild] = useState(false);
  /** Bumped after a snapshot rebuild so the allocation card re-reads its plan. */
  const [snapshotEpoch, setSnapshotEpoch] = useState(0);
  const [snapshotting, setSnapshotting] = useState(false);
  const [backfill, setBackfill] = useState<Record<string, unknown> | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  // Biggest sales first, which is what the API already returns.
  const sort = useTableSort("sixMonthSales", "desc", ["sixMonthSales"]);
  const sortProps = sort;

  const load = useCallback(async (live = false) => {
    setLoading(true);
    setError(null);
    setNeedsBuild(false);
    try {
      // Reads the CACHED reconciliation and touches no SQL, so opening this
      // page is now a blob read rather than a ten megabyte query. Only the live
      // path below can hit the sixty second function limit, and it is never
      // reached unless somebody asks for it.
      // A cached read is a blob fetch and should fail fast if something is
      // wrong. The live pull is allowed the function's full budget, because
      // giving up at 58 seconds on a query that takes 94 guaranteed a failure
      // that was never the server's fault.
      const res = await fetch(`/api/ims/reconcile${live ? "?live=1" : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(live ? 295000 : 30000),
      });
      if (!res.ok) {
        // A timed-out function returns an HTML error page, so parsing it as
        // JSON throws and the real cause is lost. Read the status first.
        let detail = "";
        try {
          detail = (await res.json())?.error ?? "";
        } catch {
          detail =
            res.status === 504
              ? "The request passed the function time limit. The IMS outlet master is roughly ten megabytes and slows down when that server is busy. Try again in a minute."
              : `The server returned HTTP ${res.status}.`;
        }
        setError(detail || "Could not load the reconciliation.");
      } else {
        const body = await res.json();
        if (body?.needsBuild) {
          // Nothing cached yet. Not an error: it is a first run, and the fix is
          // the button right there on the page.
          setNeedsBuild(true);
          setData(null);
          setMeta(null);
        } else {
          setData(body);
          setMeta({ cached: !!body.cached, fetchedAt: body.fetchedAt ?? null });
        }
      }
    } catch (e) {
      setError(
        e instanceof DOMException && e.name === "TimeoutError"
          ? (live
              ? "The live pull ran past five minutes. That reads the whole IMS outlet master and is slow when that server is busy. The cached reconciliation is unaffected: reload the page to go back to it."
              : "The cached reconciliation did not come back within thirty seconds, which is unusual because it is only a file read. Try again.")
          : String(e)
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runApply = async (mode: "preview" | "apply") => {
    setApplying(true);
    setApplyResult(null);
    try {
      const res = await fetch(`/api/ims/apply-sales?mode=${mode}`, { method: "POST" });
      setApplyResult(await res.json());
      if (mode === "apply") await load();
    } catch (e) {
      setApplyResult({ error: String(e) });
    } finally {
      setApplying(false);
    }
  };

  // Filter, THEN sort, THEN the table caps the display at 500. Sorting after the
  // cap would only ever order the first 500 rows and quietly hide the real top.
  const refreshSnapshot = async () => {
    setSnapshotting(true);
    setSnapshot(null);
    try {
      const res = await fetch("/api/ims/snapshot", { method: "POST" });
      const body = await res.json();
      setSnapshot(body);
      // The rebuild wrote a fresh reconciliation AND a fresh map, so pick both
      // up rather than leaving the page showing figures the button just
      // superseded. The allocation card reads the map, not the reconciliation,
      // so it needs telling separately.
      if (body?.built) {
        setSnapshotEpoch((n) => n + 1);
        await load();
      }
    } catch (e) {
      setSnapshot({ error: String(e) });
    } finally {
      setSnapshotting(false);
    }
  };

  const runBackfill = async (mode: "preview" | "apply") => {
    setBackfilling(true);
    setBackfill(null);
    try {
      const res = await fetch(`/api/ims/backfill?mode=${mode}`, { method: "POST" });
      setBackfill(await res.json());
    } catch (e) {
      setBackfill({ error: String(e) });
    } finally {
      setBackfilling(false);
    }
  };

  const rows = useMemo(() => {
    // Guarded on the arrays, not just on `data`. A body that is truthy but not
    // shaped like a reconciliation used to take this straight to .filter() on
    // undefined and blow up the whole page rather than showing an empty table.
    if (!data || !Array.isArray(data.rows) || !Array.isArray(data.orphans)) return [];
    const q = search.trim().toUpperCase();
    const match = (t: string | null) => !!t && t.toUpperCase().includes(q);

    if (tab === "orphans") {
      const get = ORPHAN_SORT[sort.sortKey] ?? ORPHAN_SORT.sixMonthSales;
      return data.orphans
        .filter((o) => !q || match(o.placeId) || match(o.imsName) || match(o.imsRepCode) || match(o.imsProvince))
        .sort((a, b) => compareCells(get(a), get(b), sort.sortDir));
    }

    const get = STORE_SORT[sort.sortKey] ?? STORE_SORT.sixMonthSales;
    return data.rows
      .filter((r) => tab === "all" || r.status === tab)
      .filter((r) => !q || match(r.placeId) || match(r.name) || match(r.imsName) || match(r.repCode) || match(r.twin?.code ?? null))
      .sort((a, b) => compareCells(get(a), get(b), sort.sortDir));
  }, [data, tab, search, sort.sortKey, sort.sortDir]);

  const exportExcel = () => {
    if (!data) return;
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        data.rows.map((r) => ({
          "PLACE ID": r.placeId,
          "STORE NAME (ROUTER)": r.name,
          "STORE NAME (IMS)": r.imsName ?? "",
          STATUS: STATUS_LABEL[r.status],
          "6-MONTH SALES": r.sixMonthSales ?? "",
          "REP CODE (ROUTER)": r.repCode,
          "REP CODE (IMS)": r.imsRepCode ?? "",
          "IMS PROVINCE": r.imsProvince ?? "",
          "IMS CHANNEL": r.imsChannel ?? "",
          "CLOSED IN IMS": r.imsClosed === null ? "" : r.imsClosed ? "YES" : "NO",
          "LIKELY SAME STORE AS": r.twin?.code ?? "",
          "THAT CODE'S NAME": r.twin?.name ?? "",
          "THAT CODE'S SALES": r.twin?.sixMonthSales ?? "",
          CONFIDENCE: r.twin?.confidence ?? "",
          "SAME PROVINCE": r.twin ? (r.twin.sameProvince ? "YES" : "NO") : "",
          "TWIN ALSO IN ROUTER": r.twin ? (r.twin.twinIsInRouter ? "YES" : "NO") : "",
        }))
      ),
      "Stores"
    );

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        data.orphans.map((o) => ({
          "PLACE ID": o.placeId,
          "STORE NAME (IMS)": o.imsName ?? "",
          "6-MONTH SALES": o.sixMonthSales,
          "REP CODE (IMS)": o.imsRepCode ?? "",
          "IMS PROVINCE": o.imsProvince ?? "",
          "IMS CHANNEL": o.imsChannel ?? "",
          "CLOSED IN IMS": o.imsClosed === null ? "" : o.imsClosed ? "YES" : "NO",
        }))
      ),
      "Selling but not routed"
    );

    const s = data.summary;
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        { MEASURE: "Stores in the router", VALUE: s.appStores },
        { MEASURE: "Selling (has 6-month sales)", VALUE: s.selling },
        { MEASURE: "Dormant (sold 6 to 12 months ago)", VALUE: s.dormant },
        { MEASURE: "No sales in 12 months", VALUE: s.dark },
        { MEASURE: "Not in the IMS outlet master at all", VALUE: s.absent },
        { MEASURE: "IMS codes with sales", VALUE: s.imsSalesCodes },
        { MEASURE: "IMS codes selling but not routed", VALUE: s.orphanCount },
        { MEASURE: "Total 6-month IMS value", VALUE: Math.round(s.totalValue) },
        { MEASURE: "Value reaching a routed store", VALUE: Math.round(s.matchedValue) },
        { MEASURE: "Value reaching no routed store", VALUE: Math.round(s.strandedValue) },
        { MEASURE: "Likely duplicate accounts (strong)", VALUE: s.twinStrong },
        { MEASURE: "Likely duplicate accounts (weak)", VALUE: s.twinWeak },
        { MEASURE: "Possible duplicates (ambiguous)", VALUE: s.twinAmbiguous },
      ]),
      "Summary"
    );

    XLSX.writeFile(wb, "IMS reconciliation.xlsx");
  };

  const s = data?.summary;

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">IMS Reconciliation</h1>
          <p className="mt-1 text-sm text-gray-500">
            Every store in the router against the client&apos;s invoicing system, and where the sales went
            when a store has none of its own.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => load()}
            disabled={loading}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? "Loading..." : "Reload"}
          </button>
          <button
            onClick={() => load(true)}
            disabled={loading}
            title="Rarely what you want. Ignores the cache and queries IMS directly, which takes minutes. To refresh the figures, use Refresh snapshot lower down instead."
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Run live
          </button>
          <button
            onClick={exportExcel}
            disabled={!data}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Export Excel
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
          {/* Only shown when it can actually be the explanation. This hint used
              to print under every error, including timeouts, and sent the reader
              to look at a proxy that was working fine. */}
          {error.includes("Unknown query") && (
            <p className="mt-1 text-xs text-red-700">
              A 400 naming an unknown query means Railway has not picked up the proxy change yet.
            </p>
          )}
        </div>
      )}

      {needsBuild && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          No reconciliation has been cached yet. Press <strong>Refresh snapshot</strong> below to build it.
          Twenty seconds or so when IMS is responsive, a couple of minutes when that server is busy, and it
          is the only thing on this page that queries IMS directly.
        </div>
      )}

      {meta && (
        <p className="text-xs text-gray-500">
          {meta.cached ? "Cached reconciliation" : "Live from IMS"}
          {meta.fetchedAt && <> · built {new Date(meta.fetchedAt).toLocaleString("en-ZA")}</>}
          {meta.cached && <> · rebuild it with <strong>Refresh snapshot</strong></>}
        </p>
      )}

      {/* OUTSIDE the `{s && ...}` gate on purpose. These two are admin actions,
          not readings of the reconciliation, and Refresh snapshot is the button
          that BUILDS the reconciliation. Gating it on there being a result hid it
          exactly when it was needed: a fresh install showed "press Refresh
          snapshot below" above a page with no such button on it. */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">IMS snapshot for the Stores page</h2>
          <p className="mt-1 text-xs text-gray-500">
            Builds both caches on this page: the Map Status column on the Stores page AND the
            reconciliation above. Both come out of the same three SQL queries, so they cost the same
            twenty seconds together as either did alone. This is the only button here that touches IMS.
          </p>
          <button
            onClick={refreshSnapshot}
            disabled={snapshotting}
            className="mt-3 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {snapshotting ? "Building..." : "Refresh snapshot"}
          </button>
          {snapshot && (
            <p className={`mt-3 rounded-lg p-3 text-xs ${snapshot.error ? "bg-red-50 text-red-800" : "bg-green-50 text-green-900"}`}>
              {snapshot.error
                ? String(snapshot.error)
                : `Rebuilt. ${(snapshot.totals as { appStores: number })?.appStores?.toLocaleString("en-ZA")} stores mapped, ${(snapshot.totals as { ghosts: number })?.ghosts?.toLocaleString("en-ZA")} IMS-only outlets, and the reconciliation above refreshed with them.`}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">Fill blank channel and province from IMS</h2>
          <p className="mt-1 text-xs text-gray-500">
            Only fills a field that is <strong>blank</strong>. A channel the app already holds is never
            replaced, because routes and call frequencies are built on it. Channels are matched by name,
            never created.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => runBackfill("preview")}
              disabled={backfilling}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {backfilling ? "Working..." : "Preview"}
            </button>
            <button
              onClick={() => runBackfill("apply")}
              disabled={backfilling || !backfill || !!backfill.error || backfill.applied === true}
              className="rounded-lg bg-clippa-red px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              title={!backfill ? "Preview first" : ""}
            >
              Apply
            </button>
          </div>
          {backfill && <BackfillReport result={backfill} />}
        </div>
        <ClosedStoresCard onApplied={() => setSnapshotEpoch((n) => n + 1)} />
      </div>

      {/* Reads the cached snapshot, not live SQL, so it stays usable when the
          reconciliation below has never been built. */}
      <AllocationSourceCard refreshKey={snapshotEpoch} />

      {s && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Selling" value={s.selling} sub={`${pctOf(s.selling, s.appStores)} of the router`} tone="green" />
            <Tile label="Dormant" value={s.dormant} sub="sold 6 to 12 months ago" tone="amber" />
            <Tile label="No sales in 12 months" value={s.dark} sub="in IMS, never invoiced" tone="red" />
            <Tile label="Not in IMS at all" value={s.absent} sub="code unknown to IMS" tone="gray" />
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">
              {rand(s.strandedValue)} of {rand(s.totalValue)} in six-month sales reaches no store in the
              router ({pctOf(s.strandedValue, s.totalValue)}).
            </p>
            <p className="mt-1 text-xs text-amber-800">
              {s.orphanCount.toLocaleString("en-ZA")} IMS codes are being invoiced with no rep routed to
              them. They are on the <strong>Selling, not routed</strong> tab.{" "}
              {s.orphanWholesaleCount > 0 && (
                <>
                  Of those, {s.orphanWholesaleCount.toLocaleString("en-ZA")} carrying{" "}
                  {rand(s.orphanWholesaleValue)} look like depots, DCs or head offices rather than shops, so
                  no rep was ever going to visit them. That leaves roughly{" "}
                  <strong>{rand(s.strandedValue - s.orphanWholesaleValue)}</strong> sitting in outlets that
                  plausibly should be on somebody&apos;s route.
                </>
              )}
            </p>
            {s.repMismatchCount > 0 && (
              <p className="mt-2 text-xs text-amber-800">
                On <strong>{s.repMismatchCount.toLocaleString("en-ZA")}</strong> stores IMS names a different
                rep than the router does. Those rows carry an amber{" "}
                <span className="rounded bg-amber-100 px-1">IMS:</span> badge in the Rep column, and both
                codes are in the Excel export. IMS&apos;s parallel{" "}
                <span className="font-mono">CODE + CMR</span> spelling of the same person is not counted as a
                disagreement.
              </p>
            )}
            <p className="mt-2 text-xs text-amber-800">
              <strong>{s.twinStrong.toLocaleString("en-ZA")}</strong> stores with no sales have a strong
              duplicate-account match, {s.twinWeak.toLocaleString("en-ZA")} a weak one and{" "}
              {s.twinAmbiguous.toLocaleString("en-ZA")} an ambiguous one. A Place ID is{" "}
              <span className="font-mono">ACCOUNT-STORE</span>: the part after the hyphen identifies the
              shop, the part before it identifies who invoices it. The same shop bought through a different
              wholesaler gets a different code, and looks dead here.
            </p>
          </div>

          <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900">Write the six-month sales onto the stores</h2>
            <p className="mt-1 text-xs text-gray-500">
              Sets <span className="font-mono">6-Month Sales</span> and recalculates{" "}
              <span className="font-mono">Avg Monthly Sales</span> as a sixth of it. A store with no IMS
              figure is left exactly as it is, never zeroed.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => runApply("preview")}
                disabled={applying}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {applying ? "Working..." : "Preview"}
              </button>
              <button
                onClick={() => runApply("apply")}
                disabled={applying || !applyResult || !!applyResult.error || applyResult.applied === true}
                className="rounded-lg bg-clippa-red px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                title={!applyResult ? "Preview first" : ""}
              >
                Apply to stores
              </button>
            </div>
            {applyResult && <ApplyReport result={applyResult} />}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(["all", "selling", "dormant", "dark", "absent", "orphans"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                title={t === "all" ? "Every store in the router" : t === "orphans" ? "IMS codes with sales that no rep is routed to" : STATUS_HINT[t as MatchStatus]}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab === t ? "border-clippa-red bg-clippa-red text-white" : "border-gray-300 text-gray-700 hover:bg-gray-50"
                }`}
              >
                {t === "all"
                  ? `All (${s.appStores.toLocaleString("en-ZA")})`
                  : t === "orphans"
                  ? `Selling, not routed (${s.orphanCount.toLocaleString("en-ZA")})`
                  : `${STATUS_LABEL[t as MatchStatus]} (${(s[t as MatchStatus] as number).toLocaleString("en-ZA")})`}
              </button>
            ))}
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search place id, store name or rep"
              className="ml-auto w-64 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red"
            />
          </div>

          <p className="-mt-1 text-xs text-gray-500">
            All four are judged on the same six-month window.{" "}
            <strong>Dormant</strong> means nothing in six months but it did buy within twelve, so it went
            quiet. <strong>No sales</strong> means nothing in twelve months at all.{" "}
            <strong>Not in IMS</strong> means the code is not in the outlet master, so IMS has never heard of
            it. Click any column heading to sort.
          </p>

          <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white shadow-sm">
            <p className="border-b border-gray-100 px-4 py-2 text-xs text-gray-500">
              Showing {rows.length.toLocaleString("en-ZA")} rows
              {rows.length > 500 ? " (first 500; export for the full list)" : ""}
            </p>
            {tab === "orphans" ? (
              <OrphanTable rows={rows as OrphanRow[]} sort={sortProps} />
            ) : (
              <StoreTable rows={rows as ReconRow[]} sort={sortProps} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function pctOf(a: number, b: number) {
  return b ? `${Math.round((a / b) * 1000) / 10}%` : "0%";
}

function Tile({ label, value, sub, tone }: { label: string; value: number; sub: string; tone: string }) {
  const tones: Record<string, string> = {
    green: "border-green-200 bg-green-50 text-green-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-red-200 bg-red-50 text-red-900",
    gray: "border-gray-200 bg-gray-50 text-gray-900",
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <p className="text-xs font-medium opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value.toLocaleString("en-ZA")}</p>
      <p className="mt-0.5 text-xs opacity-70">{sub}</p>
    </div>
  );
}

function StoreTable({ rows, sort }: { rows: ReconRow[]; sort: TableSort }) {
  return (
    <table className="min-w-full text-sm">
      <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
        <tr>
          <SortableTh sortId="placeId" sort={sort}>Place ID</SortableTh>
          <SortableTh sortId="name" sort={sort}>Store (router)</SortableTh>
          <SortableTh sortId="imsName" sort={sort}>Store (IMS)</SortableTh>
          <SortableTh sortId="repCode" sort={sort}>Rep</SortableTh>
          <SortableTh sortId="status" sort={sort}>Status</SortableTh>
          <SortableTh sortId="sixMonthSales" sort={sort} align="right">6-month sales</SortableTh>
          <SortableTh sortId="twin" sort={sort}>Likely same store as</SortableTh>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {rows.slice(0, 500).map((r) => (
          <tr key={r.placeId} className="hover:bg-gray-50">
            <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{r.placeId}</td>
            <td className="px-4 py-2">{r.name}</td>
            <td className="px-4 py-2 text-gray-500">
              {r.imsName ?? <span className="italic text-gray-400">not in IMS</span>}
            </td>
            <td className="whitespace-nowrap px-4 py-2 text-xs">
              {r.repCode}
              {r.repMismatch && (
                <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800" title="IMS thinks a different rep owns this store">
                  IMS: {r.imsRepCode}
                </span>
              )}
            </td>
            <td className="whitespace-nowrap px-4 py-2">
              <span
                title={STATUS_HINT[r.status]}
                className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status]}`}
              >
                {STATUS_LABEL[r.status]}
              </span>
              {r.imsClosed && (
                <span className="ml-1 rounded bg-gray-200 px-1 text-xs text-gray-700">closed</span>
              )}
            </td>
            <td className="whitespace-nowrap px-4 py-2 text-right font-medium">{rand(r.sixMonthSales)}</td>
            <td className="whitespace-nowrap px-4 py-2 text-xs">
              {r.twin ? (
                <span title={`${r.twin.candidates} selling code(s) share this suffix`}>
                  <span className="font-mono">{r.twin.code}</span>{" "}
                  <span className={`rounded px-1 ${CONFIDENCE_STYLE[r.twin.confidence]}`}>{r.twin.confidence}</span>{" "}
                  <span className="text-gray-500">{rand(r.twin.sixMonthSales)}</span>
                  {r.twin.twinIsInRouter && <span className="ml-1 text-gray-400">(also routed)</span>}
                </span>
              ) : (
                ""
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OrphanTable({ rows, sort }: { rows: OrphanRow[]; sort: TableSort }) {
  return (
    <table className="min-w-full text-sm">
      <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
        <tr>
          <SortableTh sortId="placeId" sort={sort}>Place ID</SortableTh>
          <SortableTh sortId="imsName" sort={sort}>Store (IMS)</SortableTh>
          <SortableTh sortId="imsProvince" sort={sort}>Province</SortableTh>
          <SortableTh sortId="imsChannel" sort={sort}>Channel</SortableTh>
          <SortableTh sortId="imsRepCode" sort={sort}>Rep (IMS)</SortableTh>
          <SortableTh sortId="sixMonthSales" sort={sort} align="right">6-month sales</SortableTh>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {rows.slice(0, 500).map((o) => (
          <tr key={o.placeId} className="hover:bg-gray-50">
            <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{o.placeId}</td>
            <td className="px-4 py-2">
              {o.imsName ?? <span className="italic text-gray-400">no master record</span>}
              {o.imsClosed && <span className="ml-1 rounded bg-gray-200 px-1 text-xs text-gray-700">closed</span>}
            </td>
            <td className="px-4 py-2 text-gray-500">{o.imsProvince ?? ""}</td>
            <td className="px-4 py-2 text-gray-500">{o.imsChannel ?? ""}</td>
            <td className="whitespace-nowrap px-4 py-2 text-xs">{o.imsRepCode ?? ""}</td>
            <td className="whitespace-nowrap px-4 py-2 text-right font-medium">{rand(o.sixMonthSales)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BackfillReport({ result }: { result: Record<string, unknown> }) {
  if (result.error) {
    return <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{String(result.error)}</p>;
  }
  const n = (k: string) => Number(result[k] ?? 0).toLocaleString("en-ZA");
  const unmapped = (result.unmappedChannels ?? []) as { name: string; count: number }[];
  return (
    <div className={`mt-3 rounded-lg p-3 text-xs ${result.applied ? "bg-green-50 text-green-900" : "bg-gray-50 text-gray-700"}`}>
      <p className="font-medium">
        {result.applied ? "Applied." : "Preview only, nothing written."} {n("storesTouched")} stores would
        change: {n("channelCount")} channels and {n("provinceCount")} provinces filled.
      </p>
      {unmapped.length > 0 && (
        <p className="mt-2">
          <strong>{unmapped.length}</strong> IMS channel{unmapped.length === 1 ? "" : "s"} have no match in
          this app, so those stores keep a blank channel. Create the channel here first if you want them
          filled: {unmapped.slice(0, 6).map((u) => `${u.name} (${u.count})`).join(", ")}
          {unmapped.length > 6 ? ", ..." : ""}
        </p>
      )}
    </div>
  );
}

function ApplyReport({ result }: { result: Record<string, unknown> }) {
  if (result.error) {
    return <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{String(result.error)}</p>;
  }
  const n = (k: string) => Number(result[k] ?? 0).toLocaleString("en-ZA");
  return (
    <div className={`mt-3 rounded-lg p-3 text-sm ${result.applied ? "bg-green-50 text-green-900" : "bg-gray-50 text-gray-700"}`}>
      <p className="font-medium">
        {result.applied ? "Applied." : "Preview only, nothing written."} {n("updated")} stores would change,{" "}
        {n("unchanged")} already match, {n("untouched")} have no IMS figure and were left alone.
      </p>
      <p className="mt-1 text-xs">
        {n("firstTimeValue")} are getting a sales figure for the first time. {n("overwritingExisting")} already
        had one and it will be replaced.
      </p>
      {Array.isArray(result.samples) && result.samples.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs">
          {(result.samples as Array<{ placeId: string; name: string; from: number | null; to: number }>).map((x) => (
            <li key={x.placeId} className="font-mono">
              {x.placeId} {x.name.slice(0, 28)} : {x.from === null ? "(none)" : rand(x.from)} to {rand(x.to)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
