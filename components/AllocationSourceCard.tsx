"use client";

import { useState, useEffect, useCallback } from "react";
import type { AllocationSource } from "@/lib/allocationSource";
import ActionButton from "./ActionButton";

interface Move {
  placeId: string;
  storeName: string;
  from: string;
  to: string;
  toRepName: string | null;
}

interface PlanResponse {
  settings: { source: AllocationSource; allowUnknownReps: boolean; updatedAt: string | null; updatedBy: string | null };
  plan: {
    moves: Move[];
    held: Move[];
    moveCount: number;
    heldCount: number;
    unchanged: number;
    imsSilent: number;
    unknownCodes: { code: string; stores: number }[];
    netByRep: { code: string; name: string | null; gained: number; lost: number; valueGained: number }[];
  } | null;
  snapshot?: { fetchedAt: string; appStoresAtBuild: number; appStoresNow: number; stale: boolean };
  error?: string;
}

const num = (n: number) => n.toLocaleString("en-ZA");
const rand = (n: number) => "R " + Math.round(n).toLocaleString("en-ZA");

/**
 * Which system owns the store-to-rep allocation, and what switching would do.
 *
 * Preview first, always. This rewrites which human is credited with which shop,
 * and there is no store backup to diff against afterwards.
 */
/**
 * @param refreshKey change it to make this card re-read /api/allocation.
 *
 * The plan is computed from the IMS snapshot, and the snapshot is rebuilt by a
 * button on the parent page. Without this the card kept showing the plan from
 * the OLD snapshot, warning that the snapshot was stale, while the page above
 * it reported a successful rebuild. Two panels, same instant, disagreeing.
 */
