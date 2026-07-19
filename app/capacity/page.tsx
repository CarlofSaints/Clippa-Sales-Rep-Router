"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "@/components/SessionProvider";
import { Team } from "@/lib/types";

interface RepCapacity {
  repCode: string;
  repName: string;
  teamId: string;
  workingHoursPerDay: number;
  storeCount: number;
  callsPerMonth: number;
  hasRoute: boolean;
  scheduledVisits: number;
  visitHours: number;
  travelHours: number;
  scheduledHours: number;
  availableHours: number;
  utilization: number;
  spareHours: number;
  overCapacityDays: number;
  unassignedStores: number;
}

interface CapacityResponse {
  generatedAt: string | null;
  typeName: string | null;
  hasRoutes: boolean;
  workingDaysPerMonth: number;
  reps: RepCapacity[];
}

function utilBand(r: RepCapacity): { label: string; bar: string; text: string; bg: string } {
  if (!r.hasRoute) return { label: "No route", bar: "bg-gray-300", text: "text-gray-400", bg: "bg-gray-50" };
  if (r.utilization > 1) return { label: "Over capacity", bar: "bg-red-500", text: "text-red-700", bg: "bg-red-50" };
  if (r.utilization > 0.85) return { label: "Near capacity", bar: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50" };
  if (r.utilization < 0.6) return { label: "Spare capacity", bar: "bg-blue-500", text: "text-blue-700", bg: "bg-blue-50" };
  return { label: "Healthy", bar: "bg-green-500", text: "text-green-700", bg: "bg-green-50" };
}

export default function CapacityPage() {
  const { session } = useSession();
  const [data, setData] = useState<CapacityResponse | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  const isAdmin = session?.role === "superAdmin" || session?.role === "admin";
  const isTeamManager = session?.role === "teamManager";
  const isRep = session?.role === "rep";

  useEffect(() => {
    Promise.all([
      fetch("/api/reps/capacity").then((r) => r.json()).catch(() => null),
      fetch("/api/teams").then((r) => r.json()).catch(() => []),
    ]).then(([cap, tm]) => {
      setData(cap && "reps" in cap ? cap : null);
      setTeams(Array.isArray(tm) ? tm : []);
      setLoading(false);
    });
  }, []);

  const teamName = useMemo(() => {
    const m = new Map(teams.map((t) => [t.id, t.name || t.managerName || "—"]));
    return (id: string) => m.get(id) || "Unassigned";
  }, [teams]);

  // Role scoping
  const reps = useMemo(() => {
    const all = data?.reps ?? [];
    if (isRep && session?.repCode) return all.filter((r) => r.repCode === session.repCode);
    if (isTeamManager && session?.teamId) return all.filter((r) => r.teamId === session.teamId);
    return all;
  }, [data, isRep, isTeamManager, session?.repCode, session?.teamId]);

  const sorted = useMemo(
    () => [...reps].sort((a, b) => b.utilization - a.utilization),
    [reps]
  );

  const roll = useMemo(() => {
    const routed = reps.filter((r) => r.hasRoute);
    const avgUtil = routed.length
      ? routed.reduce((s, r) => s + r.utilization, 0) / routed.length
      : 0;
    return {
      total: reps.length,
      routed: routed.length,
      avgUtil,
      over: routed.filter((r) => r.utilization > 1).length,
      near: routed.filter((r) => r.utilization > 0.85 && r.utilization <= 1).length,
      spare: routed.filter((r) => r.utilization < 0.6).length,
      totalStores: reps.reduce((s, r) => s + r.storeCount, 0),
      totalCalls: reps.reduce((s, r) => s + r.callsPerMonth, 0),
      totalUnassigned: reps.reduce((s, r) => s + r.unassignedStores, 0),
      totalSpareHours: routed.reduce((s, r) => s + Math.max(0, r.spareHours), 0),
    };
  }, [reps]);

  // Simple management recommendation
  const recommendation = useMemo(() => {
    if (roll.routed === 0) return null;
    if (roll.over > 0 && roll.spare > 0)
      return {
        tone: "amber",
        text: `${roll.over} rep${roll.over > 1 ? "s are" : " is"} over capacity while ${roll.spare} ${roll.spare > 1 ? "have" : "has"} spare capacity — reshuffle store allocations before hiring.`,
      };
    if (roll.over > 0 && roll.spare === 0)
      return {
        tone: "red",
        text: `${roll.over} rep${roll.over > 1 ? "s are" : " is"} over capacity and no one has meaningful spare — consider employing more reps to cover the load.`,
      };
    if (roll.spare >= Math.max(2, Math.ceil(roll.routed * 0.3)))
      return {
        tone: "blue",
        text: `${roll.spare} reps are running well under capacity (${Math.round(roll.totalSpareHours)}h spare/month total) — there may be room to widen territories or reduce headcount.`,
      };
    return {
      tone: "green",
      text: `Team is well balanced — average utilisation ${Math.round(roll.avgUtil * 100)}%.`,
    };
  }, [roll]);

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
          <h1 className="text-xl font-bold text-gray-900">Rep Efficiency &amp; Capacity</h1>
          <p className="text-sm text-gray-500">
            {data?.hasRoutes ? (
              <>
                Based on generated routes
                {data.typeName && <span className="ml-1 inline-block bg-gray-100 text-gray-600 text-xs font-medium px-2 py-0.5 rounded">{data.typeName}</span>}
                {data.generatedAt && <span className="ml-2">· {new Date(data.generatedAt).toLocaleString("en-ZA")}</span>}
                <span className="ml-2">· {data.workingDaysPerMonth} working days/month</span>
              </>
            ) : (
              "No routes generated yet — figures show allocation only"
            )}
          </p>
        </div>
      </div>

      {/* No-routes prompt */}
      {!data?.hasRoutes && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 text-sm text-amber-800">
          Generate routes on the <a href="/routes" className="underline font-medium">Routes</a> page to see scheduled hours, utilisation and spare capacity per rep.
        </div>
      )}

      {/* Roll-up cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-4">
        {[
          { label: "Reps", value: roll.total, sub: `${roll.routed} routed` },
          { label: "Avg utilisation", value: `${Math.round(roll.avgUtil * 100)}%`, sub: "of capacity" },
          { label: "Over capacity", value: roll.over, sub: "reps > 100%", tone: roll.over > 0 ? "text-red-600" : "text-gray-900" },
          { label: "Spare capacity", value: roll.spare, sub: "reps < 60%", tone: roll.spare > 0 ? "text-blue-600" : "text-gray-900" },
          { label: "Stores", value: roll.totalStores, sub: `${roll.totalCalls} calls/mo` },
          { label: "Unassigned", value: roll.totalUnassigned, sub: "couldn't schedule", tone: roll.totalUnassigned > 0 ? "text-amber-600" : "text-gray-900" },
        ].map((c) => (
          <div key={c.label} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-2xl font-bold ${c.tone || "text-gray-900"}`}>{c.value}</p>
            <p className="text-[11px] text-gray-400">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* Recommendation */}
      {recommendation && (
        <div
          className={`rounded-lg p-4 mb-6 text-sm border ${
            recommendation.tone === "red"
              ? "bg-red-50 border-red-200 text-red-800"
              : recommendation.tone === "amber"
              ? "bg-amber-50 border-amber-200 text-amber-800"
              : recommendation.tone === "blue"
              ? "bg-blue-50 border-blue-200 text-blue-800"
              : "bg-green-50 border-green-200 text-green-800"
          }`}
        >
          <span className="font-semibold">Recommendation: </span>
          {recommendation.text}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3">Rep</th>
                {isAdmin && <th className="px-4 py-3">Team</th>}
                <th className="px-4 py-3 text-right">Stores</th>
                <th className="px-4 py-3 text-right">Calls/mo</th>
                <th className="px-4 py-3 text-right">Hrs used / avail</th>
                <th className="px-4 py-3 w-48">Utilisation</th>
                <th className="px-4 py-3 text-right">Spare (h)</th>
                <th className="px-4 py-3">Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map((r) => {
                const band = utilBand(r);
                const pct = Math.round(r.utilization * 100);
                return (
                  <tr key={r.repCode} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{r.repName}</div>
                      <div className="text-xs text-gray-400 font-mono">{r.repCode}</div>
                    </td>
                    {isAdmin && <td className="px-4 py-3 text-gray-600">{teamName(r.teamId)}</td>}
                    <td className="px-4 py-3 text-right text-gray-700">{r.storeCount}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{r.callsPerMonth}</td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {r.hasRoute ? (
                        <span>
                          {r.scheduledHours.toFixed(1)}
                          <span className="text-gray-400"> / {r.availableHours.toFixed(0)}</span>
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.hasRoute ? (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                            <div
                              className={`h-full ${band.bar}`}
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                          <span className={`text-xs font-semibold w-10 text-right ${band.text}`}>{pct}%</span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">Not routed</span>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-right ${r.hasRoute && r.spareHours < 0 ? "text-red-600" : "text-gray-700"}`}>
                      {r.hasRoute ? r.spareHours.toFixed(1) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {r.overCapacityDays > 0 && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-50 text-red-700">
                            {r.overCapacityDays} over-cap day{r.overCapacityDays > 1 ? "s" : ""}
                          </span>
                        )}
                        {r.unassignedStores > 0 && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700">
                            {r.unassignedStores} unassigned
                          </span>
                        )}
                        {r.hasRoute && r.overCapacityDays === 0 && r.unassignedStores === 0 && (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${band.bg} ${band.text}`}>
                            {band.label}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 8 : 7} className="px-4 py-8 text-center text-gray-400">
                    No reps to show.
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
