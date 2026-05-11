"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Rep,
  RoutePlanDocument,
  RepRoutePlan,
  RouteDayPlan,
  WeekLabel,
  DayLabel,
} from "@/lib/types";

const WEEKS: WeekLabel[] = ["Wk1", "Wk2", "Wk3", "Wk4"];
const DAYS: DayLabel[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

export default function RoutesPage() {
  const [routes, setRoutes] = useState<RoutePlanDocument | null>(null);
  const [reps, setReps] = useState<Rep[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedRep, setSelectedRep] = useState("");
  const [selectedCell, setSelectedCell] = useState<{
    week: WeekLabel;
    day: DayLabel;
  } | null>(null);
  const [error, setError] = useState("");

  const load = () => {
    Promise.all([
      fetch("/api/routes").then((r) => r.json()),
      fetch("/api/reps").then((r) => r.json()),
    ]).then(([rt, rp]) => {
      setRoutes(rt);
      setReps(rp);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
  }, []);

  const generateRoutes = async () => {
    setGenerating(true);
    setError("");
    try {
      const res = await fetch("/api/routes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          selectedRep ? { repCodes: [selectedRep] } : {}
        ),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const doc = await res.json();
      setRoutes(doc);
    } catch (err) {
      setError(String(err));
    } finally {
      setGenerating(false);
    }
  };

  const clearRoutes = async () => {
    if (!confirm("Delete all generated routes?")) return;
    await fetch("/api/routes", { method: "DELETE" });
    setRoutes(null);
  };

  // Get current rep's plan
  const currentPlan: RepRoutePlan | null = useMemo(() => {
    if (!routes || !selectedRep) return routes?.repPlans?.[0] || null;
    return routes.repPlans.find((p) => p.repCode === selectedRep) || null;
  }, [routes, selectedRep]);

  // Build week/day grid lookup
  const grid = useMemo(() => {
    if (!currentPlan) return new Map<string, RouteDayPlan>();
    const m = new Map<string, RouteDayPlan>();
    for (const dp of currentPlan.days) {
      m.set(`${dp.week}-${dp.day}`, dp);
    }
    return m;
  }, [currentPlan]);

  // Get selected day detail
  const selectedDayPlan: RouteDayPlan | null = useMemo(() => {
    if (!selectedCell) return null;
    return grid.get(`${selectedCell.week}-${selectedCell.day}`) || null;
  }, [selectedCell, grid]);

  // Capacity color
  const capacityColor = (plan: RouteDayPlan | undefined, workingHours: number) => {
    if (!plan || plan.stops.length === 0) return "bg-gray-50 text-gray-400";
    const utilization = plan.totalTime / (workingHours * 60);
    if (utilization > 1) return "bg-red-50 border-red-200 text-red-800";
    if (utilization > 0.85) return "bg-amber-50 border-amber-200 text-amber-800";
    return "bg-green-50 border-green-200 text-green-800";
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
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Routes</h1>
          <p className="text-sm text-gray-500">
            {routes
              ? `Generated ${new Date(routes.generatedAt).toLocaleString("en-ZA")}${routes.config.useGoogleMaps ? " (Google Maps optimized)" : " (Haversine fallback)"}`
              : "No routes generated yet"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {routes && (
            <button
              onClick={clearRoutes}
              className="text-gray-400 hover:text-red-600 text-sm"
            >
              Clear All
            </button>
          )}
          <button
            onClick={generateRoutes}
            disabled={generating}
            className="bg-clippa-red text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {generating && (
              <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
            )}
            {generating ? "Generating..." : "Generate Routes"}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Rep filter */}
      <div className="flex items-center gap-4 mb-6">
        <select
          value={selectedRep}
          onChange={(e) => {
            setSelectedRep(e.target.value);
            setSelectedCell(null);
          }}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red"
        >
          <option value="">Select Rep</option>
          {reps.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name} ({r.code})
            </option>
          ))}
        </select>
        {currentPlan && (
          <span className="text-sm text-gray-500">
            {currentPlan.stats.totalStores} stores assigned |{" "}
            {currentPlan.days.reduce((s, d) => s + d.stops.length, 0)} visits
            scheduled
            {currentPlan.stats.unassignedStores.length > 0 && (
              <span className="text-amber-600 ml-2">
                | {currentPlan.stats.unassignedStores.length} unassigned
              </span>
            )}
          </span>
        )}
      </div>

      {/* Unassigned stores alert */}
      {currentPlan && currentPlan.stats.unassignedStores.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <p className="text-sm font-medium text-amber-800 mb-2">
            {currentPlan.stats.unassignedStores.length} stores could not be
            scheduled:
          </p>
          <ul className="text-xs text-amber-700 space-y-1">
            {currentPlan.stats.unassignedStores.map((s) => (
              <li key={s.storeId}>
                {s.storeName} — {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Weekly Schedule Grid */}
      {currentPlan && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-3 text-left w-28">Day</th>
                  {WEEKS.map((w) => (
                    <th key={w} className="px-4 py-3 text-center">
                      {w}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {DAYS.map((day) => (
                  <tr key={day} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-medium text-gray-700">
                      {day}
                    </td>
                    {WEEKS.map((week) => {
                      const plan = grid.get(`${week}-${day}`);
                      const isSelected =
                        selectedCell?.week === week &&
                        selectedCell?.day === day;
                      return (
                        <td key={week} className="px-2 py-2">
                          <button
                            onClick={() =>
                              setSelectedCell(
                                isSelected ? null : { week, day }
                              )
                            }
                            className={`w-full rounded-lg border px-3 py-2 text-center transition-all ${
                              isSelected
                                ? "ring-2 ring-clippa-red border-clippa-red"
                                : ""
                            } ${capacityColor(plan, currentPlan.workingHoursPerDay)}`}
                          >
                            {plan && plan.stops.length > 0 ? (
                              <>
                                <div className="font-semibold text-sm">
                                  {plan.stops.length} stores
                                </div>
                                <div className="text-xs mt-0.5">
                                  {(plan.totalTime / 60).toFixed(1)}h |{" "}
                                  {Math.round(plan.totalDistance)}km
                                </div>
                              </>
                            ) : (
                              <div className="text-xs">—</div>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Day Detail */}
      {selectedDayPlan && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">
              {selectedCell!.day} — {selectedCell!.week}
            </h3>
            <div className="flex items-center gap-3">
              <a
                href={`/map?rep=${currentPlan!.repCode}&week=${selectedCell!.week}&day=${selectedCell!.day}&route=on`}
                className="text-clippa-red hover:text-red-800 text-xs font-medium"
              >
                View on Map
              </a>
              <span className="text-xs text-gray-500">
                {selectedDayPlan.stops.length} stores |{" "}
                {(selectedDayPlan.totalTravelTime / 60).toFixed(1)}h travel |{" "}
                {(selectedDayPlan.totalVisitTime / 60).toFixed(1)}h visits |{" "}
                {Math.round(selectedDayPlan.totalDistance)}km
              </span>
            </div>
          </div>

          <div className="space-y-2">
            {/* Home start */}
            {currentPlan!.homeLatLng && (
              <div className="flex items-center gap-3 text-xs text-gray-400 pl-2">
                <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-gray-600">
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                    />
                  </svg>
                </div>
                <span>Start from home</span>
              </div>
            )}

            {selectedDayPlan.stops.map((stop, idx) => (
              <div
                key={stop.storeId}
                className="flex items-center gap-3 bg-gray-50 rounded-lg px-4 py-2.5"
              >
                <div className="w-7 h-7 rounded-full bg-clippa-red text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {stop.sequence}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm truncate">
                    {stop.storeName}
                  </p>
                  <p className="text-xs text-gray-500">
                    arrive {stop.arrivalTime} — depart {stop.departureTime} —{" "}
                    {stop.visitDuration}min visit
                  </p>
                </div>
                <div className="text-right text-xs text-gray-400 flex-shrink-0">
                  {stop.distanceFromPrev > 0 && (
                    <span>{stop.distanceFromPrev}km</span>
                  )}
                  {stop.travelTimeFromPrev > 0 && (
                    <span className="ml-2">
                      {stop.travelTimeFromPrev}min drive
                    </span>
                  )}
                </div>
              </div>
            ))}

            {/* Home return */}
            {currentPlan!.homeLatLng && (
              <div className="flex items-center gap-3 text-xs text-gray-400 pl-2">
                <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-gray-600">
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                    />
                  </svg>
                </div>
                <span>Return home</span>
              </div>
            )}
          </div>

          {/* Summary bar */}
          <div
            className={`mt-4 rounded-lg px-4 py-2.5 text-xs font-medium ${
              selectedDayPlan.overCapacity
                ? "bg-red-50 text-red-700"
                : "bg-green-50 text-green-700"
            }`}
          >
            {selectedDayPlan.stops.length} stores |{" "}
            {(selectedDayPlan.totalTravelTime / 60).toFixed(1)}h travel |{" "}
            {(selectedDayPlan.totalVisitTime / 60).toFixed(1)}h visits |{" "}
            {(selectedDayPlan.totalTime / 60).toFixed(1)}h total |{" "}
            {Math.round(selectedDayPlan.totalDistance)}km
            {selectedDayPlan.overCapacity && " — OVER CAPACITY"}
          </div>
        </div>
      )}

      {/* No routes state */}
      {!routes && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
          <svg
            className="w-12 h-12 text-gray-300 mx-auto mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
            />
          </svg>
          <p className="text-gray-500 text-sm mb-4">
            Click &quot;Generate Routes&quot; to create optimized daily routes
            for all reps.
          </p>
          <p className="text-gray-400 text-xs">
            Routes are calculated based on store frequency, geographic
            clustering, and rep working hours.
          </p>
        </div>
      )}
    </div>
  );
}
