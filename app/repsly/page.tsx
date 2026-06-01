"use client";

import { useState, useEffect, useCallback } from "react";
import { RepslySyncLogEntry } from "@/lib/types";

interface SyncConfig {
  apiKey: string;
  apiPasscode: string;
  enabled: boolean;
  lastClientSync: string | null;
  lastVisitSync: string | null;
  lastWorkingTimeSync: string | null;
  lastRepSync: string | null;
}

type SyncType = "clients" | "visits" | "working_time" | "reps";

const SYNC_TYPES: { type: SyncType; label: string; description: string }[] = [
  { type: "visits", label: "Visits", description: "Actual field visits from Repsly" },
  { type: "clients", label: "Clients", description: "Match Repsly clients to stores, update GPS" },
  { type: "working_time", label: "Working Time", description: "Daily hours, mileage, time at client" },
  { type: "reps", label: "Reps", description: "Match and update rep names/contact" },
];

export default function RepslyPage() {
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [logs, setLogs] = useState<RepslySyncLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [syncingType, setSyncingType] = useState<SyncType | null>(null);
  const [syncResult, setSyncResult] = useState<{ type: string; msg: string; ok: boolean } | null>(null);

  // Editable fields (not masked)
  const [editKey, setEditKey] = useState("");
  const [editPasscode, setEditPasscode] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [showPasscode, setShowPasscode] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [cfgRes, logRes] = await Promise.all([
        fetch("/api/repsly/config"),
        fetch("/api/repsly/logs"),
      ]);
      if (cfgRes.ok) {
        const cfg = await cfgRes.json();
        setConfig(cfg);
        setEditKey(cfg.apiKey || "");
        setEditPasscode("");
      }
      if (logRes.ok) {
        const l = await logRes.json();
        setLogs(Array.isArray(l) ? l : []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSave = async () => {
    setSaving(true);
    setTestResult(null);
    const body: Record<string, unknown> = {};
    // Only send key if it's not the masked version
    if (editKey && !editKey.includes("*")) body.apiKey = editKey;
    if (editPasscode) body.apiPasscode = editPasscode;
    body.enabled = config?.enabled ?? false;

    const res = await fetch("/api/repsly/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) setTestResult({ ok: true, msg: "Credentials saved" });
    else setTestResult({ ok: false, msg: "Failed to save" });
    setSaving(false);
    loadData();
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const body: Record<string, unknown> = { test: true };
    if (editKey && !editKey.includes("*")) body.apiKey = editKey;
    if (editPasscode) body.apiPasscode = editPasscode;

    const res = await fetch("/api/repsly/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.connected) {
      setTestResult({ ok: true, msg: "Connected to Repsly" });
    } else {
      setTestResult({ ok: false, msg: data.error || "Connection failed" });
    }
    setTesting(false);
    loadData();
  };

  const handleSync = async (type: SyncType, mode: "test" | "import") => {
    setSyncingType(type);
    setSyncResult(null);
    try {
      const res = await fetch("/api/repsly/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, mode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSyncResult({ type, ok: false, msg: data.error || "Sync failed" });
      } else if (mode === "test") {
        setSyncResult({
          type,
          ok: true,
          msg: `Found ${data.recordsFound} records`,
        });
      } else {
        setSyncResult({
          type,
          ok: true,
          msg: `Imported ${data.recordsImported}, skipped ${data.recordsSkipped}`,
        });
      }
    } catch (err) {
      setSyncResult({ type, ok: false, msg: err instanceof Error ? err.message : "Error" });
    }
    setSyncingType(null);
    // Refresh logs + config (for last sync timestamps)
    loadData();
  };

  const fmtDate = (d: string | null) => {
    if (!d) return "Never";
    return new Date(d).toLocaleString("en-ZA", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const lastSyncFor = (type: SyncType): string | null => {
    if (!config) return null;
    if (type === "visits") return config.lastVisitSync;
    if (type === "clients") return config.lastClientSync;
    if (type === "working_time") return config.lastWorkingTimeSync;
    if (type === "reps") return config.lastRepSync;
    return null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-clippa-red border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Repsly Integration</h1>
        <p className="text-sm text-gray-500 mt-1">
          Connect to Repsly to pull actual visit data for planned vs actual reporting.
        </p>
      </div>

      {/* Section 1: API Connection */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-semibold text-gray-900 mb-4">API Connection</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={editKey}
                onChange={(e) => setEditKey(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm pr-10"
                placeholder="Enter Repsly API key"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {showKey ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  )}
                </svg>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">API Passcode</label>
            <div className="relative">
              <input
                type={showPasscode ? "text" : "password"}
                value={editPasscode}
                onChange={(e) => setEditPasscode(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm pr-10"
                placeholder={config?.apiPasscode ? "Leave blank to keep current" : "Enter Repsly API passcode"}
              />
              <button
                type="button"
                onClick={() => setShowPasscode(!showPasscode)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {showPasscode ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  )}
                </svg>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleTest}
              disabled={testing}
              className="px-4 py-2 bg-clippa-red text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
            >
              {testing ? "Testing..." : "Test Connection"}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Credentials"}
            </button>
            {testResult && (
              <span className={`text-sm font-medium ${testResult.ok ? "text-green-600" : "text-red-600"}`}>
                {testResult.ok ? "\u2713" : "\u2717"} {testResult.msg}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Section 2: Sync Controls */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Sync Controls</h2>
        <div className="space-y-3">
          {SYNC_TYPES.map((st) => (
            <div
              key={st.type}
              className="flex items-center justify-between p-4 border border-gray-200 rounded-lg"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 text-sm">{st.label}</span>
                  <span className="text-xs text-gray-400">
                    Last sync: {fmtDate(lastSyncFor(st.type))}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{st.description}</p>
                {syncResult && syncResult.type === st.type && (
                  <p className={`text-xs mt-1 font-medium ${syncResult.ok ? "text-green-600" : "text-red-600"}`}>
                    {syncResult.ok ? "\u2713" : "\u2717"} {syncResult.msg}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleSync(st.type, "test")}
                  disabled={syncingType !== null}
                  className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
                >
                  {syncingType === st.type ? "..." : "Test"}
                </button>
                <button
                  onClick={() => handleSync(st.type, "import")}
                  disabled={syncingType !== null}
                  className="px-3 py-1.5 bg-clippa-red text-white rounded-lg text-xs font-medium hover:bg-red-700 disabled:opacity-50"
                >
                  {syncingType === st.type ? "Syncing..." : "Import"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Section 3: Sync Log */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Sync Log</h2>
        {logs.length === 0 ? (
          <p className="text-sm text-gray-400">No sync history yet.</p>
        ) : (
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-2 text-left">Time</th>
                  <th className="px-4 py-2 text-left">Type</th>
                  <th className="px-4 py-2 text-right">Imported</th>
                  <th className="px-4 py-2 text-right">Skipped</th>
                  <th className="px-4 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map((entry, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{fmtDate(entry.timestamp)}</td>
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                        {entry.type.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right text-gray-600">{entry.recordsImported}</td>
                    <td className="px-4 py-2 text-right text-gray-400">{entry.recordsSkipped}</td>
                    <td className="px-4 py-2">
                      {entry.error ? (
                        <span className="text-red-600 text-xs">{entry.error}</span>
                      ) : (
                        <span className="text-green-600 text-xs">OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
