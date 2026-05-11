"use client";

import { useState, useEffect, useMemo } from "react";
import { Channel, Rep, Store } from "@/lib/types";

export default function DashboardPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/channels").then((r) => r.json()),
      fetch("/api/reps").then((r) => r.json()),
      fetch("/api/stores").then((r) => r.json()),
    ]).then(([ch, rp, st]) => {
      setChannels(ch);
      setReps(rp);
      setStores(st);
      setLoading(false);
    });
  }, []);

  const totalRevenue = useMemo(() => stores.reduce((s, st) => s + st.monthlySales, 0), [stores]);

  const channelStats = useMemo(() => {
    return channels
      .map((ch) => {
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
      })
      .sort((a, b) => b.revenue - a.revenue);
  }, [channels, stores, totalRevenue]);

  const repStats = useMemo(() => {
    return reps
      .map((rep) => {
        const repStores = stores.filter((s) => s.repCode === rep.code);
        const revenue = repStores.reduce((s, st) => s + st.monthlySales, 0);
        return {
          ...rep,
          storeCount: repStores.length,
          revenue,
          contribution: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);
  }, [reps, stores, totalRevenue]);

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
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Stores", value: stores.length.toLocaleString(), color: "bg-blue-500" },
          { label: "Active Reps", value: reps.length.toLocaleString(), color: "bg-green-500" },
          { label: "Channels", value: channels.length.toLocaleString(), color: "bg-purple-500" },
          { label: "Monthly Revenue", value: fmt(totalRevenue), color: "bg-clippa-red" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <div className={`w-10 h-10 ${stat.color} rounded-lg flex items-center justify-center mb-3`}>
              <span className="text-white font-bold text-sm">
                {stat.label[0]}
              </span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
            <p className="text-xs text-gray-500 mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Channel Grid */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Channel Performance</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-6 py-3">Channel</th>
                <th className="px-6 py-3 text-right">Stores</th>
                <th className="px-6 py-3 text-right">Revenue</th>
                <th className="px-6 py-3 text-right">Reps</th>
                <th className="px-6 py-3 text-right">Contribution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {channelStats.map((ch) => (
                <tr key={ch.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3 font-medium text-gray-900">{ch.name}</td>
                  <td className="px-6 py-3 text-right text-gray-600">{ch.storeCount}</td>
                  <td className="px-6 py-3 text-right text-gray-600">{fmt(ch.revenue)}</td>
                  <td className="px-6 py-3 text-right text-gray-600">{ch.repCount}</td>
                  <td className="px-6 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 bg-gray-200 rounded-full h-1.5">
                        <div
                          className="bg-clippa-red h-1.5 rounded-full"
                          style={{ width: `${Math.min(ch.contribution, 100)}%` }}
                        />
                      </div>
                      <span className="text-gray-600 w-12 text-right">
                        {ch.contribution.toFixed(1)}%
                      </span>
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
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-6 py-3">Rep</th>
                <th className="px-6 py-3">Code</th>
                <th className="px-6 py-3 text-right">Stores</th>
                <th className="px-6 py-3 text-right">Revenue</th>
                <th className="px-6 py-3 text-right">Contribution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {repStats.map((rep) => (
                <tr key={rep.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3 font-medium text-gray-900">{rep.name}</td>
                  <td className="px-6 py-3 text-gray-500">{rep.code}</td>
                  <td className="px-6 py-3 text-right text-gray-600">{rep.storeCount}</td>
                  <td className="px-6 py-3 text-right text-gray-600">{fmt(rep.revenue)}</td>
                  <td className="px-6 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 bg-gray-200 rounded-full h-1.5">
                        <div
                          className="bg-green-500 h-1.5 rounded-full"
                          style={{ width: `${Math.min(rep.contribution, 100)}%` }}
                        />
                      </div>
                      <span className="text-gray-600 w-12 text-right">
                        {rep.contribution.toFixed(1)}%
                      </span>
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
