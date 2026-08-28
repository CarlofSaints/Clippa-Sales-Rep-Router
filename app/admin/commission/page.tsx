"use client";

import { useState, useEffect } from "react";
import { computeCommission, commissionProblem, type CommissionSettings, type ThresholdBasis } from "@/lib/commission";

const rand = (n: number) =>
  "R " + n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CommissionPage() {
  const [settings, setSettings] = useState<CommissionSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  /** What the worked example runs on. Just a scratch figure, never saved. */
  const [example, setExample] = useState(750000);

  useEffect(() => {
    fetch("/api/commission")
      .then((r) => r.json())
      .then((d) => setSettings(d))
      .catch(() => setStatus({ ok: false, msg: "Could not load the current settings" }));
  }, []);

  const save = async () => {
    if (!settings) return;
    const problem = commissionProblem(settings);
    if (problem) {
      setStatus({ ok: false, msg: problem });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/commission", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) setStatus({ ok: false, msg: data.error || "Could not save" });
      else {
        setSettings(data);
        setStatus({ ok: true, msg: "Saved. Rep Sales & Activity recalculates on its next load." });
      }
    } catch {
      setStatus({ ok: false, msg: "Could not reach the server" });
    }
    setSaving(false);
  };

  if (!settings) {
    return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  }

  const worked = computeCommission(example, settings);

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-bold text-gray-900 mb-1">Commission</h1>
      <p className="text-sm text-gray-500 mb-6">
        What a rep earns on their portfolio. Nothing here is written into the code, so it can
        be changed the moment the deal changes.
      </p>

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Commission rate</label>
            <div className="relative">
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={settings.ratePercent}
                onChange={(e) => setSettings({ ...settings, ratePercent: Number(e.target.value) })}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full pr-8"
              />
              <span className="absolute right-3 top-2.5 text-sm text-gray-400">%</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Threshold, per month
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-sm text-gray-400">R</span>
              <input
                type="number"
                step="1000"
                min="0"
                value={settings.thresholdMonthly}
                onChange={(e) => setSettings({ ...settings, thresholdMonthly: Number(e.target.value) })}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full pl-7"
              />
            </div>
          </div>
        </div>

        {/*
          The ambiguous half of "3.25% from R550k", made explicit. The two
          readings differ by roughly three times on a real portfolio, so this is
          a choice somebody has to make rather than one the code should assume.
        */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            How the threshold works
          </label>
          <div className="space-y-2">
            {([
              {
                value: "excess" as ThresholdBasis,
                title: "Pay on the amount above the threshold",
                blurb: "Nothing is earned on the first R" + settings.thresholdMonthly.toLocaleString("en-ZA") + ". The rate applies to whatever is above it.",
              },
              {
                value: "gate" as ThresholdBasis,
                title: "Clear the threshold, then pay on everything",
                blurb: "Below the threshold earns nothing at all. At or above it, the rate applies to the whole portfolio.",
              },
            ]).map((opt) => (
              <label
                key={opt.value}
                className={`flex items-start gap-3 border rounded-lg p-3 cursor-pointer ${
                  settings.basis === opt.value ? "border-clippa-red bg-red-50/40" : "border-gray-200 hover:bg-gray-50"
                }`}
              >
                <input
                  type="radio"
                  name="basis"
                  checked={settings.basis === opt.value}
                  onChange={() => setSettings({ ...settings, basis: opt.value })}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-800">{opt.title}</span>
                  <span className="block text-xs text-gray-500 mt-0.5">{opt.blurb}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Note <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <input
            type="text"
            value={settings.note}
            onChange={(e) => setSettings({ ...settings, note: e.target.value })}
            placeholder="Why this changed, and from when"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-clippa-red text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {settings.updatedAt && (
            <span className="text-xs text-gray-400">
              Last changed {new Date(settings.updatedAt).toLocaleString("en-ZA")}
              {settings.updatedBy ? ` by ${settings.updatedBy}` : ""}
            </span>
          )}
        </div>

        {status && (
          <p className={`text-sm ${status.ok ? "text-green-700" : "text-amber-700"}`}>{status.msg}</p>
        )}
      </div>

      {/*
        A worked example, because a rate and a threshold do not tell anybody what
        they will actually be paid, and the two bases are easy to mix up until
        you see the same portfolio priced both ways.
      */}
      <div className="mt-6 bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Worked example</h2>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm text-gray-600">A rep whose portfolio bills</span>
          <div className="relative">
            <span className="absolute left-2 top-1.5 text-sm text-gray-400">R</span>
            <input
              type="number"
              step="10000"
              value={example}
              onChange={(e) => setExample(Number(e.target.value))}
              className="border border-gray-200 rounded px-2 py-1 text-sm w-36 pl-6"
            />
          </div>
          <span className="text-sm text-gray-600">a month earns:</span>
        </div>

        {worked.qualifies ? (
          <div className="text-sm space-y-1">
            <p className="text-gray-600">
              Rate applies to <span className="font-medium text-gray-900">{rand(worked.commissionable)}</span>
              {settings.basis === "excess"
                ? ` (${rand(worked.monthlyRevenue)} less the ${rand(settings.thresholdMonthly)} threshold)`
                : " (the full portfolio, since the threshold is met)"}
            </p>
            <p className="text-lg font-bold text-green-700">{rand(worked.earning)}</p>
          </div>
        ) : (
          <div className="text-sm space-y-1">
            <p className="text-amber-700 font-medium">Earns nothing this month.</p>
            <p className="text-gray-600">
              {rand(worked.shortfall)} short of the {rand(settings.thresholdMonthly)} threshold.
            </p>
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-gray-400">
        ⚠ Portfolio revenue comes from IMS, and only 56% of the store base currently matches an
        IMS outlet. Every rep&apos;s portfolio is therefore understated by whatever their unmatched
        stores bill. Worth settling before these figures are used for pay.
      </p>
    </div>
  );
}
