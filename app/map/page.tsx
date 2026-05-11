"use client";

import { Suspense, useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Store, Rep, Channel, RoutePlanDocument, RouteDayPlan, WeekLabel } from "@/lib/types";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

const WEEKS: WeekLabel[] = ["Wk1", "Wk2", "Wk3", "Wk4"];

function MapPageInner() {
  const searchParams = useSearchParams();

  const [stores, setStores] = useState<Store[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [routes, setRoutes] = useState<RoutePlanDocument | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters — initialize from URL params (for "View on Map" links from Routes page)
  const [filterRep, setFilterRep] = useState(searchParams.get("rep") || "");
  const [filterDay, setFilterDay] = useState(searchParams.get("day") || "");
  const [filterWeek, setFilterWeek] = useState(searchParams.get("week") || "");
  const [showRoute, setShowRoute] = useState(searchParams.get("route") === "on");

  useEffect(() => {
    Promise.all([
      fetch("/api/stores").then((r) => r.json()),
      fetch("/api/reps").then((r) => r.json()),
      fetch("/api/channels").then((r) => r.json()),
      fetch("/api/routes").then((r) => r.json()),
    ]).then(([st, rp, ch, rt]) => {
      setStores(st);
      setReps(rp);
      setChannels(ch);
      setRoutes(rt);
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

  // Get route stops for selected rep+week+day
  const routeDayPlan: RouteDayPlan | null = useMemo(() => {
    if (!showRoute || !routes || !filterRep || !filterWeek || !filterDay) return null;
    const repPlan = routes.repPlans.find((p) => p.repCode === filterRep);
    if (!repPlan) return null;
    return repPlan.days.find((d) => d.week === filterWeek && d.day === filterDay) || null;
  }, [showRoute, routes, filterRep, filterWeek, filterDay]);

  // Get rep home for route display
  const repHome = useMemo(() => {
    if (!showRoute || !filterRep) return null;
    const rep = repMap.get(filterRep);
    if (!rep) return null;
    const lat = parseFloat(rep.homeGpsLat);
    const lng = parseFloat(rep.homeGpsLng);
    return !isNaN(lat) && !isNaN(lng) ? { lat, lng } : null;
  }, [showRoute, filterRep, repMap]);

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
        <select
          value={filterWeek}
          onChange={(e) => setFilterWeek(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red"
        >
          <option value="">All Weeks</option>
          {WEEKS.map((w) => (
            <option key={w} value={w}>{w}</option>
          ))}
        </select>

        {/* Route toggle */}
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showRoute}
            onChange={(e) => setShowRoute(e.target.checked)}
            className="rounded border-gray-300 text-clippa-red focus:ring-clippa-red"
          />
          Show Route
        </label>

        <span className="text-sm text-gray-500 ml-auto">
          {filtered.length} stores shown
          {routeDayPlan && ` | Route: ${routeDayPlan.stops.length} stops, ${Math.round(routeDayPlan.totalDistance)}km`}
        </span>
      </div>

      {/* Route mode hint */}
      {showRoute && (!filterRep || !filterWeek || !filterDay) && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-xs text-amber-700">
          Select a specific rep, day, and week to display the route.
        </div>
      )}

      {/* Map */}
      <div className="flex-1">
        <MapView
          stores={filtered}
          repMap={repMap}
          channelMap={channelMap}
          repColors={repColors}
          routeStops={routeDayPlan?.stops}
          routePolyline={routeDayPlan?.polyline}
          repHome={repHome}
          showRoute={!!routeDayPlan}
        />
      </div>
    </div>
  );
}

export default function MapPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin w-8 h-8 border-2 border-clippa-red border-t-transparent rounded-full" />
        </div>
      }
    >
      <MapPageInner />
    </Suspense>
  );
}
