"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Channel, Rep, Store, Team, AdherenceData, AdherenceMetrics } from "@/lib/types";

type SortDir = "asc" | "desc";

function useSortable<T>(data: T[], defaultKey: string, defaultDir: SortDir = "desc") {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const toggle = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortKey];
      const bv = (b as Record<string, unknown>)[sortKey];
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const as = String(av ?? "");
      const bs = String(bv ?? "");
      return sortDir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as);
    });
  }, [data, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, onToggle: toggle };
}

function SortHeader({
  label,
  field,
  sortKey,
  sortDir,
  onToggle,
  align = "left",
}: {
  label: string;
  field: string;
  sortKey: string;
  sortDir: SortDir;
  onToggle: (k: string) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === field;
  return (
    <th
      className={`px-4 py-3 cursor-pointer select-none hover:bg-gray-100 transition-colors whitespace-nowrap ${
        align === "right" ? "text-right" : "text-left"
      }`}
      onClick={() => onToggle(field)}
    >
      <span className="inline-flex items-center gap-1">
        {align === "right" && active && (
          <span className="text-clippa-red">{sortDir === "asc" ? "\u25B2" : "\u25BC"}</span>
        )}
        <span>{label}</span>
        {align === "left" && active && (
          <span className="text-clippa-red">{sortDir === "asc" ? "\u25B2" : "\u25BC"}</span>
        )}
      </span>
    </th>
  );
}

function pctBadge(value: number, positive: boolean) {
  let color = "bg-gray-100 text-gray-600";
  if (positive) {
    if (value >= 80) color = "bg-green-100 text-green-700";
    else if (value >= 40) color = "bg-amber-100 text-amber-700";
    else color = "bg-red-100 text-red-700";
  } else {
    if (value < 10) color = "bg-green-100 text-green-700";
    else if (value < 50) color = "bg-amber-100 text-amber-700";
    else color = "bg-red-100 text-red-700";
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {value}%
    </span>
  );
}

function getMonthRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${String(lastDay).padStart(2, "0")}` };
}

export default function DashboardPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [adherence, setAdherence] = useState<AdherenceData | null>(null);
  const [loading, setLoading] = useState(true);

  const defaultRange = getMonthRange();
  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo] = useState(defaultRange.to);

  const fetchAdherence = useCallback((from: string, to: string) => {
    fetch(`/api/visits/adherence?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((data) => {
        if (data && data.totals) setAdherence(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/channels").then((r) => r.json()).catch(() => []),
      fetch("/api/reps").then((r) => r.json()).catch(() => []),
      fetch("/api/stores").then((r) => r.json()).catch(() => []),
      fetch("/api/teams").then((r) => r.json()).catch(() => []),
    ]).then(([ch, rp, st, tm]) => {
      setChannels(Array.isArray(ch) ? ch : []);
      setReps(Array.isArray(rp) ? rp : []);
      setStores(Array.isArray(st) ? st : []);
      setTeams(Array.isArray(tm) ? tm : []);
      setLoading(false);
    });
    fetchAdherence(defaultRange.from, defaultRange.to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDateChange = () => {
    fetchAdherence(dateFrom, dateTo);
  };

  const totalRevenue = useMemo(() => stores.reduce((s, st) => s + (st.monthlySales ?? 0), 0), [stores]);

  const teamStats = useMemo(() => {
    return teams.map((team) => {
      const teamReps = reps.filter((r) => r.teamId === team.id);
      const teamRepCodes = new Set(teamReps.map((r) => r.code));
      const teamStores = stores.filter((s) => teamRepCodes.has(s.repCode));
      const revenue = teamStores.reduce((s, st) => s + (st.monthlySales ?? 0), 0);
      const channelIds = new Set(teamStores.map((s) => s.channelId));
      const teamAdh = adherence?.byTeam[team.name] as AdherenceMetrics | undefined;
      return {
        ...team,
        repCount: teamReps.length,
        storeCount: teamStores.length,
        channelCount: channelIds.size,
        revenue,
        contribution: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
        accurateHitRate: teamAdh?.accurateHitRate ?? 0,
        storesVisitedPct: teamAdh?.storesVisitedPct ?? 0,
        unscheduledPct: teamAdh?.unscheduledPct ?? 0,
        missedPct: teamAdh?.missedPct ?? 0,
      };
    });
  }, [teams, reps, stores, totalRevenue, adherence]);

  const channelStats = useMemo(() => {
    return channels.map((ch) => {
      const chStores = stores.filter((s) => s.channelId === ch.id);
      const revenue = chStores.reduce((s, st) => s + (st.monthlySales ?? 0), 0);
      const repCodes = new Set(chStores.map((s) => s.repCode));
      const chAdh = adherence?.byChannel[ch.name] as AdherenceMetrics | undefined;
      return {
        ...ch,
        storeCount: chStores.length,
        revenue,
        repCount: repCodes.size,
        contribution: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
        accurateHitRate: chAdh?.accurateHitRate ?? 0,
        storesVisitedPct: chAdh?.storesVisitedPct ?? 0,
        unscheduledPct: chAdh?.unscheduledPct ?? 0,
        missedPct: chAdh?.missedPct ?? 0,
      };
    });
  }, [channels, stores, totalRevenue, adherence]);

  const repStats = useMemo(() => {
    return reps.map((rep) => {
      const repStores = stores.filter((s) => s.repCode === rep.code);
      const revenue = repStores.reduce((s, st) => s + (st.monthlySales ?? 0), 0);
      const repAdh = adherence?.byRep[rep.code];
      return {
        ...rep,
        storeCount: repStores.length,
        revenue,
        contribution: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
        accurateHitRate: repAdh?.accurateHitRate ?? 0,
        storesVisitedPct: repAdh?.storesVisitedPct ?? 0,
        unscheduledPct: repAdh?.unscheduledPct ?? 0,
        missedPct: repAdh?.missedPct ?? 0,
      };
    });
  }, [reps, stores, totalRevenue, adherence]);

  const teamSort = useSortable(teamStats, "revenue");
  const channelSort = useSortable(channelStats, "revenue");
  const repSort = useSortable(repStats, "revenue");

  const fmt = (n: number) =>
    "R " + (n ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-clippa-red border-t-transparent rounded-full" />
      </div>
    );
  }

  const totals = adherence?.totals;

  return (
    <div className="p-6 space-y-6">
      {/* Header stats */}
      <div className="grid grid-cols-5 gap-4">
        {[
          {
            label: "Total Stores",
            value: stores.length.toLocaleString(),
            color: "bg-blue-500",
            icon: (
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            ),
          },
          {
            label: "Active Reps",
            value: reps.length.toLocaleString(),
            color: "bg-green-500",
            icon: (
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            ),
          },
          {
            label: "Teams",
            value: teams.length.toLocaleString(),
            color: "bg-orange-500",
            icon: (
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ),
          },
          {
            label: "Channels",
            value: channels.length.toLocaleString(),
            color: "bg-purple-500",
            icon: (
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
            ),
          },
          {
            label: "Monthly Revenue",
            value: fmt(totalRevenue),
            color: "bg-clippa-red",
            icon: (
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ),
          },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <div className={`w-10 h-10 ${stat.color} rounded-lg flex items-center justify-center mb-3`}>
              {stat.icon}
            </div>
            <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
            <p className="text-xs text-gray-500 mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Call Cycle Adherence Section */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">Call Cycle Adherence</h2>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red"
            />
            <span className="text-gray-400 text-sm">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red"
            />
            <button
              onClick={handleDateChange}
              className="bg-clippa-red text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
            >
              Apply
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {/* Accurate Hit Rate */}
          <div className="rounded-lg border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <span className="text-xs text-gray-500 uppercase tracking-wider">Hit Rate</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{totals?.accurateHitRate ?? 0}%</p>
            <p className="text-[11px] text-gray-400 mt-1">Visits on exact assigned date</p>
          </div>

          {/* Stores Visited */}
          <div className="rounded-lg border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" />
                </svg>
              </div>
              <span className="text-xs text-gray-500 uppercase tracking-wider">Stores Visited</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{totals?.storesVisitedPct ?? 0}%</p>
            <p className="text-[11px] text-gray-400 mt-1">
              {totals ? `${totals.visitedStores}/${totals.scheduledStores} stores` : "—"}
            </p>
          </div>

          {/* Unscheduled */}
          <div className="rounded-lg border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <span className="text-xs text-gray-500 uppercase tracking-wider">Unscheduled</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{totals?.unscheduledPct ?? 0}%</p>
            <p className="text-[11px] text-gray-400 mt-1">
              {totals ? `${totals.unscheduledVisits}/${totals.totalVisits} visits` : "—"}
            </p>
          </div>

          {/* Missed */}
          <div className="rounded-lg border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <span className="text-xs text-gray-500 uppercase tracking-wider">Missed</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{totals?.missedPct ?? 0}%</p>
            <p className="text-[11px] text-gray-400 mt-1">
              {totals ? `${totals.missedStores}/${totals.scheduledStores} stores` : "—"}
            </p>
          </div>
        </div>
      </div>

      {/* Teams Grid */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Team Performance</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                <SortHeader label="Team" field="name" {...teamSort} />
                <SortHeader label="Manager" field="managerName" {...teamSort} />
                <SortHeader label="Area" field="area" {...teamSort} />
                <SortHeader label="Reps" field="repCount" align="right" {...teamSort} />
                <SortHeader label="Stores" field="storeCount" align="right" {...teamSort} />
                <SortHeader label="Channels" field="channelCount" align="right" {...teamSort} />
                <SortHeader label="Revenue" field="revenue" align="right" {...teamSort} />
                <SortHeader label="Contribution" field="contribution" align="right" {...teamSort} />
                <SortHeader label="Hit Rate" field="accurateHitRate" align="right" {...teamSort} />
                <SortHeader label="Visited" field="storesVisitedPct" align="right" {...teamSort} />
                <SortHeader label="Unsched." field="unscheduledPct" align="right" {...teamSort} />
                <SortHeader label="Missed" field="missedPct" align="right" {...teamSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {teamSort.sorted.map((team) => (
                <tr key={team.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{team.name}</td>
                  <td className="px-4 py-3 text-gray-600">{team.managerName}</td>
                  <td className="px-4 py-3 text-gray-500">{team.area}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{team.repCount}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{team.storeCount}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{team.channelCount}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{fmt(team.revenue)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 bg-gray-200 rounded-full h-1.5">
                        <div className="bg-orange-500 h-1.5 rounded-full" style={{ width: `${Math.min(team.contribution, 100)}%` }} />
                      </div>
                      <span className="text-gray-600 w-12 text-right">{team.contribution.toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">{pctBadge(team.accurateHitRate, true)}</td>
                  <td className="px-4 py-3 text-right">{pctBadge(team.storesVisitedPct, true)}</td>
                  <td className="px-4 py-3 text-right">{pctBadge(team.unscheduledPct, false)}</td>
                  <td className="px-4 py-3 text-right">{pctBadge(team.missedPct, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Channel Grid */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Channel Performance</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                <SortHeader label="Channel" field="name" {...channelSort} />
                <SortHeader label="Stores" field="storeCount" align="right" {...channelSort} />
                <SortHeader label="Revenue" field="revenue" align="right" {...channelSort} />
                <SortHeader label="Reps" field="repCount" align="right" {...channelSort} />
                <SortHeader label="Contribution" field="contribution" align="right" {...channelSort} />
                <SortHeader label="Hit Rate" field="accurateHitRate" align="right" {...channelSort} />
                <SortHeader label="Visited" field="storesVisitedPct" align="right" {...channelSort} />
                <SortHeader label="Unsched." field="unscheduledPct" align="right" {...channelSort} />
                <SortHeader label="Missed" field="missedPct" align="right" {...channelSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {channelSort.sorted.map((ch) => (
                <tr key={ch.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{ch.name}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{ch.storeCount}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{fmt(ch.revenue)}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{ch.repCount}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 bg-gray-200 rounded-full h-1.5">
                        <div className="bg-clippa-red h-1.5 rounded-full" style={{ width: `${Math.min(ch.contribution, 100)}%` }} />
                      </div>
                      <span className="text-gray-600 w-12 text-right">{ch.contribution.toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">{pctBadge(ch.accurateHitRate, true)}</td>
                  <td className="px-4 py-3 text-right">{pctBadge(ch.storesVisitedPct, true)}</td>
                  <td className="px-4 py-3 text-right">{pctBadge(ch.unscheduledPct, false)}</td>
                  <td className="px-4 py-3 text-right">{pctBadge(ch.missedPct, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rep Grid */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Rep Performance</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                <SortHeader label="Rep" field="name" {...repSort} />
                <SortHeader label="Code" field="code" {...repSort} />
                <SortHeader label="Stores" field="storeCount" align="right" {...repSort} />
                <SortHeader label="Revenue" field="revenue" align="right" {...repSort} />
                <SortHeader label="Contribution" field="contribution" align="right" {...repSort} />
                <SortHeader label="Hit Rate" field="accurateHitRate" align="right" {...repSort} />
                <SortHeader label="Visited" field="storesVisitedPct" align="right" {...repSort} />
                <SortHeader label="Unsched." field="unscheduledPct" align="right" {...repSort} />
                <SortHeader label="Missed" field="missedPct" align="right" {...repSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {repSort.sorted.map((rep) => (
                <tr key={rep.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{rep.name}</td>
                  <td className="px-4 py-3 text-gray-500">{rep.code}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{rep.storeCount}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{fmt(rep.revenue)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 bg-gray-200 rounded-full h-1.5">
                        <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${Math.min(rep.contribution, 100)}%` }} />
                      </div>
                      <span className="text-gray-600 w-12 text-right">{rep.contribution.toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">{pctBadge(rep.accurateHitRate, true)}</td>
                  <td className="px-4 py-3 text-right">{pctBadge(rep.storesVisitedPct, true)}</td>
                  <td className="px-4 py-3 text-right">{pctBadge(rep.unscheduledPct, false)}</td>
                  <td className="px-4 py-3 text-right">{pctBadge(rep.missedPct, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
