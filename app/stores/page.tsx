"use client";

import { useState, useEffect, useMemo } from "react";
import { Store, Channel, Rep, FREQUENCY_OPTIONS, FrequencyType, getFrequencyLabel } from "@/lib/types";

const DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const WEEKS = ["", "Wk1", "Wk2", "Wk3", "Wk4", "Wk5"];

export default function StoresPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterRep, setFilterRep] = useState("");
  const [filterChannel, setFilterChannel] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Store>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");

  const load = () => {
    Promise.all([
      fetch("/api/stores").then((r) => r.json()).catch(() => []),
      fetch("/api/channels").then((r) => r.json()).catch(() => []),
      fetch("/api/reps").then((r) => r.json()).catch(() => []),
    ]).then(([st, ch, rp]) => {
      setStores(Array.isArray(st) ? st : []);
      setChannels(Array.isArray(ch) ? ch : []);
      setReps(Array.isArray(rp) ? rp : []);
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, []);

  // Rankings
  const rankings = useMemo(() => {
    const sorted = [...stores].sort((a, b) => (b.monthlySales ?? 0) - (a.monthlySales ?? 0));
    const overallRank = new Map<string, number>();
    sorted.forEach((s, i) => overallRank.set(s.id, i + 1));

    const repRank = new Map<string, number>();
    const byRep = new Map<string, Store[]>();
    stores.forEach((s) => {
      const arr = byRep.get(s.repCode) || [];
      arr.push(s);
      byRep.set(s.repCode, arr);
    });
    byRep.forEach((arr) => {
      arr.sort((a, b) => (b.monthlySales ?? 0) - (a.monthlySales ?? 0));
      arr.forEach((s, i) => repRank.set(s.id, i + 1));
    });

    const channelRank = new Map<string, number>();
    const byCh = new Map<string, Store[]>();
    stores.forEach((s) => {
      const arr = byCh.get(s.channelId) || [];
      arr.push(s);
      byCh.set(s.channelId, arr);
    });
    byCh.forEach((arr) => {
      arr.sort((a, b) => (b.monthlySales ?? 0) - (a.monthlySales ?? 0));
      arr.forEach((s, i) => channelRank.set(s.id, i + 1));
    });

    return { overallRank, repRank, channelRank };
  }, [stores]);

  const channelMap = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);
  const repMap = useMemo(() => new Map(reps.map((r) => [r.code, r])), [reps]);

  const filtered = useMemo(() => {
    return stores.filter((s) => {
      if (search && !s.name.toLowerCase().includes(search.toLowerCase()) && !s.placeId.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterRep && s.repCode !== filterRep) return false;
      if (filterChannel && s.channelId !== filterChannel) return false;
      return true;
    });
  }, [stores, search, filterRep, filterChannel]);

  const startEdit = (store: Store) => {
    setEditing(store.id);
    setEditData({
      repCode: store.repCode,
      channelId: store.channelId,
      frequency: store.frequency,
      duration: store.duration,
      dayOfWeek: store.dayOfWeek,
      weekNumber: store.weekNumber,
    });
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    await fetch("/api/stores", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...editData }),
    });
    setEditing(null);
    setEditData({});
    setSaving(false);
    load();
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg("");
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/stores/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok) {
        setUploadMsg(`${data.added ?? data.imported ?? 0} new stores, ${data.updated ?? 0} updated — ${data.total ?? data.imported ?? 0} total stores, ${data.channels} channels, ${data.reps} reps`);
        load();
      } else {
        setUploadMsg(data.error || "Upload failed");
      }
    } catch {
      setUploadMsg("Upload error");
    }
    setUploading(false);
    e.target.value = "";
  };

  const fmt = (n: number) =>
    "R " + (n ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-clippa-red border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Stores</h1>
          <p className="text-sm text-gray-500">
            {filtered.length} of {stores.length} stores
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="bg-white border border-gray-200 text-sm px-4 py-2 rounded-lg cursor-pointer hover:bg-gray-50">
            {uploading ? "Uploading..." : "Upload Excel"}
            <input type="file" accept=".xlsx,.xls" onChange={handleUpload} className="hidden" />
          </label>
        </div>
      </div>

      {uploadMsg && (
        <div className="mb-4 p-3 rounded-lg bg-blue-50 text-blue-700 text-sm">{uploadMsg}</div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search store name or ID..."
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-1 focus:ring-clippa-red"
        />
        <select
          value={filterRep}
          onChange={(e) => setFilterRep(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red"
        >
          <option value="">All Reps</option>
          {reps.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name} ({r.code})
            </option>
          ))}
        </select>
        <select
          value={filterChannel}
          onChange={(e) => setFilterChannel(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red"
        >
          <option value="">All Channels</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-left text-[10px] text-gray-500 uppercase tracking-wider">
                <th className="px-3 py-2">Place ID</th>
                <th className="px-3 py-2">Store Name</th>
                <th className="px-3 py-2">Channel</th>
                <th className="px-3 py-2">Province</th>
                <th className="px-3 py-2">Rep</th>
                <th className="px-3 py-2 text-right">Monthly Sales</th>
                <th className="px-3 py-2 text-center">Rank Overall</th>
                <th className="px-3 py-2 text-center">Rank/Rep</th>
                <th className="px-3 py-2 text-center">Rank/Channel</th>
                <th className="px-3 py-2">Frequency</th>
                <th className="px-3 py-2 text-right">Duration</th>
                <th className="px-3 py-2">Day</th>
                <th className="px-3 py-2">Week</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((store) => {
                const isEditing = editing === store.id;
                const ch = channelMap.get(store.channelId);
                const rep = repMap.get(store.repCode);
                return (
                  <tr key={store.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-gray-500">{store.placeId}</td>
                    <td className="px-3 py-2 font-medium text-gray-900 max-w-[200px] truncate" title={store.name}>
                      {store.name}
                    </td>

                    {isEditing ? (
                      <>
                        <td className="px-3 py-2">
                          <select
                            value={editData.channelId || ""}
                            onChange={(e) => setEditData({ ...editData, channelId: e.target.value })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-full"
                          >
                            {channels.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-gray-500">{store.province || "—"}</td>
                        <td className="px-3 py-2">
                          <select
                            value={editData.repCode || ""}
                            onChange={(e) => setEditData({ ...editData, repCode: e.target.value })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-full"
                          >
                            {reps.map((r) => (
                              <option key={r.code} value={r.code}>{r.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600">{fmt(store.monthlySales)}</td>
                        <td className="px-3 py-2 text-center text-gray-400">{rankings.overallRank.get(store.id)}</td>
                        <td className="px-3 py-2 text-center text-gray-400">{rankings.repRank.get(store.id)}</td>
                        <td className="px-3 py-2 text-center text-gray-400">{rankings.channelRank.get(store.id)}</td>
                        <td className="px-3 py-2">
                          <select
                            value={editData.frequency || "monthly"}
                            onChange={(e) => setEditData({ ...editData, frequency: e.target.value as FrequencyType })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-full"
                          >
                            {FREQUENCY_OPTIONS.map((f) => (
                              <option key={f.value} value={f.value}>{f.label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={editData.duration ?? 30}
                            onChange={(e) => setEditData({ ...editData, duration: Number(e.target.value) })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-14 text-right"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={editData.dayOfWeek || ""}
                            onChange={(e) => setEditData({ ...editData, dayOfWeek: e.target.value })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-full"
                          >
                            {DAYS.map((d) => (
                              <option key={d} value={d}>{d || "—"}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={editData.weekNumber || ""}
                            onChange={(e) => setEditData({ ...editData, weekNumber: e.target.value })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-full"
                          >
                            {WEEKS.map((w) => (
                              <option key={w} value={w}>{w || "—"}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right space-x-1 whitespace-nowrap">
                          <button onClick={() => saveEdit(store.id)} disabled={saving} className="text-green-600 hover:text-green-800 font-medium">
                            Save
                          </button>
                          <button onClick={() => { setEditing(null); setEditData({}); }} className="text-gray-400 hover:text-gray-600 font-medium">
                            Cancel
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-gray-600">{ch?.name || store.channelId}</td>
                        <td className="px-3 py-2 text-gray-500">{store.province || "—"}</td>
                        <td className="px-3 py-2 text-gray-600">{rep?.name || store.repCode}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{fmt(store.monthlySales)}</td>
                        <td className="px-3 py-2 text-center">
                          <span className="inline-flex items-center justify-center w-7 h-5 rounded bg-blue-50 text-blue-700 font-medium">
                            {rankings.overallRank.get(store.id)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="inline-flex items-center justify-center w-7 h-5 rounded bg-green-50 text-green-700 font-medium">
                            {rankings.repRank.get(store.id)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="inline-flex items-center justify-center w-7 h-5 rounded bg-purple-50 text-purple-700 font-medium">
                            {rankings.channelRank.get(store.id)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-600">{getFrequencyLabel(store.frequency)}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{store.duration}m</td>
                        <td className="px-3 py-2 text-gray-500">{store.dayOfWeek || "—"}</td>
                        <td className="px-3 py-2 text-gray-500">{store.weekNumber || "—"}</td>
                        <td className="px-3 py-2 text-right">
                          <button onClick={() => startEdit(store)} className="text-clippa-red hover:text-red-800 font-medium">
                            Edit
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
