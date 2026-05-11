"use client";

import { useState, useEffect, useMemo } from "react";
import { Team, Rep } from "@/lib/types";

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newTeam, setNewTeam] = useState<Partial<Team>>({ name: "", managerName: "", managerEmail: "", managerCell: "", area: "" });
  const [editing, setEditing] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Team>>({});
  const [saving, setSaving] = useState(false);
  const [assigningRep, setAssigningRep] = useState<string | null>(null);

  const load = () => {
    Promise.all([
      fetch("/api/teams").then((r) => r.json()),
      fetch("/api/reps").then((r) => r.json()),
    ]).then(([t, r]) => {
      setTeams(t);
      setReps(r);
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, []);

  const repsByTeam = useMemo(() => {
    const map = new Map<string, Rep[]>();
    reps.forEach((r) => {
      const tid = r.teamId || "unassigned";
      const arr = map.get(tid) || [];
      arr.push(r);
      map.set(tid, arr);
    });
    return map;
  }, [reps]);

  const unassignedReps = useMemo(() => reps.filter((r) => !r.teamId), [reps]);

  const addTeam = async () => {
    setSaving(true);
    await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newTeam),
    });
    setShowAdd(false);
    setNewTeam({ name: "", managerName: "", managerEmail: "", managerCell: "", area: "" });
    setSaving(false);
    load();
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    await fetch("/api/teams", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...editData }),
    });
    setEditing(null);
    setEditData({});
    setSaving(false);
    load();
  };

  const deleteTeam = async (id: string) => {
    if (!confirm("Delete this team? Reps will become unassigned.")) return;
    // Unassign reps first
    const teamReps = repsByTeam.get(id) || [];
    for (const rep of teamReps) {
      await fetch("/api/reps", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rep.id, teamId: "" }),
      });
    }
    await fetch("/api/teams", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    load();
  };

  const assignRep = async (repId: string, teamId: string) => {
    await fetch("/api/reps", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: repId, teamId }),
    });
    setAssigningRep(null);
    load();
  };

  const removeRepFromTeam = async (repId: string) => {
    await fetch("/api/reps", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: repId, teamId: "" }),
    });
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
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Teams &amp; Area Managers</h1>
          <p className="text-sm text-gray-500">{teams.length} teams, {unassignedReps.length} unassigned reps</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="bg-clippa-red text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700"
        >
          + New Team
        </button>
      </div>

      {/* Add Team Form */}
      {showAdd && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Create Team</h3>
          <div className="grid grid-cols-2 gap-4">
            {[
              { key: "name", label: "Team Name", placeholder: "e.g. Gauteng North" },
              { key: "area", label: "Area", placeholder: "e.g. Pretoria, Centurion, Midrand" },
              { key: "managerName", label: "Manager Name", placeholder: "Full Name" },
              { key: "managerEmail", label: "Manager Email", placeholder: "email@company.com" },
              { key: "managerCell", label: "Manager Cell", placeholder: "+27..." },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                <input
                  value={(newTeam as Record<string, string>)[key] || ""}
                  onChange={(e) => setNewTeam({ ...newTeam, [key]: e.target.value })}
                  placeholder={placeholder}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red"
                />
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={addTeam} disabled={saving} className="bg-clippa-red text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50">
              {saving ? "Creating..." : "Create Team"}
            </button>
            <button onClick={() => setShowAdd(false)} className="text-gray-500 px-4 py-2 rounded-lg text-sm hover:bg-gray-100">Cancel</button>
          </div>
        </div>
      )}

      {/* Team Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {teams.map((team) => {
          const teamReps = repsByTeam.get(team.id) || [];
          const isEditing = editing === team.id;

          return (
            <div key={team.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="bg-gray-50 px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                {isEditing ? (
                  <div className="flex-1 grid grid-cols-2 gap-2 mr-4">
                    <input value={editData.name || ""} onChange={(e) => setEditData({ ...editData, name: e.target.value })} className="border border-gray-200 rounded px-2 py-1 text-sm" placeholder="Team Name" />
                    <input value={editData.area || ""} onChange={(e) => setEditData({ ...editData, area: e.target.value })} className="border border-gray-200 rounded px-2 py-1 text-sm" placeholder="Area" />
                    <input value={editData.managerName || ""} onChange={(e) => setEditData({ ...editData, managerName: e.target.value })} className="border border-gray-200 rounded px-2 py-1 text-sm" placeholder="Manager Name" />
                    <input value={editData.managerEmail || ""} onChange={(e) => setEditData({ ...editData, managerEmail: e.target.value })} className="border border-gray-200 rounded px-2 py-1 text-sm" placeholder="Manager Email" />
                    <input value={editData.managerCell || ""} onChange={(e) => setEditData({ ...editData, managerCell: e.target.value })} className="border border-gray-200 rounded px-2 py-1 text-sm" placeholder="Manager Cell" />
                  </div>
                ) : (
                  <div>
                    <h3 className="font-semibold text-gray-900">{team.name}</h3>
                    <p className="text-xs text-gray-500">{team.area}</p>
                  </div>
                )}
                <div className="flex gap-2 flex-shrink-0">
                  {isEditing ? (
                    <>
                      <button onClick={() => saveEdit(team.id)} className="text-green-600 text-xs font-medium">Save</button>
                      <button onClick={() => { setEditing(null); setEditData({}); }} className="text-gray-400 text-xs font-medium">Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { setEditing(team.id); setEditData({ ...team }); }} className="text-clippa-red text-xs font-medium">Edit</button>
                      <button onClick={() => deleteTeam(team.id)} className="text-gray-400 text-xs font-medium">Delete</button>
                    </>
                  )}
                </div>
              </div>

              {/* Manager info */}
              {!isEditing && (
                <div className="px-6 py-3 bg-blue-50 border-b border-blue-100">
                  <p className="text-xs text-blue-600">
                    <span className="font-medium">Manager:</span> {team.managerName || "Not assigned"}
                    {team.managerEmail && <span className="ml-2 text-blue-400">{team.managerEmail}</span>}
                    {team.managerCell && <span className="ml-2 text-blue-400">{team.managerCell}</span>}
                  </p>
                </div>
              )}

              {/* Reps list */}
              <div className="px-6 py-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-500 uppercase">
                    Reps ({teamReps.length})
                  </span>
                  <button
                    onClick={() => setAssigningRep(team.id)}
                    className="text-xs text-clippa-red hover:text-red-800 font-medium"
                  >
                    + Assign Rep
                  </button>
                </div>

                {teamReps.length === 0 ? (
                  <p className="text-xs text-gray-400 italic py-2">No reps assigned</p>
                ) : (
                  <div className="space-y-1">
                    {teamReps.map((rep) => (
                      <div key={rep.id} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">{rep.code}</span>
                          <span className="text-sm text-gray-900">{rep.name}</span>
                        </div>
                        <button
                          onClick={() => removeRepFromTeam(rep.id)}
                          className="text-xs text-gray-400 hover:text-red-600"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Assign rep dropdown */}
                {assigningRep === team.id && (
                  <div className="mt-2 border border-gray-200 rounded-lg p-2 bg-gray-50">
                    <p className="text-xs text-gray-500 mb-1">Select a rep to assign:</p>
                    {unassignedReps.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">All reps are assigned</p>
                    ) : (
                      <div className="space-y-1">
                        {unassignedReps.map((rep) => (
                          <button
                            key={rep.id}
                            onClick={() => assignRep(rep.id, team.id)}
                            className="w-full text-left px-2 py-1 rounded hover:bg-white text-sm text-gray-700"
                          >
                            {rep.name} ({rep.code})
                          </button>
                        ))}
                      </div>
                    )}
                    <button onClick={() => setAssigningRep(null)} className="text-xs text-gray-400 mt-2">Cancel</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Unassigned Reps */}
      {unassignedReps.length > 0 && (
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-6">
          <h3 className="font-semibold text-amber-800 mb-3">Unassigned Reps ({unassignedReps.length})</h3>
          <div className="grid grid-cols-3 gap-2">
            {unassignedReps.map((rep) => (
              <div key={rep.id} className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-amber-100">
                <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">{rep.code}</span>
                <span className="text-sm text-gray-900">{rep.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
