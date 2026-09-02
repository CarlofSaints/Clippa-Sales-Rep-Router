"use client";

import { useState, useEffect, useMemo } from "react";
import { FilterDropdown } from "@/components/FilterDropdown";
import { useTableSort, useSortedRows, SortableTh } from "@/components/TableSort";
import type { SortValue } from "@/lib/tableSort";
import type { RepActivityRow } from "@/lib/repActivity";
import { totalRepActivity } from "@/lib/repActivity";
import type { CommissionSettings } from "@/lib/commission";

const rand = (n: number) =>
  "R " + n.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const num = (n: number) => n.toLocaleString("en-ZA");

interface ApiResponse {
  rows: RepActivityRow[];
  commission: CommissionSettings;
  snapshotFetchedAt: string | null;
  hasSnapshot: boolean;
  callCycleTypes: { id: string; name: string; active: boolean }[];
  newCycle: { name: string; generatedAt: string; repCount: number } | null;
}

/** Money that may legitimately be absent, so a dash rather than R 0. */
function Money({ v, bold }: { v: number | null; bold?: boolean }) {
  if (v === null) return <span className="text-gray-300">&mdash;</span>;
  return <span className={bold ? "font-semibold text-gray-900" : ""}>{rand(v)}</span>;
}

/**
 * Above this, a book asks for more calls a day than a working day holds.
 *
 * Not a hard rule and not enforced anywhere: it only colours a number, so a
 * manager scanning the grid sees which books are arithmetically impossible
 * before they blame the routing. Ten is generous against a median of about
 * seven and a stated target of eight.
 */
const DAILY_CALL_WARNING = 10;

