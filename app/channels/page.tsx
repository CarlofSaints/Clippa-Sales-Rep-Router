"use client";

import { useState, useEffect } from "react";
import { Channel, FREQUENCY_OPTIONS, FrequencyType, getFrequencyLabel } from "@/lib/types";

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Channel>>({});
  const [saving, setSaving] = useState(false);

  const load = () => {
    fetch("/api/channels")
      .then((r) => r.json())
      .then((data) => {
        setChannels(data);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, []);

  const startEdit = (ch: Channel) => {
    setEditing(ch.id);
    setEditData({ name: ch.name, frequency: ch.frequency, duration: ch.duration });
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditData({});
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    await fetch("/api/channels", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...editData }),
    });
    setEditing(null);
    setEditData({});
    setSaving(false);
    load();
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Channels</h1>
          <p className="text-sm text-gray-500">{channels.length} channels configured</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-6 py-3 w-8">#</th>
                <th className="px-6 py-3">Channel Name</th>
                <th className="px-6 py-3">Default Frequency</th>
                <th className="px-6 py-3 text-right">Duration (min)</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {channels.map((ch, i) => (
                <tr key={ch.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3 text-gray-400">{i + 1}</td>

                  {editing === ch.id ? (
                    <>
                      <td className="px-6 py-3">
                        <input
                          value={editData.name || ""}
                          onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-clippa-red"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <select
                          value={editData.frequency || "monthly"}
                          onChange={(e) => setEditData({ ...editData, frequency: e.target.value as FrequencyType })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-clippa-red"
                        >
                          {FREQUENCY_OPTIONS.map((f) => (
                            <option key={f.value} value={f.value}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-6 py-3">
                        <input
                          type="number"
                          value={editData.duration ?? 30}
                          onChange={(e) => setEditData({ ...editData, duration: Number(e.target.value) })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-20 text-right focus:outline-none focus:ring-1 focus:ring-clippa-red"
                        />
                      </td>
                      <td className="px-6 py-3 text-right space-x-2">
                        <button
                          onClick={() => saveEdit(ch.id)}
                          disabled={saving}
                          className="text-green-600 hover:text-green-800 text-xs font-medium"
                        >
                          Save
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="text-gray-400 hover:text-gray-600 text-xs font-medium"
                        >
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-6 py-3 font-medium text-gray-900">{ch.name}</td>
                      <td className="px-6 py-3 text-gray-600">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                          {getFrequencyLabel(ch.frequency)}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right text-gray-600">{ch.duration} min</td>
                      <td className="px-6 py-3 text-right">
                        <button
                          onClick={() => startEdit(ch)}
                          className="text-clippa-red hover:text-red-800 text-xs font-medium"
                        >
                          Edit
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
