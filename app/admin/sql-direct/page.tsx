"use client";

import { useState } from "react";

/**
 * SQL Direct — reconnaissance, not an importer.
 *
 * Nothing on this page writes anything. It exists to find out what the client's
 * SQL Server actually holds and, crucially, whether its store identifiers match
 * the ones already here, before any of it is wired into the app.
 */

interface ColumnProfile {
  name: string;
  populated: number;
  populatedPercent: number;
  sample: string | null;
}

interface MatchReport {
  idColumn: string | null;
  note?: string;
  appStores?: number;
  sqlRows?: number;
  inBoth?: number;
  appMatchedPercent?: number;
  appOnlySample?: string[];
  sqlOnlySample?: string[];
}

interface Result {
  configured: boolean;
  error?: string;
  query?: string;
  client?: string;
  ms?: number;
  rowCount?: number;
  sampled?: number;
  columns?: ColumnProfile[];
  firstRow?: Record<string, unknown> | null;
  match?: MatchReport;
}

/**
 * Queries already registered on the shared proxy that are worth pointing at
 * while we work out where IMS lives. The proxy refuses anything not registered,
 * so this list is the menu, not a suggestion.
 */
const KNOWN_QUERIES = [
  { name: "list_clients", label: "List SQL clients", hint: "ClientMaster. Confirms the exact client name; CLIPPA SALES vs CLIPPA SALES (Pty) Ltd has bitten us before." },
  { name: "list_tables", label: "List tables", hint: "ClientMaster only. Cannot see any other server or database." },
  { name: "client_stores", label: "Retail sites", hint: "ClientMaster. Sell-out store master, NOT the sales this project needs." },
  { name: "client_channels", label: "Retail channels", hint: "ClientMaster." },
];

