"use client";

import { useState, useEffect, useRef } from "react";
import { Channel, FREQUENCY_OPTIONS, FrequencyType, getFrequencyLabel, CHANNEL_SOURCE_LABEL } from "@/lib/types";
import { useTableSort, useSortedRows, SortableTh } from "@/components/TableSort";
import { storeCountsByChannel } from "@/lib/routable";

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const sort = useTableSort("name", "asc", ["duration", "storeCount"]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Channel>>({});
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFreq, setNewFreq] = useState<FrequencyType>("monthly");
  const [newDuration, setNewDuration] = useState(30);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyPreview, setApplyPreview] = useState<{
    totalStores: number;
    wouldChange: number;
    keptOverridden: number;
    manualEditsProtected: number;
    byChannel: { name: string; count: number; to: string }[];
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    fetch("/api/channels")
      .then((r) => r.json())
      .then((data) => {
        setChannels(data);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, []);

  /**
   * How many stores sit in each channel, and how many of those an approved
   * Call Override would keep in the cycle anyway.
   *
   * Loaded alongside the channels because the count is what makes the toggle
   * safe to press: it is the difference between excluding a channel and
   * excluding 1 484 stores.
   */
  const [storeCounts, setStoreCounts] = useState<Map<string, { total: number; open: number; excused: number }>>(new Map());

  useEffect(() => {
    Promise.all([
      fetch("/api/stores").then((r) => r.json()).catch(() => []),
      fetch("/api/store-overrides").then((r) => r.json()).catch(() => ({ overrides: [] })),
    ]).then(([st, ov]) => {
      const stores = Array.isArray(st) ? st : [];
      const overrides = Array.isArray(ov) ? ov : Array.isArray(ov?.overrides) ? ov.overrides : [];
      setStoreCounts(storeCountsByChannel(stores, overrides));
    });
  }, []);

  /**
   * Turn routing for a channel on or off.
   *
   * Confirmed on the way OUT of the cycle and not on the way back in: removing
   * a thousand shops from every rep's week is the change worth being sure
   * about, and making the reverse equally tedious just discourages fixing a
   * mistake.
   */
  const toggleRepChannel = async (ch: Channel) => {
    const open = storeCounts.get(ch.id)?.open ?? 0;
    const excused = storeCounts.get(ch.id)?.excused ?? 0;
    if (!ch.notARepChannel) {
      const affected = open - excused;
      const ok = confirm(
        `Stop routing anyone to ${ch.name}?\n\n` +
          `${affected.toLocaleString("en-ZA")} open store${affected === 1 ? "" : "s"} would leave every call cycle.` +
          (excused > 0
            ? `\n${excused} with an approved Call Override would stay in.`
            : "") +
          `\n\nRegenerate routes afterwards for this to reach the reps.`
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ch.id, notARepChannel: !ch.notARepChannel }),
      });
      if (!res.ok) throw new Error("Could not save that channel.");
      setImportMsg({
        type: "success",
        text: !ch.notARepChannel
          ? `${ch.name} is no longer a rep channel. Regenerate routes to take its stores out of the cycles.`
          : `${ch.name} is a rep channel again. Regenerate routes to put its stores back.`,
      });
      load();
    } catch (err) {
      setImportMsg({ type: "error", text: String(err) });
    } finally {
      setSaving(false);
    }
  };
  /**
   * Channels IMS uses that this app has never heard of.
   *
   * Preview first, always. IMS carries "INDEPENDANT" and "INDEPANDANT" beside
   * "INDEPENDENT", and a channel literally named "GAUTENG" — importing blindly
   * would turn the client's typos into permanent channels that stores then get
   * filed under, and there is no undo for that worth the name.
   */
  interface ImsCandidate { name: string; outlets: number; looksLike: string | null }
  const [imsBusy, setImsBusy] = useState(false);
  const [imsCandidates, setImsCandidates] = useState<ImsCandidate[] | null>(null);
  const [imsChosen, setImsChosen] = useState<Set<string>>(new Set());

  const previewImsChannels = async () => {
    setImsBusy(true);
    setImportMsg(null);
    try {
      const res = await fetch("/api/channels/from-ims", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setImportMsg({ type: "error", text: data.error || "Could not read the IMS channel list." });
        return;
      }
      setImsCandidates(data.candidates ?? []);
      // 🔴 Nothing is ticked by default, and the near-duplicates least of all.
      // A preview that arrives pre-selected is just an import with an extra
      // click, which is not what a preview is for.
      setImsChosen(new Set());
      if ((data.candidates ?? []).length === 0) {
        setImportMsg({ type: "success", text: "Every channel IMS uses is already on this page." });
      }
    } catch (err) {
      setImportMsg({ type: "error", text: String(err) });
    } finally {
      setImsBusy(false);
    }
  };

  const applyImsChannels = async () => {
    if (imsChosen.size === 0) return;
    setImsBusy(true);
    try {
      const res = await fetch("/api/channels/from-ims?mode=apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names: [...imsChosen] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setImportMsg({ type: "error", text: data.error || "Could not create those channels." });
        return;
      }
      setImportMsg({
        type: "success",
        text: `Created ${data.created.length} channel${data.created.length === 1 ? "" : "s"}. ${data.note}`,
      });
      setImsCandidates(null);
      setImsChosen(new Set());
      load();
    } catch (err) {
      setImportMsg({ type: "error", text: String(err) });
    } finally {
      setImsBusy(false);
    }
  };
  const startEdit = (ch: Channel) => {
    setEditing(ch.id);
    setEditData({ name: ch.name, frequency: ch.frequency, duration: ch.duration });
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditData({});
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    const res = await fetch("/api/channels", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...editData }),
    });
    const data = await res.json().catch(() => ({}));
    setEditing(null);
    setEditData({});
    setSaving(false);
    // Say what happened to the STORES. A channel edit that reports nothing is
    // how "BUCO is set to 120 minutes but every store still says 30" went
    // unnoticed for so long.
    if (res.ok && typeof data.storesUpdated === "number") {
      setImportMsg(
        data.storesUpdated > 0
          ? {
              type: "success",
              text: `Updated ${data.storesUpdated} store${data.storesUpdated === 1 ? "" : "s"} in this channel${data.storesPinned ? `; ${data.storesPinned} kept their own override` : ""}.`,
            }
          : { type: "success", text: "Channel saved. No stores needed changing." }
      );
    }
    load();
  };

  const previewDefaults = async () => {
    setApplyBusy(true);
    setApplyPreview(null);
    try {
      const res = await fetch("/api/channels/apply-defaults", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setImportMsg({ type: "error", text: data.error || "Could not read defaults" });
        return;
      }
      setApplyPreview(data);
    } finally {
      setApplyBusy(false);
    }
  };

  const applyDefaults = async () => {
    setApplyBusy(true);
    try {
      const res = await fetch("/api/channels/apply-defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protectManualEdits: true }),
      });
      const data = await res.json();
      setImportMsg(
        res.ok
          ? {
              type: "success",
              text: `Applied channel defaults to ${data.storesUpdated} store(s). ${data.keptOverridden} kept an existing override; ${data.overridesCreated} manual edit(s) preserved.`,
            }
          : { type: "error", text: data.error || "Failed to apply defaults" }
      );
      setApplyPreview(null);
    } finally {
      setApplyBusy(false);
    }
  };

  const addChannel = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    await fetch("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), frequency: newFreq, duration: newDuration }),
    });
    setNewName("");
    setNewFreq("monthly");
    setNewDuration(30);
    setShowAdd(false);
    setAdding(false);
    load();
  };

  const deleteChannel = async (id: string, name: string) => {
    if (!confirm(`Delete channel "${name}"? This cannot be undone.`)) return;
    await fetch("/api/channels", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    load();
  };

  const filteredChannels = channels.filter((ch) =>
    ch.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  const filtered = useSortedRows<Channel>(filteredChannels, {
    name: (c) => c.name,
    frequency: (c) => getFrequencyLabel(c.frequency),
    duration: (c) => c.duration ?? null,
    storeCount: (c) => storeCounts.get(c.id)?.open ?? 0,
    // Excluded channels group together, which is the whole point of sorting on it.
    routed: (c) => (c.notARepChannel ? "Not a rep channel" : "Reps call here"),
    source: (c) => (c.source ? CHANNEL_SOURCE_LABEL[c.source] : "Not recorded"),
  }, sort);

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((ch) => selected.has(ch.id));

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filtered.forEach((ch) => next.delete(ch.id));
      } else {
        filtered.forEach((ch) => next.add(ch.id));
      }
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const deleteSelected = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} channel${ids.length > 1 ? "s" : ""}? This cannot be undone.`)) return;
    setBulkDeleting(true);
    await fetch("/api/channels", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    setSelected(new Set());
    setBulkDeleting(false);
    load();
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    setImportMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/channels/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setImportMsg({ text: data.error || "Import failed", type: "error" });
        return;
      }
      const parts: string[] = [];
      if (data.updated) parts.push(`${data.updated} updated`);
      if (data.created) parts.push(`${data.created} created`);
      if (data.errors?.length) parts.push(`${data.errors.length} error${data.errors.length > 1 ? "s" : ""}`);
      if (!data.updated && !data.created && !data.errors?.length) parts.push("No changes");
      setImportMsg({
        text: parts.join(", ") + (data.errors?.length ? ": " + data.errors.join("; ") : ""),
        type: data.errors?.length && !data.updated && !data.created ? "error" : "success",
      });
      load();
    } catch {
      setImportMsg({ text: "Import failed", type: "error" });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
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
          <h1 className="text-xl font-bold text-gray-900">Channels</h1>
          <p className="text-sm text-gray-500">
            {channels.length} channels configured
            {search.trim() && ` · ${filtered.length} match${filtered.length === 1 ? "" : "es"}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/api/channels/export"
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Export Excel
          </a>
          <label
            className={`px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 cursor-pointer transition-colors ${importing ? "opacity-50 pointer-events-none" : ""}`}
          >
            {importing ? "Importing..." : "Import Excel"}
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImport(f);
              }}
            />
          </label>
          {/* The cascade existed but nothing invoked it: previewDefaults was
              defined and never called, so 'Apply defaults to stores' has been
              unreachable in this app since the feature was ported. */}
          <button
            onClick={previewImsChannels}
            disabled={imsBusy}
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            title="Find channels IMS uses that this app does not have. Shows a preview first; nothing is created until you choose."
          >
            {imsBusy ? "Checking IMS..." : "Add channels from IMS"}
          </button>
          <button
            onClick={previewDefaults}
            disabled={applyBusy}
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            title="Push every channel's frequency and duration onto its stores. Shows a preview first."
          >
            {applyBusy ? "Checking..." : "Apply defaults to stores"}
          </button>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-2 px-4 py-2 bg-clippa-red text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Channel
          </button>
        </div>
      </div>

      {/* Import message */}
      {importMsg && (
        <div
          className={`p-3 rounded-lg text-sm mb-6 flex items-center justify-between ${
            importMsg.type === "success"
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          <span>{importMsg.text}</span>
          <button onClick={() => setImportMsg(null)} className="text-xs opacity-60 hover:opacity-100 ml-4">dismiss</button>
        </div>
      )}

      {/* Apply-defaults preview — always shown before anything is written */}
      {applyPreview && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-800 mb-1">
            Apply channel defaults to stores
          </h3>
          <p className="text-xs text-gray-500 mb-4">
            A channel&apos;s frequency and duration are defaults that live on each store. Stores
            that drifted from their channel are listed below.
          </p>

          {applyPreview.wouldChange === 0 ? (
            <p className="text-sm text-gray-600">
              Every store already matches its channel. Nothing to do.
            </p>
          ) : (
            <>
              <div className="max-h-56 overflow-y-auto border border-gray-100 rounded-lg mb-4">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">Channel</th>
                      <th className="px-3 py-2 text-right">Stores</th>
                      <th className="px-3 py-2 text-left">Will be set to</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {applyPreview.byChannel.map((c) => (
                      <tr key={c.name}>
                        <td className="px-3 py-1.5 text-gray-700">{c.name}</td>
                        <td className="px-3 py-1.5 text-right text-gray-600">{c.count}</td>
                        <td className="px-3 py-1.5 text-gray-600">{c.to}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-gray-500 mb-4">
                <span className="font-medium text-gray-700">{applyPreview.wouldChange}</span> of{" "}
                {applyPreview.totalStores} stores will change.{" "}
                {applyPreview.keptOverridden} store(s) have a call override and are left alone.{" "}
                {applyPreview.manualEditsProtected > 0 && (
                  <>
                    {applyPreview.manualEditsProtected} store(s) look hand-edited and will be kept
                    as-is — an override record is created for each so they stay protected.
                  </>
                )}
              </p>

              <div className="flex gap-3">
                <button
                  onClick={applyDefaults}
                  disabled={applyBusy}
                  className="px-4 py-2 bg-clippa-red text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {applyBusy ? "Applying..." : `Apply to ${applyPreview.wouldChange} store(s)`}
                </button>
                <button
                  onClick={() => setApplyPreview(null)}
                  className="px-4 py-2 text-gray-500 text-sm font-medium hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Add Channel Form */}
      {showAdd && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">New Channel</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Channel Name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Pick n Pay"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Default Frequency</label>
              <select
                value={newFreq}
                onChange={(e) => setNewFreq(e.target.value as FrequencyType)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red"
              >
                {FREQUENCY_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Duration (min)</label>
              <input
                type="number"
                value={newDuration}
                onChange={(e) => setNewDuration(Number(e.target.value))}
                min={5}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red"
              />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button
              onClick={addChannel}
              disabled={adding || !newName.trim()}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {adding ? "Saving..." : "Save Channel"}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="px-4 py-2 text-gray-500 text-sm font-medium hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Search + bulk actions */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search channels..."
            className="w-full border border-gray-200 rounded-lg pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>

        {selected.size > 0 && (
          <div className="flex items-center gap-3 sm:ml-auto bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            <span className="text-sm text-gray-600">{selected.size} selected</span>
            <button
              onClick={deleteSelected}
              disabled={bulkDeleting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-clippa-red text-white text-xs font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              {bulkDeleting ? "Deleting..." : `Delete selected`}
            </button>
            <button
              onClick={clearSelection}
              className="text-gray-400 hover:text-gray-600 text-xs font-medium"
            >
              Clear
            </button>
          </div>
        )}
      </div>


      {/* What would be created, before anything is. */}
      {imsCandidates && imsCandidates.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {imsCandidates.length} channel{imsCandidates.length === 1 ? "" : "s"} in IMS that this app does not have
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Tick the ones to create. New channels arrive as Once a Month, 30 minutes, and
                {" "}<strong>reps do call on them</strong> until you say otherwise.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => { setImsCandidates(null); setImsChosen(new Set()); }}
                className="text-xs text-gray-400 hover:text-gray-700 px-2 py-1"
              >
                Cancel
              </button>
              <button
                onClick={applyImsChannels}
                disabled={imsBusy || imsChosen.size === 0}
                className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-700 disabled:opacity-40"
              >
                {imsBusy ? "Creating..." : `Create ${imsChosen.size} channel${imsChosen.size === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto border border-gray-100 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500 uppercase sticky top-0">
                <tr>
                  <th className="px-3 py-2 w-8"></th>
                  <th className="px-3 py-2 text-left">IMS channel</th>
                  <th className="px-3 py-2 text-right">Outlets in IMS</th>
                  <th className="px-3 py-2 text-left">Careful</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {imsCandidates.map((c) => (
                  <tr key={c.name} className={c.looksLike ? "bg-amber-50/40" : ""}>
                    <td className="px-3 py-1.5">
                      <input
                        type="checkbox"
                        checked={imsChosen.has(c.name)}
                        onChange={() => {
                          const next = new Set(imsChosen);
                          if (next.has(c.name)) next.delete(c.name);
                          else next.add(c.name);
                          setImsChosen(next);
                        }}
                        className="w-4 h-4 rounded border-gray-300 text-clippa-red focus:ring-clippa-red cursor-pointer align-middle"
                        aria-label={`Create ${c.name}`}
                      />
                    </td>
                    <td className="px-3 py-1.5 font-medium text-gray-800">{c.name}</td>
                    <td className="px-3 py-1.5 text-right text-gray-600">{c.outlets.toLocaleString("en-ZA")}</td>
                    <td className="px-3 py-1.5 text-amber-700">
                      {c.looksLike ? `Looks like a spelling of "${c.looksLike}" — creating it would split the same shops across two channels` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-6 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    className="w-4 h-4 rounded border-gray-300 text-clippa-red focus:ring-clippa-red cursor-pointer align-middle"
                    aria-label="Select all"
                  />
                </th>
                <th className="px-6 py-3 w-8">#</th>
                <SortableTh sortId="name" sort={sort} className="px-6 py-3">Channel Name</SortableTh>
                <SortableTh sortId="frequency" sort={sort} className="px-6 py-3">Default Frequency</SortableTh>
                <SortableTh sortId="duration" sort={sort} align="right" className="px-6 py-3">Duration (min)</SortableTh>
                <SortableTh sortId="storeCount" sort={sort} align="right" className="px-6 py-3">Stores</SortableTh>
                <SortableTh sortId="routed" sort={sort} className="px-6 py-3">Called on?</SortableTh>
                <SortableTh sortId="source" sort={sort} className="px-6 py-3">Came from</SortableTh>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((ch, i) => (
                <tr key={ch.id} className={`hover:bg-gray-50 ${selected.has(ch.id) ? "bg-red-50/40" : ""}`}>
                  <td className="px-6 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(ch.id)}
                      onChange={() => toggleOne(ch.id)}
                      className="w-4 h-4 rounded border-gray-300 text-clippa-red focus:ring-clippa-red cursor-pointer align-middle"
                      aria-label={`Select ${ch.name}`}
                    />
                  </td>
                  <td className="px-6 py-3 text-gray-400">{i + 1}</td>

                  {editing === ch.id ? (
                    <>
                      <td className="px-6 py-3">
                        <input
                          value={editData.name || ""}
                          onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-clippa-red"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <select
                          value={editData.frequency || "monthly"}
                          onChange={(e) => setEditData({ ...editData, frequency: e.target.value as FrequencyType })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-clippa-red"
                        >
                          {FREQUENCY_OPTIONS.map((f) => (
                            <option key={f.value} value={f.value}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-6 py-3">
                        <input
                          type="number"
                          value={editData.duration ?? 30}
                          onChange={(e) => setEditData({ ...editData, duration: Number(e.target.value) })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-20 text-right focus:outline-none focus:ring-1 focus:ring-clippa-red"
                        />
                      </td>
                      {/* Not editable inline: it is one click on its own button,
                          and every td below is positional so the cells must
                          still exist in this branch. */}
                      <td className="px-6 py-3 text-right text-gray-400">
                        {(storeCounts.get(ch.id)?.open ?? 0).toLocaleString("en-ZA")}
                      </td>
                      <td className="px-6 py-3 text-gray-400 text-xs">
                        {ch.notARepChannel ? "Not a rep channel" : "Reps call here"}
                      </td>
                      <td className="px-6 py-3 text-gray-400 text-xs">
                        {ch.source ? CHANNEL_SOURCE_LABEL[ch.source] : "Not recorded"}
                      </td>
                      <td className="px-6 py-3 text-right space-x-2">
                        <button
                          onClick={() => saveEdit(ch.id)}
                          disabled={saving}
                          className="text-green-600 hover:text-green-800 text-xs font-medium"
                        >
                          Save
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="text-gray-400 hover:text-gray-600 text-xs font-medium"
                        >
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-6 py-3 font-medium text-gray-900">{ch.name}</td>
                      <td className="px-6 py-3 text-gray-600">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                          {getFrequencyLabel(ch.frequency)}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right text-gray-600">{ch.duration} min</td>
                      {/* The size of the decision, BEFORE it is taken. Ticking
                          "not a rep channel" on SPAR removes 1 484 stores from
                          every call cycle, and a count that only appears
                          afterwards is how that happens by accident. */}
                      <td className="px-6 py-3 text-right text-gray-600">
                        {(storeCounts.get(ch.id)?.open ?? 0).toLocaleString("en-ZA")}
                      </td>
                      {/* The state IS the control.

                          It was a badge here and a text link over in Actions:
                          two things saying the same thing, and the one that
                          actually did something did not look like a button. A
                          switch shows the current answer and changes it in the
                          same place, which is what a reader expects of a column
                          headed with a question. */}
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={!ch.notARepChannel}
                            aria-label={`Reps call on ${ch.name}`}
                            onClick={() => toggleRepChannel(ch)}
                            disabled={saving}
                            title={
                              ch.notARepChannel
                                ? "Off: nobody is routed here. Click to put this channel back into the call cycles."
                                : `On: reps call here. Click to stop routing anyone to the ${(storeCounts.get(ch.id)?.open ?? 0).toLocaleString("en-ZA")} open stores in this channel.`
                            }
                            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-clippa-red disabled:opacity-50 ${
                              ch.notARepChannel ? "bg-gray-300" : "bg-green-500"
                            }`}
                          >
                            <span
                              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                                ch.notARepChannel ? "translate-x-1" : "translate-x-[1.125rem]"
                              }`}
                            />
                          </button>
                          <span
                            className={`text-xs font-medium ${ch.notARepChannel ? "text-gray-500" : "text-green-700"}`}
                          >
                            {ch.notARepChannel ? "Not a rep channel" : "Reps call here"}
                          </span>
                          {/* Only worth saying where it changes the answer. */}
                          {ch.notARepChannel && (storeCounts.get(ch.id)?.excused ?? 0) > 0 && (
                            <span className="text-[10px] text-blue-600" title="Stores kept in the cycle by an approved Call Override, despite this channel">
                              {storeCounts.get(ch.id)!.excused} excused
                            </span>
                          )}
                        </div>
                      </td>
                      {/* ABSENT is a fact, not a blank. Most channels predate
                          this field, and "Not recorded" says so rather than
                          guessing Repsly for all of them. */}
                      <td className="px-6 py-3">
                        {ch.source ? (
                          <span
                            className="text-xs text-gray-600"
                            title={ch.sourceAt ? `Added ${new Date(ch.sourceAt).toLocaleString("en-ZA")}` : undefined}
                          >
                            {CHANNEL_SOURCE_LABEL[ch.source]}
                          </span>
                        ) : (
                          <span
                            className="text-xs text-gray-400 italic"
                            title="This channel predates the field. The original list arrived with the Repsly store loads, but channels have been added by hand and by Excel since, so it is not recorded which."
                          >
                            Not recorded
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-right space-x-3">
                        <button
                          onClick={() => startEdit(ch)}
                          className="text-clippa-red hover:text-red-800 text-xs font-medium"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteChannel(ch.id, ch.name)}
                          className="text-gray-400 hover:text-red-600 text-xs font-medium"
                        >
                          Delete
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-6 py-8 text-center text-gray-400">
                    {channels.length === 0
                      ? 'No channels configured. Click "Add Channel" to create one.'
                      : `No channels match "${search}".`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
