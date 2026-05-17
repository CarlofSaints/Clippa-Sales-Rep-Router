"use client";

import { Suspense, useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useSession } from "@/components/SessionProvider";
import { Store, Rep, Channel, Team, RoutePlanDocument, RouteDayPlan, WeekLabel } from "@/lib/types";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

const WEEKS: WeekLabel[] = ["Wk1", "Wk2", "Wk3", "Wk4"];

function MapPageInner() {
  const searchParams = useSearchParams();
  const { session } = useSession();

  const [stores, setStores] = useState<Store[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [routes, setRoutes] = useState<RoutePlanDocument | null>(null);
  const [loading, setLoading] = useState(true);

  const isAdmin = session?.role === "superAdmin" || session?.role === "admin";
  const isTeamManager = session?.role === "teamManager";
  const isRep = session?.role === "rep";

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
      fetch("/api/teams").then((r) => r.json()),
      fetch("/api/routes").then((r) => r.json()),
    ]).then(([st, rp, ch, tm, rt]) => {
      setStores(st);
      setReps(rp);
      setChannels(ch);
      setTeams(tm);
      setRoutes(rt);
      setLoading(false);
    });
  }, []);

  // Auto-set filterRep for rep users
  useEffect(() => {
    if (isRep && session?.repCode && reps.length > 0) {
      setFilterRep(session.repCode);
    }
  }, [isRep, session?.repCode, reps]);

  const repMap = useMemo(() => new Map(reps.map((r) => [r.code, r])), [reps]);
  const channelMap = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);

  // Scoped reps based on role
  const scopedReps = useMemo(() => {
    if (isRep && session?.repCode) {
      return reps.filter((r) => r.code === session.repCode);
    }
    if (isTeamManager && session?.teamId) {
      return reps.filter((r) => r.teamId === session.teamId);
    }
    return reps; // admin sees all
  }, [reps, isRep, isTeamManager, session?.repCode, session?.teamId]);

  // Visible rep codes for store filtering
  const visibleRepCodes = useMemo(() => {
    return new Set(scopedReps.map((r) => r.code));
  }, [scopedReps]);

  const filtered = useMemo(() => {
    return stores.filter((s) => {
      // Role-based scoping for non-admin users
      if (!isAdmin && !visibleRepCodes.has(s.repCode)) return false;
      if (filterRep && s.repCode !== filterRep) return false;
      if (filterDay && s.dayOfWeek !== filterDay) return false;
      return true;
    });
  }, [stores, filterRep, filterDay, isAdmin, visibleRepCodes]);

  // Get matching route day plans for selected rep (optionally filtered by week/day)
  const matchingDayPlans: RouteDayPlan[] = useMemo(() => {
    if (!showRoute || !routes || !filterRep) return [];
    const repPlan = routes.repPlans.find((p) => p.repCode === filterRep);
    if (!repPlan) return [];
    return repPlan.days.filter((d) => {
      if (filterWeek && d.week !== filterWeek) return false;
      if (filterDay && d.day !== filterDay) return false;
      return d.stops.length > 0;
    });
  }, [showRoute, routes, filterRep, filterWeek, filterDay]);

  // Flatten all matching stops
  const allRouteStops = useMemo(() => {
    return matchingDayPlans.flatMap((d) => d.stops);
  }, [matchingDayPlans]);

  // Build per-day polyline positions (straight lines: home → stops → home)
  const routeLines = useMemo((): [number, number][][] => {
    if (matchingDayPlans.length === 0) return [];
    const home = (() => {
      const rep = repMap.get(filterRep);
      if (!rep) return null;
      const lat = parseFloat(rep.homeGpsLat);
      const lng = parseFloat(rep.homeGpsLng);
      return !isNaN(lat) && !isNaN(lng) ? [lat, lng] as [number, number] : null;
    })();
    return matchingDayPlans.map((dp) => {
      const pts: [number, number][] = [];
      if (home) pts.push(home);
      for (const stop of dp.stops) pts.push([stop.lat, stop.lng]);
      if (home) pts.push(home);
      return pts;
    });
  }, [matchingDayPlans, filterRep, repMap]);

  // Get rep home for route display
  const repHome = useMemo(() => {
    if (!showRoute || !filterRep) return null;
    const rep = repMap.get(filterRep);
    if (!rep) return null;
    const lat = parseFloat(rep.homeGpsLat);
    const lng = parseFloat(rep.homeGpsLng);
    return !isNaN(lat) && !isNaN(lng) ? { lat, lng } : null;
  }, [showRoute, filterRep, repMap]);

  // Assign color per scoped rep
  const repColors: Record<string, string> = {};
  const colors = ["#DC2626", "#2563EB", "#16A34A", "#D97706", "#7C3AED", "#0891B2", "#DB2777", "#65A30D"];
  scopedReps.forEach((r, i) => {
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

        {/* Rep dropdown — hidden for rep users (auto-selected) */}
        {!isRep && (
          <select
            value={filterRep}
            onChange={(e) => setFilterRep(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-clippa-red"
            style={{ color: filterRep ? repColors[filterRep] || "#111827" : "#111827" }}
          >
            <option value="" style={{ color: "#111827" }}>All Reps</option>
            {scopedReps.map((r) => (
              <option key={r.code} value={r.code} style={{ color: repColors[r.code], fontWeight: 600 }}>
                {r.name}
              </option>
            ))}
          </select>
        )}

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
          {allRouteStops.length > 0 && ` | Route: ${allRouteStops.length} stops across ${matchingDayPlans.length} day${matchingDayPlans.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      {/* Route mode hint */}
      {showRoute && !filterRep && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-xs text-amber-700">
          Select a rep to display their route.
        </div>
      )}

      {/* Map */}
      <div className="flex-1">
        <MapView
          stores={filtered}
          repMap={repMap}
          channelMap={channelMap}
          repColors={repColors}
          routeStops={allRouteStops.length > 0 ? allRouteStops : undefined}
          routeLines={routeLines.length > 0 ? routeLines : undefined}
          repHome={repHome}
          showRoute={allRouteStops.length > 0}
          singleDay={matchingDayPlans.length === 1}
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
