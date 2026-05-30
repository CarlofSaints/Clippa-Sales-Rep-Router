"use client";

import { useState, useEffect, useCallback } from "react";

interface Zone {
  id: string;
  name: string;
  description: string;
}

interface Store {
  id: string;
  name: string;
  placeId: string;
  channelId: string;
  zoneId?: string;
}

interface Rep {
  id: string;
  code: string;
  name: string;
  assignedZones?: string[];
}

interface Channel {
  id: string;
  name: string;
}

export default function ZonesPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState<"success" | "error">("success");

  // Add/edit zone
  const [showAdd, setShowAdd] = useState(false);
  const [newZone, setNewZone] = useState({ name: "", description: "" });
  const [editing, setEditing] = useState<string | null>(null);
  const [editData, setEditData] = useState({ name: "", description: "" });

  // Store zone assignments — local copy for batch save
  const [storeZones, setStoreZones] = useState<Record<string, string>>({}); // storeId → zoneId
  const [repZones, setRepZones] = useState<Record<string, Set<string>>>({}); // repId → Set<zoneId>
  const [dirty, setDirty] = useState(false);

  // Collapse state for zone sections
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Search
  const [search, setSearch] = useState("");

  const showMsg = (text: string, type: "success" | "error" = "success") => {
    setMsg(text);
    setMsgType(type);
    setTimeout(() => setMsg(""), 5000);
  };

  const load = useCallback(async () => {
    try {
      const [zRes, sRes, rRes, chRes] = await Promise.all([
        fetch("/api/zones"),
        fetch("/api/stores"),
        fetch("/api/reps"),
        fetch("/api/channels"),
      ]);
      const zData: Zone[] = await zRes.json();
      const sData: Store[] = await sRes.json();
      const rData: Rep[] = await rRes.json();
      const chData: Channel[] = await chRes.json();
      setZones(zData);
      setStores(sData);
      setReps(rData);
      setChannels(chData);

      // Build local state
      const sz: Record<string, string> = {};
      for (const s of sData) {
        if (s.zoneId) sz[s.id] = s.zoneId;
      }
      setStoreZones(sz);

      const rz: Record<string, Set<string>> = {};
      for (const r of rData) {
        rz[r.id] = new Set(r.assignedZones || []);
      }
      setRepZones(rz);
      setDirty(false);
    } catch {
      showMsg("Failed to load data", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const channelMap = new Map(channels.map((c) => [c.id, c.name]));

  const addZone = async () => {
    if (!newZone.name.trim()) {
      showMsg("Zone name is required", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/zones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newZone),
      });
      if (res.ok) {
        showMsg(`Zone "${newZone.name}" created`);
        setShowAdd(false);
        setNewZone({ name: "", description: "" });
        load();
      } else {
        const data = await res.json();
        showMsg(data.error || "Failed to create zone", "error");
      }
    } catch {
      showMsg("Network error", "error");
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    try {
      const res = await fetch("/api/zones", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...editData }),
      });
      if (res.ok) {
        setEditing(null);
        showMsg("Zone updated");
        load();
      } else {
        showMsg("Failed to update zone", "error");
      }
    } catch {
      showMsg("Network error", "error");
    } finally {
      setSaving(false);
    }
  };

  const deleteZone = async (z: Zone) => {
    if (!confirm(`Delete zone "${z.name}"? Stores in this zone will become unassigned.`))
      return;
    try {
      const res = await fetch("/api/zones", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: z.id }),
      });
      if (res.ok) {
        showMsg(`Zone "${z.name}" deleted`);
        load();
      } else {
        showMsg("Failed to delete zone", "error");
      }
    } catch {
      showMsg("Network error", "error");
    }
  };

  const setStoreZone = (storeId: string, zoneId: string) => {
    setStoreZones((prev) => {
      const next = { ...prev };
      if (zoneId) {
        next[storeId] = zoneId;
      } else {
        delete next[storeId];
      }
      return next;
    });
    setDirty(true);
  };

  const toggleRepZone = (repId: string, zoneId: string) => {
    setRepZones((prev) => {
      const next = { ...prev };
      const s = new Set(next[repId] || []);
      if (s.has(zoneId)) {
        s.delete(zoneId);
      } else {
        s.add(zoneId);
      }
      next[repId] = s;
      return next;
    });
    setDirty(true);
  };

  const saveAssignments = async () => {
    setSaving(true);
    try {
      // Save store zone assignments
      const storeUpdates = stores
        .filter((s) => {
          const current = s.zoneId || "";
          const local = storeZones[s.id] || "";
          return current !== local;
        })
        .map((s) =>
          fetch("/api/stores", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: s.id, zoneId: storeZones[s.id] || "" }),
          })
        );

      // Save rep zone assignments
      const repUpdates = reps
        .filter((r) => {
          const current = new Set(r.assignedZones || []);
          const local = repZones[r.id] || new Set();
          if (current.size !== local.size) return true;
          for (const v of current) if (!local.has(v)) return true;
          return false;
        })
        .map((r) =>
          fetch("/api/reps", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: r.id,
              assignedZones: Array.from(repZones[r.id] || []),
            }),
          })
        );

      await Promise.all([...storeUpdates, ...repUpdates]);
      setDirty(false);
      showMsg("Assignments saved");
      load();
    } catch {
      showMsg("Failed to save assignments", "error");
    } finally {
      setSaving(false);
    }
  };

  // Group stores by zone
  const storesByZone = (zoneId: string) =>
    stores.filter((s) => (storeZones[s.id] || "") === zoneId);

  const unassignedStores = stores.filter((s) => !storeZones[s.id]);

  const filteredStores = (list: Store[]) => {
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.placeId.toLowerCase().includes(q) ||
        (channelMap.get(s.channelId) || "").toLowerCase().includes(q)
    );
  };

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-clippa-red border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Zones</h1>
          <p className="text-sm text-gray-500">
            Manage geographic zones and assign stores &amp; reps
          </p>
        </div>
        <div className="flex gap-2">
          {dirty && (
            <>
              <button
                onClick={load}
                className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50"
              >
                Discard
              </button>
              <button
                onClick={saveAssignments}
                disabled={saving}
                className="px-4 py-1.5 bg-clippa-red text-white rounded-lg text-xs font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Assignments"}
              </button>
            </>
          )}
          <button
            onClick={() => setShowAdd(true)}
            className="bg-clippa-red text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700"
          >
            + Add Zone
          </button>
        </div>
      </div>

      {/* Messages */}
      {msg && (
        <div
          className={`p-3 rounded-lg text-sm ${
            msgType === "success"
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {msg}
        </div>
      )}

      {/* Add Zone Form */}
      {showAdd && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">New Zone</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Name
              </label>
              <input
                value={newZone.name}
                onChange={(e) =>
                  setNewZone({ ...newZone, name: e.target.value })
                }
                placeholder="e.g. Gauteng North"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Description
              </label>
              <input
                value={newZone.description}
                onChange={(e) =>
                  setNewZone({ ...newZone, description: e.target.value })
                }
                placeholder="Optional description"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red"
              />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={addZone}
              disabled={saving}
              className="bg-clippa-red text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
            >
              {saving ? "Creating..." : "Create Zone"}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="text-gray-500 px-4 py-2 rounded-lg text-sm hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search stores..."
          className="w-full max-w-sm border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red"
        />
      </div>

      {/* Rep-Zone Assignment Matrix */}
      {zones.length > 0 && reps.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Rep Zone Assignments</h3>
            <p className="text-xs text-gray-500 mt-1">
              Assign reps to zones for the Geography strategy
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                  <th className="px-6 py-3 text-left">Rep</th>
                  {zones.map((z) => (
                    <th key={z.id} className="px-4 py-3 text-center min-w-[100px]">
                      {z.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {reps.map((rep) => {
                  const assigned = repZones[rep.id] || new Set();
                  return (
                    <tr key={rep.id} className="hover:bg-gray-50">
                      <td className="px-6 py-3">
                        <div className="font-medium text-gray-900">
                          {rep.name}
                        </div>
                        <div className="text-xs text-gray-400">{rep.code}</div>
                      </td>
                      {zones.map((z) => {
                        const has = assigned.has(z.id);
                        return (
                          <td key={z.id} className="px-4 py-3 text-center">
                            <button
                              onClick={() => toggleRepZone(rep.id, z.id)}
                              className="inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors cursor-pointer hover:bg-gray-100"
                            >
                              {has ? (
                                <svg
                                  className="w-5 h-5 text-green-500"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M5 13l4 4L19 7"
                                  />
                                </svg>
                              ) : (
                                <svg
                                  className="w-5 h-5 text-gray-300"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M6 18L18 6M6 6l12 12"
                                  />
                                </svg>
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Zone Sections — stores grouped by zone */}
      {zones.map((zone) => {
        const zoneStores = filteredStores(storesByZone(zone.id));
        const isEditing = editing === zone.id;
        const isCollapsed = collapsed[zone.id];

        return (
          <div
            key={zone.id}
            className="bg-white rounded-xl shadow-sm border border-gray-100"
          >
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => toggleCollapse(zone.id)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg
                    className={`w-4 h-4 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </button>
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <input
                      value={editData.name}
                      onChange={(e) =>
                        setEditData({ ...editData, name: e.target.value })
                      }
                      className="border border-gray-200 rounded px-2 py-1 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-clippa-red"
                    />
                    <input
                      value={editData.description}
                      onChange={(e) =>
                        setEditData({
                          ...editData,
                          description: e.target.value,
                        })
                      }
                      placeholder="Description"
                      className="border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red"
                    />
                    <button
                      onClick={() => saveEdit(zone.id)}
                      disabled={saving}
                      className="text-green-600 hover:text-green-800 text-xs font-medium px-2 py-1 rounded hover:bg-green-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="text-gray-400 hover:text-gray-600 text-xs font-medium px-2 py-1 rounded hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div>
                    <h3 className="font-semibold text-gray-900">
                      {zone.name}
                      <span className="ml-2 text-xs font-normal text-gray-400">
                        {storesByZone(zone.id).length} stores
                      </span>
                    </h3>
                    {zone.description && (
                      <p className="text-xs text-gray-500">{zone.description}</p>
                    )}
                  </div>
                )}
              </div>
              {!isEditing && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setEditing(zone.id);
                      setEditData({
                        name: zone.name,
                        description: zone.description,
                      });
                    }}
                    className="text-clippa-red hover:text-red-800 text-xs font-medium px-2 py-1 rounded hover:bg-red-50"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteZone(zone)}
                    className="text-gray-400 hover:text-red-600 text-xs font-medium px-2 py-1 rounded hover:bg-gray-50"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>

            {!isCollapsed && (
              <div className="overflow-x-auto">
                {zoneStores.length === 0 ? (
                  <p className="px-6 py-4 text-sm text-gray-400">
                    No stores assigned to this zone
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                        <th className="px-6 py-2 text-left">Store</th>
                        <th className="px-4 py-2 text-left">Place ID</th>
                        <th className="px-4 py-2 text-left">Channel</th>
                        <th className="px-4 py-2 text-left">Zone</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {zoneStores.map((s) => (
                        <tr key={s.id} className="hover:bg-gray-50">
                          <td className="px-6 py-2 font-medium text-gray-900">
                            {s.name}
                          </td>
                          <td className="px-4 py-2 text-gray-500">
                            {s.placeId}
                          </td>
                          <td className="px-4 py-2 text-gray-500">
                            {channelMap.get(s.channelId) || "—"}
                          </td>
                          <td className="px-4 py-2">
                            <select
                              value={storeZones[s.id] || ""}
                              onChange={(e) =>
                                setStoreZone(s.id, e.target.value)
                              }
                              className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-clippa-red"
                            >
                              <option value="">Unassigned</option>
                              {zones.map((z) => (
                                <option key={z.id} value={z.id}>
                                  {z.name}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Unassigned Stores */}
      {(() => {
        const unassigned = filteredStores(unassignedStores);
        if (unassigned.length === 0 && zones.length > 0) return null;
        return (
          <div className="bg-white rounded-xl shadow-sm border border-amber-200">
            <div className="px-6 py-4 border-b border-amber-100 flex items-center gap-2">
              <svg
                className="w-4 h-4 text-amber-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
              <h3 className="font-semibold text-amber-700">
                Unassigned
                <span className="ml-2 text-xs font-normal text-amber-500">
                  {unassigned.length} stores
                </span>
              </h3>
            </div>
            <div className="overflow-x-auto">
              {unassigned.length === 0 ? (
                <p className="px-6 py-4 text-sm text-gray-400">
                  {zones.length === 0
                    ? "Create zones first, then assign stores"
                    : "All stores are assigned to zones"}
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                      <th className="px-6 py-2 text-left">Store</th>
                      <th className="px-4 py-2 text-left">Place ID</th>
                      <th className="px-4 py-2 text-left">Channel</th>
                      <th className="px-4 py-2 text-left">Zone</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {unassigned.map((s) => (
                      <tr key={s.id} className="hover:bg-gray-50">
                        <td className="px-6 py-2 font-medium text-gray-900">
                          {s.name}
                        </td>
                        <td className="px-4 py-2 text-gray-500">
                          {s.placeId}
                        </td>
                        <td className="px-4 py-2 text-gray-500">
                          {channelMap.get(s.channelId) || "—"}
                        </td>
                        <td className="px-4 py-2">
                          <select
                            value=""
                            onChange={(e) =>
                              setStoreZone(s.id, e.target.value)
                            }
                            className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-clippa-red"
                          >
                            <option value="">Unassigned</option>
                            {zones.map((z) => (
                              <option key={z.id} value={z.id}>
                                {z.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        );
      })()}

      {zones.length === 0 && (
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-6 text-center">
          <p className="text-gray-500 text-sm">
            No zones configured. Create zones to group stores by geographic area.
          </p>
        </div>
      )}
    </div>
  );
}
