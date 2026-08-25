"use client";

import { useState, useEffect, useRef } from "react";
import { Rep } from "@/lib/types";
import { useSession } from "@/components/SessionProvider";

interface GeocodeOutcome {
  repId: string;
  code: string;
  name: string;
  address: string;
  status: "saved" | "review" | "failed" | "skipped";
  reason: string;
  lat?: number;
  lng?: number;
  formattedAddress?: string;
}

interface GeocodeResponse {
  considered: number;
  saved: number;
  needsReview: number;
  failed: number;
  outcomes: GeocodeOutcome[];
}

interface CreateAccountOutcome {
  repId: string;
  code: string;
  name: string;
  email: string;
  status: "created" | "created_no_email" | "exists" | "skipped" | "failed";
  detail: string;
  tempPassword?: string;
}

interface CreateAccountResponse {
  requested: number;
  created: number;
  createdNoEmail: number;
  alreadyExisted: number;
  skipped: number;
  failed: number;
  outcomes: CreateAccountOutcome[];
}

interface RepImportChange {
  code: string;
  name: string;
  fields: string[];
}

interface RepImportResponse {
  preview: boolean;
  sheet: string;
  rowsRead: number;
  columnsPresent: string[];
  created: RepImportChange[];
  updated: RepImportChange[];
  unchanged: number;
  rejected: { row: number; reason: string }[];
  warnings: string[];
  nameDifferences: { code: string; current: string; inFile: string }[];
  saved: boolean;
}

/** A rep can only be given a login if there is somewhere to send it. */
function hasUsableEmail(rep: Rep): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((rep.email || "").trim());
}

/** A rep is anchored on their home only when BOTH coordinates are present. */
function hasHomeGps(rep: Rep): boolean {
  return !!(rep.homeGpsLat || "").trim() && !!(rep.homeGpsLng || "").trim();
}

/**
 * Opens whatever has been typed into a Home Address field in Google Maps, in a
 * new tab, so the person capturing it can see it resolves to a real place
 * before saving. Routes anchor on the rep's home, so a typo here quietly moves
 * someone's whole day.
 *
 * Declared at module level on purpose — a component defined inside RepsPage
 * would remount on every keystroke and steal focus from the address input.
 */
