"use client";

import { useState, useCallback } from "react";

interface Check {
  name: string;
  ok: boolean;
  status: string;
  ms: number;
  detail: string;
  fix?: string;
}

interface GoogleHealth {
  keyPresent: boolean;
  keyHint: string | null;
  healthy: boolean;
  headline: string;
  detail: string;
  checks: Check[];
  checkedAt: string;
  error?: string;
}

export default function DiagnosticsPage() {
  const [health, setHealth] = useState<GoogleHealth | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const run = useCallback(async () => {
    setRunning(true);
    setError("");
    setHealth(null);
    try {
      const res = await fetch("/api/diagnostics/google");
      const data = await res.json();
      if (!res.ok) setError(data.error || `Check failed (${res.status})`);
      else setHealth(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }, []);

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">System Health</h1>
        <p className="text-sm text-gray-500">
          Live checks against the outside services this app depends on
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Google Maps</h2>
            <p className="mt-1 text-xs text-gray-500 max-w-lg">
              Route generation uses the Directions API to order each day along real roads, and the Geocoding
              API to turn a rep&apos;s home address into coordinates. If Google stops answering, the router
              silently falls back to straight-line distances — plans still come out, they just stop
              reflecting real driving. This check calls both APIs for real.
            </p>
          </div>
          <button
            onClick={run}
            disabled={running}
            className="flex-shrink-0 rounded-lg bg-clippa-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {running ? "Checking..." : "Run check"}
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {health && (
          <div className="mt-5">
            <div
              className={`rounded-lg border p-4 ${
                health.healthy
                  ? "border-green-200 bg-green-50"
                  : "border-red-200 bg-red-50"
              }`}
            >
              <p
                className={`text-sm font-semibold ${
                  health.healthy ? "text-green-800" : "text-red-800"
                }`}
              >
                {health.headline}
              </p>
              <p className={`mt-1 text-xs ${health.healthy ? "text-green-700" : "text-red-700"}`}>
                {health.detail}
              </p>
            </div>

            <dl className="mt-4 space-y-3">
              {health.checks.map((c) => (
                <div key={c.name} className="rounded-lg border border-gray-100 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-sm font-medium text-gray-800">{c.name}</dt>
                    <span
                      className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold ${
                        c.ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                      }`}
                    >
                      {c.status} · {c.ms}ms
                    </span>
                  </div>
                  <dd className="mt-1 text-xs text-gray-600">{c.detail}</dd>
                  {c.fix && (
                    <dd className="mt-2 rounded bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
                      <strong className="font-semibold">What to do: </strong>
                      {c.fix}
                    </dd>
                  )}
                </div>
              ))}
            </dl>

            <p className="mt-4 text-[11px] text-gray-400">
              {health.keyPresent
                ? `Key in use: ${health.keyHint}. Checked ${new Date(health.checkedAt).toLocaleString("en-ZA")}.`
                : `No key set. Checked ${new Date(health.checkedAt).toLocaleString("en-ZA")}.`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
