"use client";

import { useState, useEffect } from "react";
import { UserRole, ROLE_DEFINITIONS, ALL_PERMISSIONS } from "@/lib/types";

interface UserData {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  forcePasswordChange?: boolean;
}

const ROLES: { value: UserRole; label: string; description: string }[] = [
  { value: "superAdmin", label: "Super Admin", description: "Full access to all settings, users, and data" },
  { value: "admin", label: "Admin", description: "Can manage reps, stores, channels, and view reports" },
  { value: "teamManager", label: "Team Manager", description: "Can view and manage their assigned team and reps" },
  { value: "rep", label: "Rep", description: "Can view their own routes and store assignments" },
  { value: "viewer", label: "Viewer", description: "Read-only access to dashboards and reports" },
];

const ROLE_COLORS: Record<UserRole, string> = {
  superAdmin: "bg-red-50 text-red-700",
  admin: "bg-blue-50 text-blue-700",
  teamManager: "bg-green-50 text-green-700",
  rep: "bg-purple-50 text-purple-700",
  viewer: "bg-gray-100 text-gray-600",
};

const ROLE_DOTS: Record<UserRole, string> = {
  superAdmin: "bg-clippa-red",
  admin: "bg-blue-500",
  teamManager: "bg-green-500",
  rep: "bg-purple-500",
  viewer: "bg-gray-400",
};

export default function AdminPage() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "", role: "viewer" as UserRole });
  const [editing, setEditing] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<UserData & { password: string }>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState<"info" | "success" | "error">("info");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const showMsg = (text: string, type: "info" | "success" | "error" = "info") => {
    setMsg(text);
    setMsgType(type);
    setTimeout(() => setMsg(""), 5000);
  };

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
      showMsg("All fields required", "error");
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
      showMsg(data.error || "Error", "error");
    } else {
      showMsg(`User ${data.name} created`, "success");
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

  const forcePwChange = async (user: UserData) => {
    setActionLoading(user.id + "-pw");
    const res = await fetch("/api/users", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: user.id, forcePasswordChange: true }),
    });
    if (res.ok) {
      showMsg(`${user.name} will be required to change password on next login`, "success");
      load();
    } else {
      showMsg("Failed to set force password change", "error");
    }
    setActionLoading(null);
  };

  const sendWelcome = async (user: UserData) => {
    setActionLoading(user.id + "-email");
    try {
      const res = await fetch("/api/users/send-welcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        showMsg(data.error || "Failed to send welcome email", "error");
      } else if (data.sent) {
        showMsg(`Welcome email sent to ${user.email}`, "success");
      } else {
        showMsg(`Temp password for ${user.email}: ${data.tempPassword} (no email service configured — share manually)`, "info");
      }
      load();
    } catch {
      showMsg("Network error sending welcome email", "error");
    }
    setActionLoading(null);
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
        <div className={`p-3 rounded-lg text-sm ${
          msgType === "success" ? "bg-green-50 text-green-700" :
          msgType === "error" ? "bg-red-50 text-red-700" :
          "bg-blue-50 text-blue-700"
        }`}>
          {msg}
        </div>
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

      {/* Users Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Users</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Email</th>
                <th className="px-6 py-3">Role</th>
                <th className="px-6 py-3">Status</th>
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
                      <td className="px-6 py-3" />
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
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[user.role] || "bg-gray-100 text-gray-600"}`}>
                          {ROLES.find((r) => r.value === user.role)?.label || user.role}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        {user.forcePasswordChange && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                            PW Change Required
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => forcePwChange(user)}
                            disabled={actionLoading === user.id + "-pw"}
                            title="Force password change on next login"
                            className="text-amber-600 hover:text-amber-800 text-xs font-medium px-2 py-1 rounded hover:bg-amber-50 disabled:opacity-50"
                          >
                            {actionLoading === user.id + "-pw" ? (
                              <span className="inline-block w-3 h-3 border border-amber-600 border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <svg className="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                              </svg>
                            )}
                          </button>
                          <button
                            onClick={() => sendWelcome(user)}
                            disabled={actionLoading === user.id + "-email"}
                            title="Send welcome email with temp password"
                            className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 disabled:opacity-50"
                          >
                            {actionLoading === user.id + "-email" ? (
                              <span className="inline-block w-3 h-3 border border-blue-600 border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <svg className="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                              </svg>
                            )}
                          </button>
                          <button
                            onClick={() => { setEditing(user.id); setEditData({ name: user.name, email: user.email, role: user.role }); }}
                            className="text-clippa-red hover:text-red-800 text-xs font-medium px-2 py-1 rounded hover:bg-red-50"
                          >
                            Edit
                          </button>
                          <button onClick={() => deleteUser(user.id)} className="text-gray-400 hover:text-red-600 text-xs font-medium px-2 py-1 rounded hover:bg-gray-50">
                            Delete
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Roles & Permissions Matrix */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Roles &amp; Permissions</h3>
          <p className="text-xs text-gray-500 mt-1">Permission matrix for each role</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-6 py-3 text-left">Permission</th>
                {ROLE_DEFINITIONS.map((rd) => (
                  <th key={rd.role} className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${ROLE_DOTS[rd.role]}`} />
                      <span>{rd.label}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ALL_PERMISSIONS.map((perm) => (
                <tr key={perm.key} className="hover:bg-gray-50">
                  <td className="px-6 py-3 text-gray-700 font-medium">{perm.label}</td>
                  {ROLE_DEFINITIONS.map((rd) => {
                    const has = rd.permissions.includes(perm.key);
                    return (
                      <td key={rd.role} className="px-4 py-3 text-center">
                        {has ? (
                          <svg className="w-5 h-5 text-green-500 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5 text-gray-300 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 border-t border-gray-100">
          <div className="flex flex-wrap gap-4">
            {ROLE_DEFINITIONS.map((rd) => (
              <div key={rd.role} className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${ROLE_DOTS[rd.role]}`} />
                <span className="text-xs text-gray-500">{rd.label}: {rd.description}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
