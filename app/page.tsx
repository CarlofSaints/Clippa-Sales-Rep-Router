"use client";

import { useState, useEffect, useMemo } from "react";
import { Channel, Rep, Store, Team } from "@/lib/types";

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
      className={`px-6 py-3 cursor-pointer select-none hover:bg-gray-100 transition-colors ${
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

export default function DashboardPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

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
  }, []);

  const totalRevenue = useMemo(() => stores.reduce((s, st) => s + st.monthlySales, 0), [stores]);

  const teamStats = useMemo(() => {
    return teams.map((team) => {
      const teamReps = reps.filter((r) => r.teamId === team.id);
      const teamRepCodes = new Set(teamReps.map((r) => r.code));
      const teamStores = stores.filter((s) => teamRepCodes.has(s.repCode));
      const revenue = teamStores.reduce((s, st) => s + st.monthlySales, 0);
      const channelIds = new Set(teamStores.map((s) => s.channelId));
      return {
        ...team,
        repCount: teamReps.length,
        storeCount: teamStores.length,
        channelCount: channelIds.size,
        revenue,
        contribution: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
      };
    });
  }, [teams, reps, stores, totalRevenue]);

  const channelStats = useMemo(() => {
    return channels.map((ch) => {
      const chStores = stores.filter((s) => s.channelId === ch.id);
      const revenue = chStores.reduce((s, st) => s + st.monthlySales, 0);
      const repCodes = new Set(chStores.map((s) => s.repCode));
      return {
        ...ch,
        storeCount: chStores.length,
        revenue,
        repCount: repCodes.size,
        contribution: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
      };
    });
  }, [channels, stores, totalRevenue]);

  const repStats = useMemo(() => {
    return reps.map((rep) => {
      const repStores = stores.filter((s) => s.repCode === rep.code);
      const revenue = repStores.reduce((s, st) => s + st.monthlySales, 0);
      return {
        ...rep,
        storeCount: repStores.length,
        revenue,
        contribution: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
      };
    });
  }, [reps, stores, totalRevenue]);

  const teamSort = useSortable(teamStats, "revenue");
  const channelSort = useSortable(channelStats, "revenue");
  const repSort = useSortable(repStats, "revenue");

  const fmt = (n: number) =>
    "R " + n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-clippa-red border-t-transparent rounded-full" />
      </div>
    );
  }

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
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {teamSort.sorted.map((team) => (
                <tr key={team.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3 font-medium text-gray-900">{team.name}</td>
                  <td className="px-6 py-3 text-gray-600">{team.managerName}</td>
                  <td className="px-6 py-3 text-gray-500">{team.area}</td>
                  <td className="px-6 py-3 text-right text-gray-600">{team.repCount}</td>
                  <td className="px-6 py-3 text-right text-gray-600">{team.storeCount}</td>
                  <td className="px-6 py-3 text-right text-gray-600">{team.channelCount}</td>
                  <td className="px-6 py-3 text-right text-gray-600">{fmt(team.revenue)}</td>
                  <td className="px-6 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 bg-gray-200 rounded-full h-1.5">
                        <div className="bg-orange-500 h-1.5 rounded-full" style={{ width: `${Math.min(team.contribution, 100)}%` }} />
                      </div>
                      <span className="text-gray-600 w-12 text-right">{team.contribution.toFixed(1)}%</span>
                    </div>
                  </td>
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
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {channelSort.sorted.map((ch) => (
                <tr key={ch.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3 font-medium text-gray-900">{ch.name}</td>
                  <td className="px-6 py-3 text-right text-gray-600">{ch.storeCount}</td>
                  <td className="px-6 py-3 text-right text-gray-600">{fmt(ch.revenue)}</td>
                  <td className="px-6 py-3 text-right text-gray-600">{ch.repCount}</td>
                  <td className="px-6 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 bg-gray-200 rounded-full h-1.5">
                        <div className="bg-clippa-red h-1.5 rounded-full" style={{ width: `${Math.min(ch.contribution, 100)}%` }} />
                      </div>
                      <span className="text-gray-600 w-12 text-right">{ch.contribution.toFixed(1)}%</span>
                    </div>
                  </td>
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
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {repSort.sorted.map((rep) => (
                <tr key={rep.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3 font-medium text-gray-900">{rep.name}</td>
                  <td className="px-6 py-3 text-gray-500">{rep.code}</td>
                  <td className="px-6 py-3 text-right text-gray-600">{rep.storeCount}</td>
                  <td className="px-6 py-3 text-right text-gray-600">{fmt(rep.revenue)}</td>
                  <td className="px-6 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 bg-gray-200 rounded-full h-1.5">
                        <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${Math.min(rep.contribution, 100)}%` }} />
                      </div>
                      <span className="text-gray-600 w-12 text-right">{rep.contribution.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