function CheckAddressOnGoogle({ address, compact = false }: { address?: string; compact?: boolean }) {
  const value = (address || "").trim();
  const open = () =>
    window.open(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`,
      "_blank",
      "noopener,noreferrer"
    );

  return (
    <button
      type="button"
      onClick={open}
      disabled={!value}
      title={value ? "Open this address in Google Maps to confirm it" : "Enter an address first"}
      className={`mt-1 inline-flex items-center gap-1 rounded border border-gray-200 font-medium text-clippa-red transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:border-gray-100 disabled:text-gray-300 ${
        compact ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-1 text-xs"
      }`}
    >
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" strokeLinejoin="round" />
        <circle cx="12" cy="10" r="2.5" />
      </svg>
      Check on Google
    </button>
  );
}

export default function RepsPage() {
  const { can } = useSession();
  const [reps, setReps] = useState<Rep[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Rep>>({});
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newRep, setNewRep] = useState<Partial<Rep>>({ code: "", name: "", email: "", cell: "", homeAddress: "", workingHoursPerDay: 8.5 });
  const [error, setError] = useState("");
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeResult, setGeocodeResult] = useState<GeocodeResponse | null>(null);
  const [geocodeError, setGeocodeError] = useState("");

  // Rep logins
  const [repIdsWithLogin, setRepIdsWithLogin] = useState<Set<string>>(new Set());
  const [creatingAccounts, setCreatingAccounts] = useState(false);
  const [accountResult, setAccountResult] = useState<CreateAccountResponse | null>(null);
  const [accountError, setAccountError] = useState("");

  // Excel import
  const importRef = useRef<HTMLInputElement>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<RepImportResponse | null>(null);
  const [importError, setImportError] = useState("");

  const canManageReps = can("manage_reps");
  const canCreateLogins = can("create_rep_accounts");

  // Reps who could be given a login right now: an email to send it to, and no
  // account yet. Reps with no email are shown as such rather than failing.
  const repsNeedingLogin = reps.filter((r) => hasUsableEmail(r) && !repIdsWithLogin.has(r.id));

  // Reps whose address is captured but whose route still anchors on a store
  // centroid because no coordinate was ever derived from it.
  const awaitingGeocode = reps.filter(
    (r) => (r.homeAddress || "").trim() && !hasHomeGps(r)
  ).length;

  const load = () => {
    fetch("/api/reps")
      .then((r) => r.json())
      .then((data) => {
        setReps(data);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadLogins(); }, [canCreateLogins]);

  /**
   * Which reps already have a login. Its own endpoint rather than /api/users,
   * because that one needs `manage_users` (superAdmin only) and an Admin still
   * has to be able to see who is missing an account.
   */
  const loadLogins = () => {
    if (!canCreateLogins) return;
    fetch("/api/reps/create-account")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.repIdsWithLogin)) setRepIdsWithLogin(new Set(d.repIdsWithLogin));
      })
      .catch(() => {
        /* the button simply stays available; the server refuses if it must */
      });
  };

  /**
   * Create logins for reps. Capped at 20 a request by the server so a batch
   * cannot outrun the send limit, so a bulk run is sent in chunks.
   */
  const createAccounts = async (repIds: string[]) => {
    if (repIds.length === 0) return;
    setCreatingAccounts(true);
    setAccountError("");
    setAccountResult(null);
    try {
      const merged: CreateAccountResponse = {
        requested: 0, created: 0, createdNoEmail: 0, alreadyExisted: 0, skipped: 0, failed: 0, outcomes: [],
      };
      for (let i = 0; i < repIds.length; i += 20) {
        const res = await fetch("/api/reps/create-account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repIds: repIds.slice(i, i + 20) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setAccountError(data.error || `Could not create logins (${res.status})`);
          return;
        }
        merged.requested += data.requested ?? 0;
        merged.created += data.created ?? 0;
        merged.createdNoEmail += data.createdNoEmail ?? 0;
        merged.alreadyExisted += data.alreadyExisted ?? 0;
        merged.skipped += data.skipped ?? 0;
        merged.failed += data.failed ?? 0;
        merged.outcomes.push(...(data.outcomes ?? []));
      }
      setAccountResult(merged);
      loadLogins();
    } catch (e) {
      setAccountError(String(e));
    } finally {
      setCreatingAccounts(false);
    }
  };

  /**
   * Preview first, always. The same upload both edits existing reps and creates
   * new ones, and nobody should find out which afterwards.
   */
  const runImport = async (file: File, preview: boolean) => {
    setImporting(true);
    setImportError("");
    if (preview) setImportResult(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`/api/reps/import${preview ? "?mode=preview" : ""}`, {
        method: "POST",
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setImportError(data.error || `Import failed (${res.status})`);
        return;
      }
      setImportResult(data);
      if (!preview) {
        setImportFile(null);
        load();
        loadLogins();
      }
    } catch (e) {
      setImportError(String(e));
    } finally {
      setImporting(false);
    }
  };



  /**
   * Derive home coordinates from home addresses. The route engine already
   * starts each day at the rep's home when it has one — this is what finally
   * gives it one. `force` re-submits a result the server held back as too
   * vague, once a human has looked at it.
   */
  const runGeocode = async (body: { all: true } | { repId: string; force?: boolean }) => {
    setGeocoding(true);
    setGeocodeError("");
    try {
      const res = await fetch("/api/reps/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGeocodeError(data.error || `Geocoding failed (${res.status})`);
        return;
      }
      // Merge single-rep results into any review list already on screen, so
      // accepting one row doesn't wipe the other rows still awaiting a decision.
      setGeocodeResult((prev) => {
        if (!prev || "all" in body) return data as GeocodeResponse;
        const incoming = (data as GeocodeResponse).outcomes;
        const byId = new Map(prev.outcomes.map((o) => [o.repId, o]));
        for (const o of incoming) byId.set(o.repId, o);
        const outcomes = [...byId.values()];
        return {
          considered: prev.considered,
          saved: outcomes.filter((o) => o.status === "saved").length,
          needsReview: outcomes.filter((o) => o.status === "review").length,
          failed: outcomes.filter((o) => o.status === "failed").length,
          outcomes,
        };
      });
      load();
    } catch (e) {
      setGeocodeError(String(e));
    } finally {
      setGeocoding(false);
    }
  };

  const startEdit = (rep: Rep) => {
    setEditing(rep.id);
    setEditData({ ...rep });
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditData({});
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    await fetch("/api/reps", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...editData }),
    });
    setEditing(null);
    setEditData({});
    setSaving(false);
    load();
  };

  const addRep = async () => {
    setSaving(true);
    setError("");
    const res = await fetch("/api/reps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newRep),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Failed to add rep");
      setSaving(false);
      return;
    }
    setShowAdd(false);
    setNewRep({ code: "", name: "", email: "", cell: "", homeAddress: "", workingHoursPerDay: 8.5 });
    setSaving(false);
    load();
  };

  const deleteRep = async (id: string) => {
    if (!confirm("Delete this rep?")) return;
    await fetch("/api/reps", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-clippa-red border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Sales Reps</h1>
          <p className="text-sm text-gray-500">{reps.length} reps</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/api/reps/export?format=xlsx"
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Export Excel
          </a>
          <a
            href="/api/reps/export?format=csv"
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Export CSV
          </a>
          {canManageReps && awaitingGeocode > 0 && (
            <button
              onClick={() => runGeocode({ all: true })}
              disabled={geocoding}
              title="Look up each rep's home address and store the coordinates, so routes start from home instead of the middle of their stores"
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {geocoding ? "Locating..." : `Set Home GPS (${awaitingGeocode})`}
            </button>
          )}
          {canCreateLogins && repsNeedingLogin.length > 0 && (
            <button
              onClick={() => createAccounts(repsNeedingLogin.map((r) => r.id))}
              disabled={creatingAccounts}
              title="Create a login for every rep who has an email address and does not have one yet, and email them their details"
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {creatingAccounts ? "Creating..." : `Create Logins (${repsNeedingLogin.length})`}
            </button>
          )}
          {canManageReps && (
            <>
              <input
                ref={importRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Cleared so choosing the SAME file twice still fires onChange.
                  e.target.value = "";
                  if (!file) return;
                  setImportFile(file);
                  runImport(file, true);
                }}
              />
              <button
                onClick={() => importRef.current?.click()}
                disabled={importing}
                title="Load a spreadsheet of rep codes, names and email addresses. Existing reps are updated, unknown codes are added."
                className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                {importing ? "Reading..." : "Import Excel"}
              </button>
            </>
          )}
          <button
            onClick={() => setShowAdd(true)}
            className="bg-clippa-red text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
          >
            + Add Rep
          </button>
        </div>
      </div>

      {geocodeError && (
        <div className="p-3 rounded-lg text-sm mb-6 bg-red-50 text-red-700">{geocodeError}</div>
      )}

      {importError && (
        <div className="p-3 rounded-lg text-sm mb-6 bg-red-50 text-red-700">{importError}</div>
      )}

      {/* Import report. What was NOT done is said as loudly as what was — a
          cut-down sheet importing "nothing" for a field otherwise reads as a
          failed import. */}
      {importResult && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">
                {importResult.preview ? "Preview: " : "Imported: "}
                {importResult.created.length} new rep{importResult.created.length === 1 ? "" : "s"},{" "}
                {importResult.updated.length} updated, {importResult.unchanged} unchanged
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Read {importResult.rowsRead} rows from &quot;{importResult.sheet}&quot;. Columns in the file:{" "}
                {importResult.columnsPresent.length > 0 ? importResult.columnsPresent.join(", ") : "rep code only"}.
                Any column the file does not carry is left untouched on every rep.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {importResult.preview && importFile && (importResult.created.length > 0 || importResult.updated.length > 0) && (
                <button
                  onClick={() => runImport(importFile, false)}
                  disabled={importing}
                  className="bg-clippa-red text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-700 disabled:opacity-50"
                >
                  {importing ? "Applying..." : "Apply these changes"}
                </button>
              )}
              <button onClick={() => setImportResult(null)} className="text-gray-400 hover:text-gray-600 text-xs">
                Dismiss
              </button>
            </div>
          </div>

          {importResult.warnings.length > 0 && (
            <ul className="mb-3 space-y-1">
              {importResult.warnings.map((w, i) => (
                <li key={i} className="text-xs text-amber-800 bg-amber-50 rounded px-2 py-1.5">{w}</li>
              ))}
            </ul>
          )}

          {importResult.rejected.length > 0 && (
            <ul className="mb-3 space-y-1">
              {importResult.rejected.map((r, i) => (
                <li key={i} className="text-xs text-red-700 bg-red-50 rounded px-2 py-1.5">
                  Row {r.row}: {r.reason}
                </li>
              ))}
            </ul>
          )}

          {importResult.nameDifferences.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-medium text-gray-700 mb-1">
                Names that differ from the file ({importResult.nameDifferences.length}), reported but not changed.
                A different name on the same code can mean the code was handed to someone else.
              </p>
              <ul className="space-y-0.5 max-h-40 overflow-y-auto">
                {importResult.nameDifferences.map((n) => (
                  <li key={n.code} className="text-xs text-gray-600">
                    <span className="font-mono">{n.code}</span>: here &quot;{n.current}&quot;, in the file &quot;{n.inFile}&quot;
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(importResult.created.length > 0 || importResult.updated.length > 0) && (
            <div className="max-h-60 overflow-y-auto border-t border-gray-100 pt-2">
              {importResult.created.map((c) => (
                <p key={`c-${c.code}`} className="text-xs text-gray-600 py-0.5">
                  <span className="inline-block w-14 font-semibold text-green-700">NEW</span>
                  <span className="font-mono">{c.code}</span> {c.name}: {c.fields.join(", ")}
                </p>
              ))}
              {importResult.updated.map((u) => (
                <p key={`u-${u.code}`} className="text-xs text-gray-600 py-0.5">
                  <span className="inline-block w-14 font-semibold text-gray-500">UPDATED</span>
                  <span className="font-mono">{u.code}</span> {u.name}: {u.fields.join(", ")}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {accountError && (
        <div className="p-3 rounded-lg text-sm mb-6 bg-red-50 text-red-700">{accountError}</div>
      )}

      {/* Login results. A password only ever appears here when the email failed
          — on success it is in the rep's inbox and a copy on this screen is one
          nobody needs. */}
      {accountResult && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
          <div className="flex items-start justify-between gap-4 mb-3">
            <h3 className="font-semibold text-gray-900 text-sm">
              Logins: {accountResult.created} created and emailed
              {accountResult.createdNoEmail > 0 && `, ${accountResult.createdNoEmail} created but NOT emailed`}
              {accountResult.alreadyExisted > 0 && `, ${accountResult.alreadyExisted} already had one`}
              {accountResult.skipped > 0 && `, ${accountResult.skipped} skipped`}
              {accountResult.failed > 0 && `, ${accountResult.failed} failed`}
            </h3>
            <button onClick={() => setAccountResult(null)} className="text-gray-400 hover:text-gray-600 text-xs">
              Dismiss
            </button>
          </div>
          <div className="max-h-60 overflow-y-auto space-y-1">
            {accountResult.outcomes.map((o) => (
              <div key={o.repId + o.email} className="text-xs">
                <span className="font-mono text-gray-500">{o.code}</span>{" "}
                <span className="text-gray-800">{o.name}</span>{" "}
                <span className="text-gray-500">{o.detail}</span>
                {o.tempPassword && (
                  <span className="ml-1 font-mono font-semibold text-clippa-red">{o.tempPassword}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}



      {/* Geocoding results. Vague matches are listed rather than saved — a
          suburb centroid looks identical to a real home once it is stored. */}
      {geocodeResult && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">
                Home GPS: {geocodeResult.saved} saved
                {geocodeResult.needsReview > 0 && `, ${geocodeResult.needsReview} need checking`}
                {geocodeResult.failed > 0 && `, ${geocodeResult.failed} not found`}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Saved reps now start their day at home. Anything below was too vague to
                store on its own: check it on Google, then accept it or fix the address.
              </p>
            </div>
            <button
              onClick={() => setGeocodeResult(null)}
              className="text-xs text-gray-400 hover:text-gray-600 flex-shrink-0"
            >
              dismiss
            </button>
          </div>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {geocodeResult.outcomes
              .filter((o) => o.status !== "saved")
              .map((o) => (
                <div
                  key={o.repId}
                  className={`p-3 rounded-lg text-xs ${
                    o.status === "review" ? "bg-amber-50" : "bg-red-50"
                  }`}
                >
                  <div className="font-medium text-gray-900">
                    {o.name} <span className="font-mono text-gray-500">({o.code})</span>
                  </div>
                  <div className="text-gray-600 mt-0.5">Captured: {o.address}</div>
                  <div className={o.status === "review" ? "text-amber-700 mt-0.5" : "text-red-700 mt-0.5"}>
                    {o.reason}
                  </div>
                  {o.status === "review" && (
                    <div className="mt-2 flex items-center gap-3">
                      <CheckAddressOnGoogle address={o.address} compact />
                      <button
                        onClick={() => runGeocode({ repId: o.repId, force: true })}
                        disabled={geocoding}
                        className="mt-1 px-1.5 py-0.5 text-[11px] font-medium rounded border border-amber-300 text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                      >
                        Use it anyway
                      </button>
                    </div>
                  )}
                </div>
              ))}
            {geocodeResult.outcomes.every((o) => o.status === "saved") && (
              <p className="text-xs text-gray-500">Every address resolved cleanly. Nothing to check.</p>
            )}
          </div>
          <p className="text-xs text-amber-700 mt-3">
            Routes already generated still use the old anchor, so regenerate them to pick this up.
          </p>
        </div>
      )}

      {/* Add Rep Form */}
      {showAdd && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
          <h3 className="font-semibold text-gray-900 mb-4">New Rep</h3>
          <div className="grid grid-cols-2 gap-4">
            {[
              { key: "code", label: "Rep Code", placeholder: "e.g. GAU099" },
              { key: "name", label: "Full Name", placeholder: "Name Surname" },
              { key: "email", label: "Email", placeholder: "email@company.com" },
              { key: "cell", label: "Cell Number", placeholder: "+27..." },
              { key: "homeAddress", label: "Home Address", placeholder: "Street, City" },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                <input
                  value={(newRep as Record<string, string>)[key] || ""}
                  onChange={(e) => setNewRep({ ...newRep, [key]: e.target.value })}
                  placeholder={placeholder}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red"
                />
                {key === "homeAddress" && <CheckAddressOnGoogle address={newRep.homeAddress} />}
              </div>
            ))}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Hours/Day</label>
              <input
                type="number"
                step={0.5}
                min={4}
                max={12}
                value={newRep.workingHoursPerDay ?? 8.5}
                onChange={(e) => setNewRep({ ...newRep, workingHoursPerDay: parseFloat(e.target.value) || 8.5 })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red"
              />
            </div>
          </div>
          {error && (
            <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
          )}
          <div className="mt-4 flex gap-2">
            <button
              onClick={addRep}
              disabled={saving}
              className="bg-clippa-red text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Rep"}
            </button>
            <button
              onClick={() => { setShowAdd(false); setError(""); }}
              className="text-gray-500 px-4 py-2 rounded-lg text-sm hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Reps Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-6 py-3">Code</th>
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Email</th>
                <th className="px-6 py-3">Cell</th>
                <th className="px-6 py-3">Home Address</th>
                <th className="px-6 py-3">Starts Day At</th>
                <th className="px-6 py-3">Login</th>
                <th className="px-6 py-3 text-center">Hours/Day</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reps.map((rep) => (
                <tr key={rep.id} className="hover:bg-gray-50">
                  {editing === rep.id ? (
                    <>
                      <td className="px-6 py-3">
                        <input
                          value={editData.code || ""}
                          onChange={(e) => setEditData({ ...editData, code: e.target.value })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-24 focus:outline-none focus:ring-1 focus:ring-clippa-red"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <input
                          value={editData.name || ""}
                          onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-clippa-red"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <input
                          value={editData.email || ""}
                          onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-clippa-red"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <input
                          value={editData.cell || ""}
                          onChange={(e) => setEditData({ ...editData, cell: e.target.value })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-32 focus:outline-none focus:ring-1 focus:ring-clippa-red"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <input
                          value={editData.homeAddress || ""}
                          onChange={(e) => setEditData({ ...editData, homeAddress: e.target.value })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-clippa-red"
                        />
                        <CheckAddressOnGoogle address={editData.homeAddress} compact />
                      </td>
                      <td className="px-6 py-3 text-xs text-gray-400 italic">
                        Save, then Set Home GPS
                      </td>
                      <td className="px-6 py-3 text-xs text-gray-400 italic">save first</td>
                      <td className="px-6 py-3 text-center">
                        <input
                          type="number"
                          step={0.5}
                          min={4}
                          max={12}
                          value={editData.workingHoursPerDay ?? 8.5}
                          onChange={(e) => setEditData({ ...editData, workingHoursPerDay: parseFloat(e.target.value) || 8.5 })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-16 text-center focus:outline-none focus:ring-1 focus:ring-clippa-red"
                        />
                      </td>
                      <td className="px-6 py-3 text-right space-x-2">
                        <button onClick={() => saveEdit(rep.id)} disabled={saving} className="text-green-600 hover:text-green-800 text-xs font-medium">
                          Save
                        </button>
                        <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600 text-xs font-medium">
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-6 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-gray-100 text-gray-700">
                          {rep.code}
                        </span>
                      </td>
                      <td className="px-6 py-3 font-medium text-gray-900">{rep.name}</td>
                      <td className="px-6 py-3 text-gray-600">{rep.email || <span className="text-gray-300 italic">Not set</span>}</td>
                      <td className="px-6 py-3 text-gray-600">{rep.cell || <span className="text-gray-300 italic">Not set</span>}</td>
                      <td className="px-6 py-3 text-gray-600 max-w-[200px] truncate">{rep.homeAddress || <span className="text-gray-300 italic">Not set</span>}</td>
                      {/* Never blank: falling back to the store centroid IS the
                          behaviour, and a rep silently anchored in the middle of
                          their patch is the thing worth seeing at a glance. */}
                      <td className="px-6 py-3 text-xs">
                        {hasHomeGps(rep) ? (
                          <span className="text-gray-600" title={`${rep.homeGpsLat}, ${rep.homeGpsLng}`}>
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-green-50 text-green-700 font-medium">
                              Home
                            </span>
                            <span className="block text-gray-400 font-mono mt-0.5">
                              {parseFloat(rep.homeGpsLat).toFixed(4)}, {parseFloat(rep.homeGpsLng).toFixed(4)}
                            </span>
                          </span>
                        ) : (
                          <span className="text-gray-500">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                              Store centroid
                            </span>
                            {canManageReps && (rep.homeAddress || "").trim() && (
                              <button
                                onClick={() => runGeocode({ repId: rep.id })}
                                disabled={geocoding}
                                className="block mt-1 text-clippa-red hover:underline disabled:opacity-50"
                              >
                                Set from address
                              </button>
                            )}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-xs">
                        {repIdsWithLogin.has(rep.id) ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-medium">
                            Has login
                          </span>
                        ) : !hasUsableEmail(rep) ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                            No email
                          </span>
                        ) : canCreateLogins ? (
                          <button
                            onClick={() => createAccounts([rep.id])}
                            disabled={creatingAccounts}
                            title="Create a login for this rep and email them their sign-in details"
                            className="text-clippa-red hover:underline font-medium disabled:opacity-50"
                          >
                            Create login
                          </button>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-center text-gray-600">{rep.workingHoursPerDay ?? 8.5}</td>
                      <td className="px-6 py-3 text-right space-x-2">
                        <button onClick={() => startEdit(rep)} className="text-clippa-red hover:text-red-800 text-xs font-medium">
                          Edit
                        </button>
                        <button onClick={() => deleteRep(rep.id)} className="text-gray-400 hover:text-red-600 text-xs font-medium">
                          Delete
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
