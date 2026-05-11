"use client";

import { useState, useEffect } from "react";
import { UserRole } from "@/lib/types";

interface UserData {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

const ROLES: { value: UserRole; label: string; description: string }[] = [
  { value: "superAdmin", label: "Super Admin", description: "Full access to all settings, users, and data" },
  { value: "admin", label: "Admin", description: "Can manage reps, stores, channels, and view reports" },
  { value: "teamManager", label: "Team Manager", description: "Can view and manage their assigned team and reps" },
  { value: "rep", label: "Rep", description: "Can view their own routes and store assignments" },
  { value: "viewer", label: "Viewer", description: "Read-only access to dashboards and reports" },
];

export default function AdminPage() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "", role: "viewer" as UserRole });
  const [editing, setEditing] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<UserData & { password: string }>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const load = () => {
    fetch("/api/users")
      .then((r) => r.json())
      .then((data) => {
        setUsers(data);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, []);

  const addUser = async () => {
    if (!newUser.name || !newUser.email || !newUser.password) {
      setMsg("All fields required");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newUser),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "Error");
    } else {
      setMsg(`User ${data.name} created`);
      setShowAdd(false);
      setNewUser({ name: "", email: "", password: "", role: "viewer" });
      load();
    }
    setSaving(false);
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    await fetch("/api/users", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...editData }),
    });
    setEditing(null);
    setEditData({});
    setSaving(false);
    load();
  };

  const deleteUser = async (id: string) => {
    if (!confirm("Delete this user?")) return;
    await fetch("/api/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
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
          <h1 className="text-xl font-bold text-gray-900">Admin &amp; Permissions</h1>
          <p className="text-sm text-gray-500">{users.length} users</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="bg-clippa-red text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700"
        >
          + Add User
        </button>
      </div>

      {msg && (
        <div className="p-3 rounded-lg bg-blue-50 text-blue-700 text-sm">{msg}</div>
      )}

      {/* Add User */}
      {showAdd && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">New User</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
              <input
                value={newUser.name}
                onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
              <input
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
              <select
                value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value as UserRole })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red"
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={addUser} disabled={saving} className="bg-clippa-red text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50">
              {saving ? "Saving..." : "Create User"}
            </button>
            <button onClick={() => setShowAdd(false)} className="text-gray-500 px-4 py-2 rounded-lg text-sm hover:bg-gray-100">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Roles Reference */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h3 className="font-semibold text-gray-900 mb-3">Roles &amp; Permissions</h3>
        <div className="grid grid-cols-3 gap-4">
          {ROLES.map((role) => (
            <div key={role.value} className="border border-gray-100 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-2 h-2 rounded-full ${
                  role.value === "superAdmin" ? "bg-clippa-red" :
                  role.value === "admin" ? "bg-blue-500" :
                  role.value === "teamManager" ? "bg-green-500" :
                  role.value === "rep" ? "bg-purple-500" : "bg-gray-400"
                }`} />
                <span className="font-medium text-sm text-gray-900">{role.label}</span>
              </div>
              <p className="text-xs text-gray-500">{role.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Email</th>
                <th className="px-6 py-3">Role</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  {editing === user.id ? (
                    <>
                      <td className="px-6 py-3">
                        <input
                          value={editData.name || ""}
                          onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-full"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <input
                          value={editData.email || ""}
                          onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-full"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <select
                          value={editData.role || "viewer"}
                          onChange={(e) => setEditData({ ...editData, role: e.target.value as UserRole })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm"
                        >
                          {ROLES.map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-6 py-3 text-right space-x-2">
                        <button onClick={() => saveEdit(user.id)} disabled={saving} className="text-green-600 hover:text-green-800 text-xs font-medium">Save</button>
                        <button onClick={() => { setEditing(null); setEditData({}); }} className="text-gray-400 hover:text-gray-600 text-xs font-medium">Cancel</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-6 py-3 font-medium text-gray-900">{user.name}</td>
                      <td className="px-6 py-3 text-gray-600">{user.email}</td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          user.role === "superAdmin" ? "bg-red-50 text-red-700" :
                          user.role === "admin" ? "bg-blue-50 text-blue-700" :
                          user.role === "teamManager" ? "bg-green-50 text-green-700" :
                          user.role === "rep" ? "bg-purple-50 text-purple-700" :
                          "bg-gray-100 text-gray-600"
                        }`}>
                          {ROLES.find((r) => r.value === user.role)?.label || user.role}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right space-x-2">
                        <button
                          onClick={() => { setEditing(user.id); setEditData({ name: user.name, email: user.email, role: user.role }); }}
                          className="text-clippa-red hover:text-red-800 text-xs font-medium"
                        >
                          Edit
                        </button>
                        <button onClick={() => deleteUser(user.id)} className="text-gray-400 hover:text-red-600 text-xs font-medium">
                          Delete
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