export default function SqlDirectPage() {
  const [query, setQuery] = useState("list_clients");
  const [client, setClient] = useState("CLIPPA SALES");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const run = async (q: string) => {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/sql-direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, client }),
      });
      setResult(await res.json());
    } catch (e) {
      setResult({ configured: true, error: String(e) });
    } finally {
      setRunning(false);
    }
  };

  const m = result?.match;

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">SQL Direct</h1>
        <p className="text-sm text-gray-500">
          Read-only reconnaissance against the client&apos;s SQL Server, through the shared Railway proxy
        </p>
      </div>

      <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-900">This page writes nothing.</p>
        <p className="mt-1 text-xs text-amber-800">
          It runs queries that somebody has already registered on the proxy and describes what comes back. The
          proxy refuses raw SQL by design, so this cannot reach anything that has not been reviewed. Nothing
          here touches stores, reps, channels or the upload path.
        </p>
        <p className="mt-2 text-xs font-medium text-amber-900">
          ⚠️ Every query below runs against <span className="font-mono">ClientMaster</span>, which is the
          sell-out database and is NOT where in-market sales live. They are here to prove the connection
          works, not because they hold what this project needs. The IMS source needs its own registry entry
          on the proxy, and probably its own connection pool.
        </p>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <label className="block text-xs font-medium text-gray-500">Client name, as SQL knows it</label>
        <input
          value={client}
          onChange={(e) => setClient(e.target.value)}
          className="mt-1 w-full max-w-sm rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red"
        />

        <div className="mt-4 flex flex-wrap gap-2">
          {KNOWN_QUERIES.map((q) => (
            <button
              key={q.name}
              onClick={() => {
                setQuery(q.name);
                run(q.name);
              }}
              disabled={running}
              title={q.hint}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                query === q.name
                  ? "border-clippa-red bg-clippa-red text-white"
                  : "border-gray-300 text-gray-700 hover:bg-gray-50"
              }`}
            >
              {q.label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-end gap-2">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-500">Or name any registered query</label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. the IMS query, once Mark has one"
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-clippa-red"
            />
          </div>
          <button
            onClick={() => run(query)}
            disabled={running || !query.trim()}
            className="rounded-lg bg-clippa-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {running ? "Running..." : "Run"}
          </button>
        </div>
      </div>

      {result && (
        <div className="mt-6 space-y-4">
          {result.configured === false && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {result.error}
            </div>
          )}

          {result.error && result.configured !== false && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm font-semibold text-red-800">The proxy refused or failed</p>
              <p className="mt-1 break-words font-mono text-xs text-red-700">{result.error}</p>
              <p className="mt-2 text-xs text-red-700">
                A 401 means the key is wrong. A 400 naming an unknown query means it has not been registered on
                the proxy yet, which is a different problem with a different fix.
              </p>
            </div>
          )}

          {!result.error && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Rows", (result.rowCount ?? 0).toLocaleString()],
                  ["Columns", String(result.columns?.length ?? 0)],
                  ["Took", `${result.ms}ms`],
                  ["Profiled", `${result.sampled} rows`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
                    <p className="mt-1 text-xl font-bold text-gray-900">{value}</p>
                  </div>
                ))}
              </div>

              {m && (
                <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                  <h2 className="text-sm font-semibold text-gray-700">Do the identifiers match?</h2>
                  {m.note && <p className="mt-1 text-xs text-gray-500">{m.note}</p>}
                  {m.idColumn && (
                    <>
                      <p className="mt-1 text-xs text-gray-500">
                        Matched on <span className="font-mono font-medium text-gray-700">{m.idColumn}</span>{" "}
                        against the Place ID on each store here.
                      </p>
                      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {[
                          ["Stores here", (m.appStores ?? 0).toLocaleString(), ""],
                          ["Distinct in SQL", (m.sqlRows ?? 0).toLocaleString(), ""],
                          ["In both", (m.inBoth ?? 0).toLocaleString(), "good"],
                          ["Matched", `${m.appMatchedPercent ?? 0}%`, (m.appMatchedPercent ?? 0) > 80 ? "good" : "bad"],
                        ].map(([label, value, tone]) => (
                          <div key={label}>
                            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
                            <p
                              className={`mt-0.5 text-lg font-bold ${
                                tone === "good" ? "text-green-600" : tone === "bad" ? "text-clippa-red" : "text-gray-900"
                              }`}
                            >
                              {value}
                            </p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <div>
                          <p className="text-xs font-medium text-gray-700">Here but not in SQL</p>
                          <ul className="mt-1 space-y-0.5">
                            {(m.appOnlySample ?? []).map((id) => (
                              <li key={id} className="font-mono text-[11px] text-gray-500">{id}</li>
                            ))}
                            {(m.appOnlySample ?? []).length === 0 && (
                              <li className="text-[11px] text-gray-400">none in the sample</li>
                            )}
                          </ul>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-gray-700">In SQL but not here</p>
                          <ul className="mt-1 space-y-0.5">
                            {(m.sqlOnlySample ?? []).map((id) => (
                              <li key={id} className="font-mono text-[11px] text-gray-500">{id}</li>
                            ))}
                            {(m.sqlOnlySample ?? []).length === 0 && (
                              <li className="text-[11px] text-gray-400">none in the sample</li>
                            )}
                          </ul>
                        </div>
                      </div>
                      <p className="mt-3 text-[11px] text-gray-500">
                        Compare the two lists above before concluding anything. Identifiers that differ only by a
                        prefix, padding or case are a mapping problem, not missing data.
                      </p>
                    </>
                  )}
                </div>
              )}

              {result.columns && result.columns.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
                  <div className="border-b border-gray-100 px-4 py-3">
                    <h2 className="text-sm font-semibold text-gray-700">What came back</h2>
                    <p className="mt-0.5 text-xs text-gray-500">
                      How populated each column is, not merely that it exists. A column present but empty
                      everywhere is the difference between having the data and having somewhere to put it.
                    </p>
                  </div>
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50">
                      <tr className="text-[10px] uppercase tracking-wide text-gray-500">
                        <th className="px-4 py-2 font-medium">Column</th>
                        <th className="px-4 py-2 font-medium text-right">Populated</th>
                        <th className="px-4 py-2 font-medium">Example value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {result.columns.map((c) => (
                        <tr key={c.name} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-mono text-gray-800">{c.name}</td>
                          <td
                            className={`px-4 py-2 text-right font-medium ${
                              c.populatedPercent === 0 ? "text-clippa-red" : c.populatedPercent < 50 ? "text-amber-600" : "text-gray-600"
                            }`}
                          >
                            {c.populatedPercent}%
                          </td>
                          <td className="px-4 py-2 text-gray-500">
                            {c.sample ?? <span className="text-gray-300">empty on every sampled row</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