export default function RepActivityPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterTeams, setFilterTeams] = useState<Set<string>>(new Set());
  const [filterEarning, setFilterEarning] = useState<Set<string>>(new Set());
  const [filterCoverage, setFilterCoverage] = useState<Set<string>>(new Set());
  /** Which plan the new-cycle columns describe. Empty means none chosen. */
  const [typeId, setTypeId] = useState("");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/rep-activity${typeId ? `?typeId=${encodeURIComponent(typeId)}` : ""}`)
      .then((r) => (r.ok ? r.json() : r.json().then((d) => Promise.reject(d.error))))
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(typeof e === "string" ? e : "Could not load rep activity"))
      .finally(() => setLoading(false));
  }, [typeId]);

  const rows = useMemo(() => data?.rows ?? [], [data]);

  const teamOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (r.teamId) seen.set(r.teamId, r.teamName || r.teamId);
    return [
      { value: "__none__", label: "No Team" },
      ...Array.from(seen, ([value, label]) => ({ value, label })).sort((a, b) =>
        a.label.localeCompare(b.label)
      ),
    ];
  }, [rows]);

  const earningOptions = useMemo(() => {
    const q = rows.filter((r) => r.commission.qualifies).length;
    return [
      { value: "qualifies", label: `Earning commission (${q})` },
      { value: "below", label: `Below threshold (${rows.length - q})` },
    ];
  }, [rows]);

  // Coverage, not performance: these separate a rep with nothing to sell from a
  // rep whose stores this app cannot see the sales for.
  const coverageOptions = useMemo(() => {
    const noStores = rows.filter((r) => r.storesRepsly === 0).length;
    const imsOnly = rows.filter((r) => r.storesImsOnly > 0).length;
    const gaps = rows.filter((r) => r.storesWithoutSales > 0).length;
    return [
      { value: "no_stores", label: `No stores allocated (${noStores})` },
      { value: "ims_only", label: `Has unrouted IMS outlets (${imsOnly})` },
      { value: "sales_gaps", label: `Has stores with no IMS figure (${gaps})` },
    ];
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.repName.toLowerCase().includes(q) && !r.repCode.toLowerCase().includes(q)) return false;
      if (filterTeams.size > 0) {
        if (!r.teamId && !filterTeams.has("__none__")) return false;
        if (r.teamId && !filterTeams.has(r.teamId)) return false;
      }
      if (filterEarning.size > 0) {
        const k = r.commission.qualifies ? "qualifies" : "below";
        if (!filterEarning.has(k)) return false;
      }
      if (filterCoverage.size > 0) {
        const hits: string[] = [];
        if (r.storesRepsly === 0) hits.push("no_stores");
        if (r.storesImsOnly > 0) hits.push("ims_only");
        if (r.storesWithoutSales > 0) hits.push("sales_gaps");
        if (!hits.some((h) => filterCoverage.has(h))) return false;
      }
      return true;
    });
  }, [rows, search, filterTeams, filterEarning, filterCoverage]);

  const sort = useTableSort("portfolioMonthly", "desc", [
    "storesRepsly", "storesIms", "callsPerMonth", "callsPerWeek", "callsPerDay", "portfolioMonthly",
    "earning", "newCycleStores", "newCyclePortfolioMonthly", "newCycleEarning",
  ]);

  const sortAccessors = useMemo<Record<string, (r: RepActivityRow) => SortValue>>(
    () => ({
      repCode: (r) => r.repCode,
      repName: (r) => r.repName,
      teamName: (r) => r.teamName || null,
      storesRepsly: (r) => r.storesRepsly,
      storesIms: (r) => r.storesIms,
      callsPerMonth: (r) => r.callsPerMonth,
      callsPerWeek: (r) => r.callsPerWeek,
      callsPerDay: (r) => r.callsPerDay,
      portfolioMonthly: (r) => r.portfolioMonthly,
      earning: (r) => r.commission.earning,
      // Null sinks in both directions, so a rep with no plan never floats to the
      // top of a descending sort with a blank cell.
      newCycleStores: (r) => r.newCycleStores,
      newCyclePortfolioMonthly: (r) => r.newCyclePortfolioMonthly,
      newCycleEarning: (r) => r.newCycleCommission?.earning ?? null,
    }),
    []
  );

  const sorted = useSortedRows(filtered, sortAccessors, sort);
  const totals = useMemo(() => totalRepActivity(filtered), [filtered]);

  const hasFilters =
    !!search || filterTeams.size > 0 || filterEarning.size > 0 || filterCoverage.size > 0;
  const clearAll = () => {
    setSearch("");
    setFilterTeams(new Set());
    setFilterEarning(new Set());
    setFilterCoverage(new Set());
  };

  const showNewCycle = !!data?.newCycle;

  return (
    <div className="p-6">
      <div className="flex items-baseline gap-3 flex-wrap mb-1">
        <h1 className="text-xl font-bold text-gray-900">Rep Sales &amp; Activity</h1>
        {data && (
          <span className="text-xs text-gray-400">
            {data.commission.ratePercent}% over {rand(data.commission.thresholdMonthly)} a month
            {data.commission.basis === "excess" ? ", on the excess" : ", on the full portfolio"}
            {" · "}
            <a href="/admin/commission" className="text-clippa-red hover:underline">change</a>
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-4">
        What each rep carries, what it bills, and what it pays. Store counts come from three
        different systems and are not meant to agree.
      </p>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search rep name or code..."
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-1 focus:ring-clippa-red"
        />
        <FilterDropdown label="Team" options={teamOptions} selected={filterTeams} onChange={setFilterTeams} />
        <FilterDropdown label="Commission" options={earningOptions} selected={filterEarning} onChange={setFilterEarning} />
        <FilterDropdown label="Coverage" options={coverageOptions} selected={filterCoverage} onChange={setFilterCoverage} />

        <select
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700"
          title="The plan the New Cycle columns describe"
        >
          <option value="">New cycle: none selected</option>
          <option value="__latest__">Latest generated routes</option>
          {data?.callCycleTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.active ? " (active)" : ""}
            </option>
          ))}
        </select>

        {hasFilters && (
          <button onClick={clearAll} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100">
            Clear filters
          </button>
        )}
      </div>

      {/* Honesty banners: each names a reason a column is empty. */}
      {data && !data.hasSnapshot && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
          No IMS snapshot has been built, so the IMS store counts read zero and portfolio revenue
          falls back to whatever each store already carries. Press <strong>Refresh snapshot</strong> on{" "}
          <a href="/admin/ims" className="underline">IMS Reconciliation</a>.
        </div>
      )}
      {data && typeId && !data.newCycle && (
        <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800">
          No routes have been generated for that call cycle yet, so the New Cycle columns are blank.
          Generate them on the <a href="/routes" className="underline">Routes</a> page.
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}

      {/* Summary */}
      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
          {[
            { label: "Reps", value: num(totals.reps), tone: "text-gray-900" },
            { label: "Stores (Repsly)", value: num(totals.storesRepsly), tone: "text-blue-600" },
            { label: "Portfolio / month", value: rand(totals.portfolioMonthly), tone: "text-gray-900" },
            { label: "Commission / month", value: rand(totals.earning), tone: "text-green-700" },
            { label: "Earning commission", value: `${totals.qualifying} of ${totals.reps}`, tone: "text-gray-900" },
          ].map((c) => (
            <div key={c.label} className="bg-white border border-gray-100 rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-gray-400">{c.label}</p>
              <p className={`text-xl font-bold mt-1 ${c.tone}`}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Grid */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr className="text-left text-[10px] text-gray-500 uppercase tracking-wider">
                <SortableTh sortId="repCode" sort={sort} className="px-3 py-2">Rep Code</SortableTh>
                <SortableTh sortId="repName" sort={sort} className="px-3 py-2">Rep Name</SortableTh>
                <SortableTh sortId="teamName" sort={sort} className="px-3 py-2">Team</SortableTh>
                <SortableTh sortId="storesRepsly" sort={sort} align="right" className="px-3 py-2">
                  Stores (Repsly)
                </SortableTh>
                <SortableTh sortId="storesIms" sort={sort} align="right" className="px-3 py-2">
                  Stores (IMS)
                </SortableTh>
                <SortableTh sortId="callsPerMonth" sort={sort} align="right" className="px-3 py-2">
                  Calls / Month
                </SortableTh>
                <SortableTh sortId="callsPerWeek" sort={sort} align="right" className="px-3 py-2">
                  Calls / Week
                </SortableTh>
                <SortableTh sortId="callsPerDay" sort={sort} align="right" className="px-3 py-2">
                  Calls / Day
                </SortableTh>
                <SortableTh sortId="portfolioMonthly" sort={sort} align="right" className="px-3 py-2">
                  Portfolio / Month
                </SortableTh>
                <SortableTh sortId="earning" sort={sort} align="right" className="px-3 py-2">
                  Potential Earning
                </SortableTh>
                <SortableTh sortId="newCycleStores" sort={sort} align="right" className="px-3 py-2">
                  New Cycle Stores
                </SortableTh>
                <SortableTh sortId="newCyclePortfolioMonthly" sort={sort} align="right" className="px-3 py-2">
                  New Cycle Portfolio
                </SortableTh>
                <SortableTh sortId="newCycleEarning" sort={sort} align="right" className="px-3 py-2">
                  New Cycle Earning
                </SortableTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr><td colSpan={13} className="px-3 py-8 text-center text-gray-400">Loading…</td></tr>
              ) : sorted.length === 0 ? (
                <tr><td colSpan={13} className="px-3 py-8 text-center text-gray-400">No reps match these filters.</td></tr>
              ) : (
                sorted.map((r) => (
                  <tr key={r.repCode} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-gray-500">{r.repCode}</td>
                    <td className="px-3 py-2 font-medium text-gray-900">{r.repName}</td>
                    <td className="px-3 py-2 text-gray-500">{r.teamName || "—"}</td>
                    <td className="px-3 py-2 text-right text-gray-600">
                      {r.storesRepsly === 0 ? <span className="text-amber-600 font-medium">0</span> : num(r.storesRepsly)}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600">
                      {num(r.storesIms)}
                      {/* 🔴 This used to render as "+12", which claims the wrong
                          arithmetic: the unrouted outlets are a SUBSET of the IMS
                          count, not an addition to it. imsCount is bumped for both
                          matched rows and ghosts; imsOnlyCount only for ghosts. So
                          "174 +12" read as 186 when it meant "12 of the 174", which
                          is exactly why nobody could parse it. */}
                      {/* The count is the way IN to the list. Knowing a rep has
                          two unrouted outlets is useless without being able to
                          see WHICH two, and this was the only screen that knew
                          the number. */}
                      {r.storesImsOnly > 0 && (
                        <a
                          href={`/stores?rep=${encodeURIComponent(r.repCode)}&ghosts=1`}
                          className="ml-1 text-[10px] text-blue-600 underline decoration-dotted underline-offset-2 hover:text-blue-800"
                          title={`Show the ${r.storesImsOnly} of these ${r.storesIms} outlets that have no store in the router. They are on no map, in no call cycle, and nobody is sent to them.`}
                        >
                          ({r.storesImsOnly} unrouted)
                        </a>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600">{r.callsPerMonth.toLocaleString("en-ZA")}</td>
                    <td className="px-3 py-2 text-right text-gray-600">{r.callsPerWeek.toLocaleString("en-ZA")}</td>
                    {/* The number a manager argues about. Flagged once it is past
                        what a day can hold, because a book asking for 37 calls a
                        day is not a routing problem, it is a book problem. */}
                    <td className="px-3 py-2 text-right">
                      {r.callsPerDay > DAILY_CALL_WARNING ? (
                        <span
                          className="font-semibold text-red-700"
                          title={`${r.callsPerDay} calls a day is more than a working day holds. Their store frequencies, not the routes, decide this.`}
                        >
                          {r.callsPerDay.toLocaleString("en-ZA")}
                        </span>
                      ) : (
                        <span className="text-gray-600">{r.callsPerDay.toLocaleString("en-ZA")}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Money v={r.portfolioMonthly} />
                      {r.storesWithoutSales > 0 && (
                        <span
                          className="ml-1 text-[10px] text-gray-400"
                          title={`${r.storesWithoutSales} of this rep's stores carry no IMS figure at all, so they add nothing to this total`}
                        >
                          ({r.storesWithoutSales})
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {r.commission.qualifies ? (
                        <span className="font-semibold text-green-700">{rand(r.commission.earning)}</span>
                      ) : (
                        <span
                          className="text-gray-400"
                          title={`${rand(r.commission.shortfall)} short of the threshold`}
                        >
                          {rand(0)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600">
                      {r.newCycleStores === null ? <span className="text-gray-300">&mdash;</span> : num(r.newCycleStores)}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Money v={r.newCyclePortfolioMonthly} />
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {r.newCycleCommission === null ? (
                        <span className="text-gray-300">&mdash;</span>
                      ) : r.newCycleCommission.qualifies ? (
                        <span className="font-semibold text-green-700">{rand(r.newCycleCommission.earning)}</span>
                      ) : (
                        <span className="text-gray-400" title={`${rand(r.newCycleCommission.shortfall)} short of the threshold`}>
                          {rand(0)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {/* Totals follow the filters, so a filtered view never shows the whole business. */}
            {!loading && sorted.length > 0 && (
              <tfoot className="bg-gray-50 border-t border-gray-200">
                <tr className="font-semibold text-gray-800">
                  <td className="px-3 py-2" colSpan={3}>
                    {hasFilters ? `${totals.reps} reps (filtered)` : `${totals.reps} reps`}
                  </td>
                  <td className="px-3 py-2 text-right">{num(totals.storesRepsly)}</td>
                  <td className="px-3 py-2 text-right">{num(totals.storesIms)}</td>
                  <td className="px-3 py-2 text-right">{totals.callsPerMonth.toLocaleString("en-ZA")}</td>
                  <td className="px-3 py-2 text-right">{totals.callsPerWeek.toLocaleString("en-ZA")}</td>
                  <td className="px-3 py-2 text-right">{totals.callsPerDay.toLocaleString("en-ZA")}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{rand(totals.portfolioMonthly)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-green-700">{rand(totals.earning)}</td>
                  <td className="px-3 py-2 text-right">{showNewCycle ? num(totals.newCycleStores) : "—"}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {showNewCycle ? rand(totals.newCyclePortfolioMonthly) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-green-700">
                    {showNewCycle ? rand(totals.newCycleEarning) : "—"}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Reading this table.

          Every marker is rendered HERE in the same styling it has in the grid,
          against a worked example. Describing a colour in prose ("a blue +n")
          asks the reader to hold a description in their head and go hunting for
          something that matches it; showing the thing does not. */}
      <div className="mt-4 bg-white border border-gray-100 rounded-xl p-4">
        <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-3">Reading this table</p>
        <dl className="space-y-2.5 text-xs">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <dt className="w-40 shrink-0 font-medium text-gray-700">Stores (Repsly)</dt>
            <dd className="flex-1 min-w-[18rem] text-gray-500">
              What this router holds for the rep. It is where the Repsly Places exports landed.
            </dd>
          </div>

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <dt className="w-40 shrink-0 font-medium text-gray-700">Stores (IMS)</dt>
            <dd className="flex-1 min-w-[18rem] text-gray-500">
              What the client invoices under that rep code. It will not match the Repsly
              count, and is not meant to.
            </dd>
          </div>

          {/* The one nobody could read. Its own row, with the real example. */}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-gray-100 pt-2.5">
            <dt className="w-40 shrink-0 whitespace-nowrap">
              <span className="text-gray-700">174</span>
              <span className="ml-1 text-[10px] text-blue-600 underline decoration-dotted underline-offset-2">
                (12 unrouted)
              </span>
            </dt>
            <dd className="flex-1 min-w-[18rem] text-gray-500">
              IMS bills <strong className="text-gray-700">174</strong> outlets to this rep, and
              <strong className="text-blue-600"> 12 of those 174</strong> have no store in this
              router at all. They are on no map, in no call cycle, and no rep is ever sent to
              them. <strong className="text-gray-700">The 12 are part of the 174, not extra.</strong>
              {" "}Click the blue number to open the Stores page showing exactly those outlets.
            </dd>
          </div>

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-gray-100 pt-2.5">
            <dt className="w-40 shrink-0 whitespace-nowrap">
              <span className="text-gray-700">R 400 000</span>
              <span className="ml-1 text-[10px] text-gray-400">(18)</span>
            </dt>
            <dd className="flex-1 min-w-[18rem] text-gray-500">
              Portfolio is six months of IMS value divided by six. The
              <strong className="text-gray-500"> grey number in brackets</strong> counts stores
              carrying no IMS figure at all, so they add nothing to the total. A low portfolio
              beside a high grey number means missing data, not a quiet rep.
            </dd>
          </div>

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-gray-100 pt-2.5">
            <dt className="w-40 shrink-0 font-medium text-gray-700">Calls / Month</dt>
            <dd className="flex-1 min-w-[18rem] text-gray-500">
              Comes from each store&apos;s frequency in this app, not from any route plan. Week and
              Day are the same figure over a 4-week cycle of 5 working days. It switches to
              Repsly&apos;s own schedule once the Call Cycles sync has credentials.
            </dd>
          </div>

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-gray-100 pt-2.5">
            <dt className="w-40 shrink-0 whitespace-nowrap">
              <span className="font-semibold text-red-700">40</span>
              <span className="ml-1 text-gray-400">in Calls / Day</span>
            </dt>
            <dd className="flex-1 min-w-[18rem] text-gray-500">
              <strong className="text-red-700">Red</strong> means the rep&apos;s book asks for more
              calls a day than a working day holds. Their store
              <strong className="text-gray-700"> frequencies</strong> decide this, not the routes,
              so no amount of re-routing fixes it. Data Health lists these reps with the hours
              behind the number.
            </dd>
          </div>
        </dl>

        {data?.snapshotFetchedAt && (
          <p className="mt-3 pt-2.5 border-t border-gray-100 text-xs text-gray-400">
            IMS snapshot taken {new Date(data.snapshotFetchedAt).toLocaleString("en-ZA")}.
          </p>
        )}
      </div>
    </div>
  );
}
