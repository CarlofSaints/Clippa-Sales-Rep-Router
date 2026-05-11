"use client";

import { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { Store, Rep, Channel } from "@/lib/types";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

export default function MapPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterRep, setFilterRep] = useState("");
  const [filterDay, setFilterDay] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/stores").then((r) => r.json()),
      fetch("/api/reps").then((r) => r.json()),
      fetch("/api/channels").then((r) => r.json()),
    ]).then(([st, rp, ch]) => {
      setStores(st);
      setReps(rp);
      setChannels(ch);
      setLoading(false);
    });
  }, []);

  const repMap = useMemo(() => new Map(reps.map((r) => [r.code, r])), [reps]);
  const channelMap = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);

  const filtered = useMemo(() => {
    return stores.filter((s) => {
      if (filterRep && s.repCode !== filterRep) return false;
      if (filterDay && s.dayOfWeek !== filterDay) return false;
      return true;
    });
  }, [stores, filterRep, filterDay]);

  // Assign color per rep
  const repColors: Record<string, string> = {};
  const colors = ["#DC2626", "#2563EB", "#16A34A", "#D97706", "#7C3AED", "#0891B2", "#DB2777", "#65A30D"];
  reps.forEach((r, i) => {
    repColors[r.code] = colors[i % colors.length];
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-clippa-red border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Filters bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 flex-shrink-0">
        <h1 className="text-lg font-bold text-gray-900 mr-4">Route Map</h1>
        <select
          value={filterRep}
          onChange={(e) => setFilterRep(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red"
        >
          <option value="">All Reps</option>
          {reps.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </select>
        <select
          value={filterDay}
          onChange={(e) => setFilterDay(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red"
        >
          <option value="">All Days</option>
          {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <span className="text-sm text-gray-500 ml-auto">
          {filtered.length} stores shown
        </span>
      </div>

      {/* Map */}
      <div className="flex-1">
        <MapView
          stores={filtered}
          repMap={repMap}
          channelMap={channelMap}
          repColors={repColors}
        />
      </div>
    </div>
  );
}
