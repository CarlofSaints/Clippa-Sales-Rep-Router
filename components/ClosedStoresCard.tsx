"use client";

import { useState } from "react";
import ActionButton from "./ActionButton";

/**
 * Mark stores IMS says are shut, so no rep is routed to them.
 *
 * Preview then apply, like every other write on this page. The two IMS signals
 * are shown separately and the wider one is opt-in, because Ago's instruction
 * was about ACCC specifically and the flag sweeps in roughly three times as many.
 */

interface Move {
  placeId: string;
  name: string;
  repCode: string;
  reason: string;
  sixMonthSales: number | null;
}

interface Preview {
  mode?: string;
  error?: string;
  wouldClose?: number;
  byReason?: { ims_accc: number; ims_flag: number; manual: number };
  alreadyClosed?: number;
  wouldReopen?: number;
  closedButSelling?: number;
  sample?: Move[];
  reopenSample?: Move[];
  sellingSample?: Move[];
  changed?: number;
}

const rand = (n: number | null) => (n === null || n === undefined ? "" : "R " + Math.round(n).toLocaleString("en-ZA"));

export default function ClosedStoresCard({ onApplied }: { onApplied?: () => void }) {
  const [includeFlag, setIncludeFlag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Preview | null>(null);
  const [showList, setShowList] = useState(false);

  const run = async (mode: "preview" | "apply" | "reopen") => {
    setBusy(true);
    if (mode !== "preview") setShowList(false);
    try {
      const res = await fetch(
        `/api/stores/closed?mode=${mode}&includeImsFlag=${includeFlag ? "1" : "0"}`,
        { method: "POST" }
      );
      const body = await res.json();
      setResult(body);
      if (mode !== "preview" && !body.error) {
        onApplied?.();
        // Re-preview so the card reflects what is left, not what was.
        const again = await fetch(
          `/api/stores/closed?mode=preview&includeImsFlag=${includeFlag ? "1" : "0"}`,
          { method: "POST" }
        );
        setResult({ ...(await again.json()), changed: body.changed, mode: body.mode });
      }
    } catch (e) {
      setResult({ error: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const p = result;

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-900">Closed stores</h2>
      <p className="mt-1 text-xs text-gray-500">
        IMS parks dead accounts on the rep code <span className="font-mono">ACCC</span>, which is why they
        were being held back by the allocation as a code with no rep. A closed store is dropped from route
        generation and from capacity, so nobody is sent to a shop that is not there. It keeps its name,
        rep and history and can be reopened.
      </p>

      <label className="mt-3 flex items-start gap-2 text-xs text-gray-700">
        <input
          type="checkbox"
          checked={includeFlag}
          onChange={(e) => {
            setIncludeFlag(e.target.checked);
            setResult(null);
          }}
          className="mt-0.5"
        />
        <span>
          Also close stores IMS flags with its own <strong>Closed Status</strong> field, not only ACCC.
          These are two different signals and neither contains the other, so this is off by default.
        </span>
      </label>

      <div className="mt-3 flex flex-wrap items-start gap-3">
        <ActionButton
          label={busy ? "Working..." : "Preview the change"}
          hint="Reads the saved snapshot and counts what would shut. Nothing is saved and IMS is not touched."
          onClick={() => run("preview")}
          disabled={busy}
        />
        <ActionButton
          label={p?.wouldClose ? `Close ${p.wouldClose} stores` : "Close the stores"}
          hint="Saves. These stores stop appearing in route generation and capacity. Reversible with Reopen."
          variant="primary"
          onClick={() => run("apply")}
          disabled={busy || !p || !!p.error || !p.wouldClose}
          title={!p ? "Preview first" : ""}
        />
        {!!p?.wouldReopen && (
          <ActionButton
            label={`Reopen ${p.wouldReopen} stores`}
            hint="Saves. Puts them back into call cycles. Anything you closed by hand is left alone."
            variant="positive"
            onClick={() => run("reopen")}
            disabled={busy}
          />
        )}
      </div>

      {p?.error && (
        <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-800">{p.error}</p>
      )}

      {p && !p.error && (
        <div className="mt-3 space-y-2 rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
          {p.changed !== undefined && (
            <p className="font-semibold text-green-800">
              {p.mode === "reopen" ? `Reopened ${p.changed} stores.` : `Marked ${p.changed} stores closed.`}
            </p>
          )}
          <p>
            <strong>{(p.wouldClose ?? 0).toLocaleString("en-ZA")}</strong> open stores IMS says are shut
            {p.byReason && (
              <>
                {" "}
                — {p.byReason.ims_accc.toLocaleString("en-ZA")} on ACCC
                {includeFlag && <>, {p.byReason.ims_flag.toLocaleString("en-ZA")} by closed status</>}
              </>
            )}
            . Already closed: {(p.alreadyClosed ?? 0).toLocaleString("en-ZA")}.
          </p>

          {!!p.wouldReopen && (
            <p className="text-amber-800">
              ⚠️ <strong>{p.wouldReopen}</strong> stores are marked closed but IMS no longer says so. They
              stay shut until you press Reopen. Anything closed by hand is never in this count.
            </p>
          )}

          {!!p.closedButSelling && (
            <p className="text-amber-800">
              🔴 <strong>{p.closedButSelling}</strong> stores are closed yet have sales in the last six
              months. A shop that is still buying is not shut, so check these before trusting the flag.
              {p.sellingSample?.slice(0, 3).map((m) => (
                <span key={m.placeId} className="ml-1 font-mono">
                  {m.placeId} {rand(m.sixMonthSales)};
                </span>
              ))}
            </p>
          )}

          {!!p.sample?.length && (
            <>
              <button
                onClick={() => setShowList((v) => !v)}
                className="text-clippa-red underline"
              >
                {showList ? "Hide" : `Show the first ${p.sample.length}`}
              </button>
              {showList && (
                <div className="max-h-56 overflow-y-auto rounded border border-gray-200 bg-white">
                  <table className="w-full text-left text-xs">
                    <tbody>
                      {p.sample.map((m) => (
                        <tr key={m.placeId} className="border-b border-gray-100 last:border-0">
                          <td className="px-2 py-1 font-mono text-gray-500">{m.placeId}</td>
                          <td className="px-2 py-1">{m.name}</td>
                          <td className="px-2 py-1 font-mono text-gray-500">{m.repCode}</td>
                          <td className="px-2 py-1 text-right text-gray-500">{rand(m.sixMonthSales)}</td>
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