export default function AllocationSourceCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const [data, setData] = useState<PlanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/allocation")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ settings: { source: "repsly", allowUnknownReps: false, updatedAt: null, updatedBy: null }, plan: null, error: "Could not load" }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load, refreshKey]);

  const save = async (source: AllocationSource, apply: boolean) => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/allocation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, allowUnknownReps: false, apply }),
      });
      const d = await res.json();
      if (!res.ok) setResult(d.error || "Failed");
      else if (apply)
        setResult(
          `Re-assigned ${num(d.applied)} stores to their IMS rep` +
            (d.held ? `. ${num(d.held)} held back because their IMS rep code has no rep record.` : ".")
        );
      else setResult(`Allocation source is now ${source === "ims" ? "IMS" : "Repsly uploads"}.`);
      load();
    } catch {
      setResult("Could not reach the server");
    }
    setBusy(false);
  };

  if (loading) return <div className="rounded-xl border border-gray-100 bg-white p-5 text-xs text-gray-400">Loading allocation…</div>;

  const s = data?.settings;
  const p = data?.plan;
  const isIms = s?.source === "ims";

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-900">Who decides which rep owns a store</h2>
      <p className="mt-1 text-xs text-gray-500">
        Repsly Places exports are a snapshot of whatever Repsly held on the day they were pulled.
        IMS knows who actually invoices the outlet. Switching to IMS also stops a future upload
        overwriting a rep code, which is the half that makes it stick.
      </p>

      <div className="mt-3 flex items-center gap-2 text-xs">
        <span className="text-gray-500">Currently:</span>
        <span className={`rounded px-2 py-0.5 font-medium ${isIms ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"}`}>
          {isIms ? "IMS" : "Repsly uploads"}
        </span>
        {s?.updatedAt && (
          <span className="text-gray-400">
            set {new Date(s.updatedAt).toLocaleString("en-ZA")}
            {s.updatedBy ? ` by ${s.updatedBy}` : ""}
          </span>
        )}
      </div>

      {data?.error && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{data.error}</p>}

      {data?.snapshot?.stale && (
        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          ⚠ The snapshot describes {num(data.snapshot.appStoresAtBuild)} stores, but there are now{" "}
          {num(data.snapshot.appStoresNow)}. Refresh the snapshot before applying, or the plan is
          computed from a stale picture.
        </p>
      )}

      {p && (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            {[
              { k: "Already agree", v: num(p.unchanged), tone: "text-gray-900" },
              { k: "IMS has no rep", v: num(p.imsSilent), tone: "text-gray-500" },
              { k: "Would move", v: num(p.moveCount), tone: "text-blue-700" },
              { k: "Held back", v: num(p.heldCount), tone: p.heldCount ? "text-amber-700" : "text-gray-400" },
            ].map((c) => (
              <div key={c.k} className="rounded-lg bg-gray-50 p-3">
                <dt className="text-[10px] uppercase tracking-wider text-gray-400">{c.k}</dt>
                <dd className={`mt-0.5 text-lg font-bold ${c.tone}`}>{c.v}</dd>
              </div>
            ))}
          </dl>

          {p.unknownCodes.length > 0 && (
            <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-medium">
                🔴 {num(p.heldCount)} stores would land on a rep code that has no rep record, so they are
                held back.
              </p>
              <p className="mt-1">
                A store whose rep code matches no rep is dropped from the map, every route and all
                capacity figures, silently. IMS carries branch and house codes that are not people.
              </p>
              <p className="mt-2 font-mono">
                {p.unknownCodes.slice(0, 10).map((u) => `${u.code} (${u.stores})`).join("  ·  ")}
              </p>
              <p className="mt-2">
                Create these as reps first if they are real people, and they move on the next apply.
              </p>
            </div>
          )}

          {p.netByRep.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-gray-700">Biggest movements</p>
              <div className="mt-1 overflow-hidden rounded-lg border border-gray-100">
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-gray-50">
                    {p.netByRep.slice(0, 6).map((r) => (
                      <tr key={r.code}>
                        <td className="px-3 py-1.5 font-mono text-gray-500">{r.code}</td>
                        <td className="px-3 py-1.5 text-gray-700">{r.name ?? <span className="text-amber-700">no rep record</span>}</td>
                        <td className="px-3 py-1.5 text-right font-medium text-green-700">+{num(r.gained)}</td>
                        <td className="px-3 py-1.5 text-right text-gray-400">{r.lost ? `-${num(r.lost)}` : ""}</td>
                        <td className="px-3 py-1.5 text-right text-gray-600">{rand(r.valueGained)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button onClick={() => setShowList((v) => !v)} className="mt-2 text-xs text-clippa-red hover:underline">
                {showList ? "Hide" : `Show the first ${Math.min(300, p.moveCount)} moves`}
              </button>
              {showList && (
                <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-gray-100 p-2">
                  {p.moves.map((m) => (
                    <div key={m.placeId} className="text-[11px] text-gray-600">
                      <span className="font-mono">{m.placeId}</span> {m.from || "(none)"} →{" "}
                      <span className="font-mono">{m.to}</span> {m.toRepName ?? ""} · {m.storeName}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <div className="mt-4 flex flex-wrap items-start gap-3">
        {!isIms ? (
          <ActionButton
            label="Make IMS the source"
            hint="Saves the setting only. No store moves yet, and a future upload stops being able to overwrite a rep code."
            onClick={() => save("ims", false)}
            disabled={busy}
          />
        ) : (
          <ActionButton
            label="Go back to Repsly uploads"
            hint="Saves the setting only. No store moves back, but a Places upload can overwrite rep codes again."
            onClick={() => save("repsly", false)}
            disabled={busy}
          />
        )}
        <ActionButton
          label={busy ? "Working…" : `Re-assign ${p ? num(p.moveCount) : ""} stores now`}
          hint={
            data?.snapshot?.stale
              ? "Blocked until the snapshot is refreshed, or the plan would come from a stale picture."
              : "Saves. Rewrites the rep on every store listed above. Held-back codes are not touched."
          }
          variant="primary"
          onClick={() => save("ims", true)}
          disabled={busy || !p || p.moveCount === 0 || !!data?.snapshot?.stale}
          title={data?.snapshot?.stale ? "Refresh the snapshot first" : ""}
        />
      </div>

      {result && <p className="mt-3 rounded-lg bg-green-50 p-3 text-xs text-green-900">{result}</p>}
    </div>
  );
}
