"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";

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
  region?: string;
  province?: string;
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

/* ─── Multi-select checkbox dropdown with search ─── */
function FilterDropdown({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const toggle = (val: string) => {
    const next = new Set(selected);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    onChange(next);
  };

  const activeCount = selected.size;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        className={`flex items-center gap-1.5 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red ${
          activeCount > 0
            ? "border-clippa-red bg-red-50 text-clippa-red font-medium"
            : "border-gray-200 text-gray-700 hover:bg-gray-50"
        }`}
      >
        {label}
        {activeCount > 0 && (
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-clippa-red text-white text-[10px] font-bold">
            {activeCount}
          </span>
        )}
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg">
          <div className="p-2 border-b border-gray-100">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}...`}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-clippa-red"
              autoFocus
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-gray-400 px-2 py-2">No matches</p>
            ) : (
              filtered.map((o) => (
                <label
                  key={o.value}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(o.value)}
                    onChange={() => toggle(o.value)}
                    className="accent-clippa-red w-3.5 h-3.5"
                  />
                  <span className="truncate">{o.label}</span>
                </label>
              ))
            )}
          </div>
          {activeCount > 0 && (
            <div className="p-2 border-t border-gray-100">
              <button
                onClick={() => onChange(new Set())}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
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
  const [storeZones, setStoreZones] = useState<Record<string, string>>({});
  const [repZones, setRepZones] = useState<Record<string, Set<string>>>({});
  const [dirty, setDirty] = useState(false);

  // Collapse state for zone sections
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Import state
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");

  // Region populate state
  const [populating, setPopulating] = useState(false);

  // Search + multi-select filters
  const [search, setSearch] = useState("");
  const [filterChannels, setFilterChannels] = useState<Set<string>>(new Set());
  const [filterRegions, setFilterRegions] = useState<Set<string>>(new Set());
  const [filterZones, setFilterZones] = useState<Set<string>>(new Set());
  const [filterProvinces, setFilterProvinces] = useState<Set<string>>(new Set());

  const showMsg = (text: string, type: "success" | "error" = "success") => {
    setMsg(text);
    setMsgType(type);
    setTimeout(() => setMsg(""), 5000);
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    setImportMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/zones/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        showMsg(data.error || "Import failed", "error");
        return;
      }
      const parts: string[] = [];
      if (data.updated) parts.push(`${data.updated} stores updated`);
      if (data.newZones?.length) parts.push(`${data.newZones.length} new zone${data.newZones.length > 1 ? "s" : ""} created`);
      if (data.notFound) parts.push(`${data.notFound} Place IDs not found`);
      setImportMsg(parts.join(", ") || "No changes");
      showMsg(parts.join(", ") || "No changes");
      load();
    } catch {
      showMsg("Import failed", "error");
    } finally {
      setImporting(false);
    }
  };

  const [populateProgress, setPopulateProgress] = useState("");

  const handlePopulateRegions = async () => {
    const channelNames = Array.from(filterChannels).map((id) => channelMap.get(id) || id).join(", ");
    const scope = filterChannels.size > 0 ? `stores in ${channelNames}` : "all stores";
    if (!confirm(`This will call the Google Maps API for ${scope} without a province. Processes 40 per batch. Continue?`)) return;
    setPopulating(true);
    setPopulateProgress("");
    let totalPopulated = 0;
    let totalFailed = 0;
    let done = false;

    const channelParam = filterChannels.size > 0 ? `?channels=${Array.from(filterChannels).join(",")}` : "";

    try {
      while (!done) {
        const res = await fetch(`/api/zones/populate-regions${channelParam}`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) {
          showMsg(data.error || "Failed to populate provinces", "error");
          return;
        }
        totalPopulated += data.populated || 0;
        totalFailed += data.failed || 0;
        done = data.done;

        if (!done) {
          setPopulateProgress(`${totalPopulated} provinces populated so far, ${data.remaining} remaining...`);
        }
      }

      const parts: string[] = [];
      if (totalPopulated) parts.push(`${totalPopulated} provinces populated`);
      if (totalFailed) parts.push(`${totalFailed} failed`);
      if (parts.length === 0) parts.push("No stores needed provinces");
      showMsg(parts.join(", "));
      setPopulateProgress("");
      load();
    } catch {
      showMsg("Failed to populate provinces", "error");
    } finally {
      setPopulating(false);
      setPopulateProgress("");
    }
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
  const zoneMap = new Map(zones.map((z) => [z.id, z.name]));

  // Derive unique regions and provinces from store data
  const regions = useMemo(() => {
    const set = new Set<string>();
    for (const s of stores) {
      if (s.region?.trim()) set.add(s.region.trim());
    }
    return Array.from(set).sort();
  }, [stores]);

  const provinces = useMemo(() => {
    const set = new Set<string>();
    for (const s of stores) {
      if (s.province?.trim()) set.add(s.province.trim());
    }
    return Array.from(set).sort();
  }, [stores]);

  // Filter option lists
  const channelOptions = useMemo(
    () => channels.map((c) => ({ value: c.id, label: c.name })),
    [channels]
  );
  const regionOptions = useMemo(
    () => regions.map((r) => ({ value: r, label: r })),
    [regions]
  );
  const provinceOptions = useMemo(
    () => provinces.map((p) => ({ value: p, label: p })),
    [provinces]
  );
  const zoneOptions = useMemo(
    () => [
      { value: "__unassigned__", label: "Unassigned" },
      ...zones.map((z) => ({ value: z.id, label: z.name })),
    ],
    [zones]
  );

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

  // Filtering + search
  const applyFilters = useCallback(
    (list: Store[]) => {
      let result = list;

      if (filterChannels.size > 0) {
        result = result.filter((s) => filterChannels.has(s.channelId));
      }

      if (filterRegions.size > 0) {
        result = result.filter((s) =>
          filterRegions.has((s.region || "").trim())
        );
      }

      if (filterProvinces.size > 0) {
        result = result.filter((s) =>
          filterProvinces.has((s.province || "").trim())
        );
      }

      if (filterZones.size > 0) {
        result = result.filter((s) => {
          const sz = storeZones[s.id] || "";
          if (!sz && filterZones.has("__unassigned__")) return true;
          if (sz && filterZones.has(sz)) return true;
          return false;
        });
      }

      if (search) {
        const q = search.toLowerCase();
        result = result.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.placeId.toLowerCase().includes(q) ||
            (channelMap.get(s.channelId) || "").toLowerCase().includes(q) ||
            (s.region || "").toLowerCase().includes(q) ||
            (s.province || "").toLowerCase().includes(q) ||
            (zoneMap.get(storeZones[s.id] || "") || "").toLowerCase().includes(q)
        );
      }

      return result;
    },
    [filterChannels, filterRegions, filterProvinces, filterZones, search, channelMap, zoneMap, storeZones]
  );

  // Group stores by zone
  const storesByZone = (zoneId: string) =>
    stores.filter((s) => (storeZones[s.id] || "") === zoneId);

  const unassignedStores = stores.filter((s) => !storeZones[s.id]);

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const hasFilters = !!search || filterChannels.size > 0 || filterRegions.size > 0 || filterProvinces.size > 0 || filterZones.size > 0;

  const clearAllFilters = () => {
    setSearch("");
    setFilterChannels(new Set());
    setFilterRegions(new Set());
    setFilterProvinces(new Set());
    setFilterZones(new Set());
  };

  // Shared store table component
  const StoreTable = ({ rows, showZoneDropdown }: { rows: Store[]; showZoneDropdown: boolean }) => (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
          <th className="px-6 py-2 text-left">Store</th>
          <th className="px-4 py-2 text-left">Place ID</th>
          <th className="px-4 py-2 text-left">Channel</th>
          <th className="px-4 py-2 text-left">Region</th>
          <th className="px-4 py-2 text-left">Province</th>
          <th className="px-4 py-2 text-left">Zone</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {rows.map((s) => (
          <tr key={s.id} className="hover:bg-gray-50">
            <td className="px-6 py-2 font-medium text-gray-900">{s.name}</td>
            <td className="px-4 py-2 text-gray-500">{s.placeId}</td>
            <td className="px-4 py-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                {channelMap.get(s.channelId) || "\u2014"}
              </span>
            </td>
            <td className="px-4 py-2 text-gray-500">{s.region || "\u2014"}</td>
            <td className="px-4 py-2 text-gray-500">{s.province || "\u2014"}</td>
            <td className="px-4 py-2">
              {showZoneDropdown ? (
                <select
                  value={storeZones[s.id] || ""}
                  onChange={(e) => setStoreZone(s.id, e.target.value)}
                  className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-clippa-red"
                >
                  <option value="">Unassigned</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs text-gray-400">
                  {zones.find((z) => z.id === (storeZones[s.id] || ""))?.name || "\u2014"}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

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
        <div className="flex gap-2 flex-wrap justify-end">
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
            onClick={handlePopulateRegions}
            disabled={populating}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            {populating ? "Populating..." : "Populate Provinces from GPS"}
          </button>
          <a
            href="/api/zones/export"
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
          >
            Export Excel
          </a>
          <label
            className={`px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 cursor-pointer ${importing ? "opacity-50 pointer-events-none" : ""}`}
          >
            {importing ? "Importing..." : "Import Excel"}
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImport(f);
                e.target.value = "";
              }}
            />
          </label>
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

      {/* Province populate progress */}
      {populateProgress && (
        <div className="p-3 rounded-lg text-sm bg-blue-50 text-blue-700 flex items-center gap-2">
          <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full" />
          {populateProgress}
        </div>
      )}

      {/* Import result */}
      {importMsg && !msg && (
        <div className="p-3 rounded-lg text-sm bg-blue-50 text-blue-700">
          {importMsg}
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
                onChange={(e) => setNewZone({ ...newZone, name: e.target.value })}
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
                onChange={(e) => setNewZone({ ...newZone, description: e.target.value })}
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

      {/* Search + Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search stores..."
          className="w-full max-w-xs border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red"
        />
        <FilterDropdown
          label="Channels"
          options={channelOptions}
          selected={filterChannels}
          onChange={setFilterChannels}
        />
        <FilterDropdown
          label="Regions"
          options={regionOptions}
          selected={filterRegions}
          onChange={setFilterRegions}
        />
        <FilterDropdown
          label="Provinces"
          options={provinceOptions}
          selected={filterProvinces}
          onChange={setFilterProvinces}
        />
        <FilterDropdown
          label="Zones"
          options={zoneOptions}
          selected={filterZones}
          onChange={setFilterZones}
        />
        {hasFilters && (
          <button
            onClick={clearAllFilters}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100"
          >
            Clear filters
          </button>
        )}
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
                        <div className="font-medium text-gray-900">{rep.name}</div>
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
                                <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              ) : (
                                <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
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
        const zoneStores = applyFilters(storesByZone(zone.id));
        const totalInZone = storesByZone(zone.id).length;
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
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <input
                      value={editData.name}
                      onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                      className="border border-gray-200 rounded px-2 py-1 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-clippa-red"
                    />
                    <input
                      value={editData.description}
                      onChange={(e) => setEditData({ ...editData, description: e.target.value })}
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
                        {hasFilters
                          ? `${zoneStores.length} of ${totalInZone} stores`
                          : `${totalInZone} stores`}
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
                      setEditData({ name: zone.name, description: zone.description });
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
                    {hasFilters
                      ? "No stores match current filters"
                      : "No stores assigned to this zone"}
                  </p>
                ) : (
                  <StoreTable rows={zoneStores} showZoneDropdown={true} />
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Unassigned Stores */}
      {(() => {
        const unassigned = applyFilters(unassignedStores);
        if (unassigned.length === 0 && zones.length > 0 && !hasFilters) return null;
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
                  {hasFilters
                    ? `${unassigned.length} of ${unassignedStores.length} stores`
                    : `${unassignedStores.length} stores`}
                </span>
              </h3>
            </div>
            <div className="overflow-x-auto">
              {unassigned.length === 0 ? (
                <p className="px-6 py-4 text-sm text-gray-400">
                  {zones.length === 0
                    ? "Create zones first, then assign stores"
                    : hasFilters
                      ? "No unassigned stores match current filters"
                      : "All stores are assigned to zones"}
                </p>
              ) : (
                <StoreTable rows={unassigned} showZoneDropdown={true} />
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
