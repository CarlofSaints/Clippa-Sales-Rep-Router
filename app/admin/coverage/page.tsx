"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "@/components/SessionProvider";

interface UnmatchedRepCode {
  repCode: string;
  storeCount: number;
  provinces: string[];
  regions: string[];
  storesWithBadGps: number;
}

interface IdleRep {
  id: string;
  code: string;
  name: string;
  email: string;
}

interface CoverageReport {
  summary: {
    totalStores: number;
    totalReps: number;
    distinctCodesOnStores: number;
    matchedCodes: number;
    unmatchedCodes: number;
    storesOnMatchedReps: number;
    storesOnUnmatchedCodes: number;
    storesWithNoRepCode: number;
    coveragePercent: number;
  };
  unmatched: UnmatchedRepCode[];
  idleReps: IdleRep[];
}

function Stat({
  label,
  value,
  tone = "plain",
  hint,
}: {
  label: string;
  value: string | number;
  tone?: "plain" | "bad" | "good";
  hint?: string;
}) {
  const toneClass =
    tone === "bad" ? "text-clippa-red" : tone === "good" ? "text-green-600" : "text-gray-900";
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

export default function CoveragePage() {
  const { can } = useSession();
  const [data, setData] = useState<CoverageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/coverage")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, []);

  const worstFirst = useMemo(() => data?.unmatched ?? [], [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-clippa-red border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || "Could not load coverage."}
        </div>
      </div>
    );
  }

  const s = data.summary;

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Store Coverage</h1>
          <p className="text-sm text-gray-500">
            Which of the store base the router can actually plan, and who is missing
          </p>
        </div>
        {can("export_data") && (
          <a
            href="/api/coverage/export"
            className="inline-flex items-center gap-2 rounded-lg bg-clippa-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export Excel
          </a>
        )}
      </div>

      {/* The headline finding, said plainly. A percentage on its own gets read as
          a score; the sentence underneath says what it costs. */}
      {s.unmatchedCodes > 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">
            {s.storesOnUnmatchedCodes.toLocaleString()} stores are allocated to {s.unmatchedCodes} rep
            {s.unmatchedCodes === 1 ? "" : "s"} the app has never been given.
          </p>
          <p className="mt-1 text-xs text-amber-800">
            A store is tied to its rep by the rep code on the store record, and nothing checks that code
            against the rep list. Stores naming a rep who was never loaded are dropped silently: not on the
            map, not in any route, not counted in capacity. Add the reps on the Reps page (Import Excel) and
            these stores attach themselves — then regenerate routes.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Stat label="Stores" value={s.totalStores.toLocaleString()} />
        <Stat
          label="Routable"
          value={s.storesOnMatchedReps.toLocaleString()}
          tone="good"
          hint={`${s.coveragePercent}% of the base`}
        />
        <Stat
          label="Unrouted"
          value={s.storesOnUnmatchedCodes.toLocaleString()}
          tone={s.storesOnUnmatchedCodes > 0 ? "bad" : "plain"}
          hint="rep code not in the app"
        />
        <Stat label="Reps loaded" value={s.totalReps} hint={`${s.distinctCodesOnStores} codes on stores`} />
        <Stat
          label="Missing reps"
          value={s.unmatchedCodes}
          tone={s.unmatchedCodes > 0 ? "bad" : "good"}
        />
      </div>

      {s.storesWithNoRepCode > 0 && (
        <p className="mb-6 text-xs text-gray-500">
          {s.storesWithNoRepCode.toLocaleString()} store
          {s.storesWithNoRepCode === 1 ? " has" : "s have"} no rep code at all. Those are a Store Upload
          problem rather than a missing rep, and they are counted separately above.
        </p>
      )}

      {/* Missing rep codes */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">
            Rep codes with no rep record ({worstFirst.length})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr className="text-[11px] uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2 font-medium">Rep code</th>
                <th className="px-4 py-2 font-medium text-right">Stores</th>
                <th className="px-4 py-2 font-medium text-right">Bad GPS</th>
                <th className="px-4 py-2 font-medium">Provinces</th>
                <th className="px-4 py-2 font-medium">Regions on the store list</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {worstFirst.map((u) => (
                <tr key={u.repCode} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono font-semibold text-gray-900">{u.repCode}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-gray-900">
                    {u.storeCount.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-500">
                    {u.storesWithBadGps > 0 ? u.storesWithBadGps.toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{u.provinces.join(", ") || "—"}</td>
                  <td className="px-4 py-2.5 text-gray-600">{u.regions.join(", ") || "—"}</td>
                </tr>
              ))}
              {worstFirst.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                    Every rep code on a store has a rep record. Nothing is being dropped.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* The mirror-image problem */}
      {data.idleReps.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">
              Reps with no stores ({data.idleReps.length})
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              They are in the app but no store names their code, so they route nothing. Usually a retyped
              code, occasionally someone who has left.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr className="text-[11px] uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2 font-medium">Rep code</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.idleReps.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono text-gray-900">{r.code}</td>
                  <td className="px-4 py-2.5 text-gray-700">{r.name || "—"}</td>
                  <td className="px-4 py-2.5 text-gray-500">{r.email || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
