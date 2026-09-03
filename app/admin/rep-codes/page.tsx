"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { useTableSort, useSortedRows, SortableTh } from "@/components/TableSort";

/**
 * Which rep codes are actually a rep.
 *
 * The same idea as "Called on?" on the Channels page, applied to the other
 * axis: a channel decides which SHOPS get visited, this decides which CODES
 * are a person in the field at all. IMS bills sales under codes that belong to
 * a third-party agent (CMR*) and to other businesses (IRAM*), and until they
 * were named they were counted as unrouted opportunity.
 *
 * ⚠️ It says at the top, and means, that this does NOT change any route. That
 * matters: the obvious assumption on seeing "not a rep" is that their shops
 * stop being visited, and a store linked to one of these codes is more likely
 * to be linked wrongly than to be genuinely un-visitable.
 */

interface Verdict {
  code: string;
  routable: boolean;
  reason: "explicit" | "prefix" | "default";
  prefix?: string;
  prefixLabel?: string;
  note?: string;
}

interface CodeRow {
  code: string;
  imsOutlets: number;
  imsUnrouted: number;
  sixMonthSales: number;
  unroutedSixMonthSales: number;
  routerStores: number;
  repName: string | null;
  verdict: Verdict;
}

interface PrefixRule {
  id: string;
  prefix: string;
  label: string;
  createdAt: string;
  createdBy: string;
}

interface Payload {
  rows: CodeRow[];
  totalCodes: number;
  excludedCodes: number;
  chaseable: { outlets: number; sixMonthSales: number };
  excluded: { outlets: number; sixMonthSales: number };
  rules: { codes: unknown[]; prefixes: PrefixRule[] };
  snapshotFetchedAt: string | null;
  hasSnapshot: boolean;
}

const rand = (v: number) =>
  `R ${Math.round(v).toLocaleString("en-ZA")}`;

/** Millions, for the two headline numbers where the exact rand is noise. */
const randM = (v: number) =>
  v === 0 ? "R 0" : `R ${(v / 1_000_000).toLocaleString("en-ZA", { maximumFractionDigits: 1 })}m`;

const num = (v: number) => v.toLocaleString("en-ZA");

type Filter = "all" | "excluded" | "reps" | "undecided" | "no_rep_record";

export default function RepCodesPage() {
  const { can } = useSession();
  const canEdit = can("manage_reps");

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const [showAddRule, setShowAddRule] = useState(false);
  const [newPrefix, setNewPrefix] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const sort = useTableSort("sixMonthSales", "desc");

  const load = useCallback(() => {
    setError("");
    fetch("/api/rep-codes")
      .then(async (res) => {
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || `Could not load rep codes (${res.status})`);
        return d;
      })
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const post = async (body: unknown, tag: string, done: (r: Record<string, unknown>) => string) => {
    setBusy(tag);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/rep-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `Failed (${res.status})`);
      setMessage(done(d));
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  };

  const decide = (code: string, routable: boolean | null) =>
    post({ code, routable }, code, () =>
      routable === null
        ? `${code} follows the rules again.`
        : `${code} is ${routable ? "a rep" : "not a rep"}.`
    );

  const addRule = () =>
    post({ prefix: newPrefix, label: newLabel }, "rule", (d) => {
      const matched = (d.matched as string[]) ?? [];
      setShowAddRule(false);
      setNewPrefix("");
      setNewLabel("");
      return matched.length === 0
        ? `Rule saved, but it matches no code in the data today — check the spelling.`
        : `Rule saved. ${matched.length} code${matched.length === 1 ? "" : "s"} excluded: ${matched.join(", ")}.`;
    });

  const removeRule = async (rule: PrefixRule) => {
    setBusy(rule.id);
    setError("");
    try {
      const res = await fetch(`/api/rep-codes?prefixId=${encodeURIComponent(rule.id)}`, { method: "DELETE" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `Failed (${res.status})`);
      setMessage(`Codes starting with ${rule.prefix} count as reps again.`);
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  };

  const filtered = useMemo(() => {
    const rows = data?.rows ?? [];
    const q = search.trim().toUpperCase();
    return rows.filter((r) => {
      if (q && !r.code.includes(q) && !(r.repName || "").toUpperCase().includes(q)) return false;
      if (filter === "excluded") return !r.verdict.routable;
      if (filter === "reps") return r.verdict.routable;
      if (filter === "undecided") return r.verdict.reason === "default" && !r.repName;
      if (filter === "no_rep_record") return !r.repName;
      return true;
    });
  }, [data, search, filter]);

  const sorted = useSortedRows<CodeRow>(
    filtered,
    {
      code: (r) => r.code,
      repName: (r) => r.repName || null,
      imsOutlets: (r) => r.imsOutlets,
      imsUnrouted: (r) => r.imsUnrouted,
      sixMonthSales: (r) => r.sixMonthSales,
      routerStores: (r) => r.routerStores,
      status: (r) => (r.verdict.routable ? 1 : 0),
    },
    sort
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-clippa-red border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Rep Codes</h1>
        <p className="text-sm text-gray-500 mt-1">
          Which codes in the sales data belong to a rep. IMS bills under codes that are not people in
          the field &mdash; a third-party agent, other businesses, house accounts &mdash; and until
          they are named here their outlets are counted as coverage this team is missing.
        </p>
      </div>

      {/* The assumption to head off before anybody reads the table. */}
      <div className="mb-6 p-3 rounded-lg text-sm bg-blue-50 text-blue-900 border border-blue-100">
        <strong>Marking a code &ldquo;not a rep&rdquo; does not change any route.</strong> It stops the
        code being counted as missed coverage, stops a rep record ever being created from it, and makes
        a store upload refuse to allocate to it. Stores already linked to one of these codes stay
        exactly where they are &mdash; a link like that is more likely to be a mistake in the data than
        a shop nobody should visit, and silently dropping it would stop a rep visiting a real customer.
      </div>

      {!data?.hasSnapshot && (
        <div className="mb-6 p-3 rounded-lg text-sm bg-amber-50 text-amber-800">
          No IMS snapshot is loaded, so this list only holds codes the router itself knows. Refresh the
          snapshot on <a href="/admin/ims" className="underline">Admin &rarr; IMS</a> to see the agent
          and house-account codes.
        </div>
      )}

      {error && <div className="mb-6 p-3 rounded-lg text-sm bg-red-50 text-red-700">{error}</div>}
      {message && <div className="mb-6 p-3 rounded-lg text-sm bg-green-50 text-green-700">{message}</div>}

      {/* The two numbers this page exists to separate. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card
          label="Coverage to chase"
          value={randM(data?.chaseable.sixMonthSales ?? 0)}
          note={`${num(data?.chaseable.outlets ?? 0)} outlets Clippa bills that no rep is routed to`}
          tone="chase"
        />
        <Card
          label="Excluded, not a rep"
          value={randM(data?.excluded.sixMonthSales ?? 0)}
          note={`${num(data?.excluded.outlets ?? 0)} outlets on ${data?.excludedCodes ?? 0} codes that are not reps`}
          tone="muted"
        />
        <Card label="Codes seen" value={num(data?.totalCodes ?? 0)} note="Across reps, the router and IMS" />
        <Card
          label="No rep record"
          value={num((data?.rows ?? []).filter((r) => !r.repName).length)}
          note="Codes in the data with nobody attached"
        />
      </div>

      {/* Prefix rules */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 mb-6">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h2 className="font-semibold text-gray-900 text-sm">&ldquo;Starts with&rdquo; rules</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Catches codes that do not exist yet. IMS already has six CMR regions and adds more; a
              list of individually ticked codes would let the next one back in unnoticed.
            </p>
          </div>
          {canEdit && !showAddRule && (
            <button
              onClick={() => setShowAddRule(true)}
              className="px-3 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 whitespace-nowrap"
            >
              + Add rule
            </button>
          )}
        </div>

        {showAddRule && (
          <div className="flex flex-wrap items-end gap-3 mb-4 p-3 bg-gray-50 rounded-lg">
            <label className="text-xs text-gray-600">
              <span className="block mb-1 font-medium">Codes starting with</span>
              <input
                value={newPrefix}
                onChange={(e) => setNewPrefix(e.target.value.toUpperCase())}
                placeholder="CMR"
                className="border border-gray-300 rounded px-2 py-1.5 text-sm font-mono w-32"
              />
            </label>
            <label className="text-xs text-gray-600 flex-1 min-w-[200px]">
              <span className="block mb-1 font-medium">What are they?</span>
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Third-party agent"
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full"
              />
            </label>
            <button
              onClick={addRule}
              disabled={busy === "rule" || !newPrefix.trim()}
              className="bg-clippa-red text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
            >
              {busy === "rule" ? "Saving..." : "Save rule"}
            </button>
            <button
              onClick={() => { setShowAddRule(false); setNewPrefix(""); setNewLabel(""); }}
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        )}

        {(data?.rules.prefixes ?? []).length === 0 ? (
          <p className="text-sm text-gray-400">No rules yet.</p>
        ) : (
          <div className="space-y-2">
            {data!.rules.prefixes.map((rule) => {
              const caught = (data?.rows ?? []).filter((r) => r.verdict.prefix === rule.prefix);
              const value = caught.reduce((t, r) => t + r.sixMonthSales, 0);
              return (
                <div key={rule.id} className="flex items-center justify-between gap-4 p-2 border border-gray-100 rounded-lg">
                  <div className="min-w-0">
                    <span className="font-mono text-sm font-semibold text-gray-900">{rule.prefix}*</span>
                    <span className="ml-2 text-sm text-gray-600">{rule.label}</span>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {caught.length === 0 ? (
                        <span className="text-amber-700">matches nothing in the data today</span>
                      ) : (
                        <>
                          {caught.length} code{caught.length === 1 ? "" : "s"} &middot; {rand(value)} over six months
                          &middot; {caught.map((c) => c.code).join(", ")}
                        </>
                      )}
                    </div>
                  </div>
                  {canEdit && (
                    <button
                      onClick={() => removeRule(rule)}
                      disabled={busy === rule.id}
                      className="text-xs text-gray-500 hover:text-red-600 underline whitespace-nowrap disabled:opacity-50"
                    >
                      {busy === rule.id ? "Removing..." : "Remove"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search a code or rep name..."
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-64"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">Every code</option>
          <option value="excluded">Not a rep</option>
          <option value="reps">Counts as a rep</option>
          <option value="no_rep_record">No rep record</option>
          <option value="undecided">Undecided, no rep record</option>
        </select>
        <span className="text-xs text-gray-500">
          {num(sorted.length)} of {num(data?.totalCodes ?? 0)}
          {data?.snapshotFetchedAt
            ? ` · IMS snapshot ${new Date(data.snapshotFetchedAt).toLocaleDateString("en-ZA")}`
            : ""}
        </span>
      </div>

      {/* Table. Head pinned, same reason as Rep Sales & Activity. */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto overflow-y-auto max-h-[65vh]">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] text-gray-500 uppercase tracking-wider [&>th]:sticky [&>th]:top-0 [&>th]:z-20 [&>th]:bg-gray-50 [&>th]:shadow-[inset_0_-1px_0_#e5e7eb]">
                <SortableTh sortId="code" sort={sort} className="px-3 py-2">Code</SortableTh>
                <SortableTh sortId="repName" sort={sort} className="px-3 py-2">Rep record</SortableTh>
                <SortableTh sortId="routerStores" sort={sort} align="right" className="px-3 py-2">Stores in RR</SortableTh>
                <SortableTh sortId="imsOutlets" sort={sort} align="right" className="px-3 py-2">IMS outlets</SortableTh>
                <SortableTh sortId="imsUnrouted" sort={sort} align="right" className="px-3 py-2">Unrouted</SortableTh>
                <SortableTh sortId="sixMonthSales" sort={sort} align="right" className="px-3 py-2">6-month IMS</SortableTh>
                <SortableTh sortId="status" sort={sort} className="px-3 py-2">Status</SortableTh>
                <th className="px-3 py-2 text-right">{canEdit ? "Decide" : ""}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sorted.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">No codes match.</td></tr>
              ) : (
                sorted.map((r) => (
                  <tr key={r.code} className={r.verdict.routable ? "hover:bg-gray-50" : "bg-gray-50/60 hover:bg-gray-100/60"}>
                    <td className="px-3 py-2 font-mono font-medium text-gray-900">{r.code}</td>
                    <td className="px-3 py-2 text-gray-600">
                      {r.repName || <span className="text-gray-300">&mdash;</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600">
                      {r.routerStores === 0 ? <span className="text-gray-300">0</span> : num(r.routerStores)}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600">{num(r.imsOutlets)}</td>
                    <td className="px-3 py-2 text-right text-gray-600">
                      {r.imsUnrouted === 0 ? <span className="text-gray-300">0</span> : num(r.imsUnrouted)}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap text-gray-700">{rand(r.sixMonthSales)}</td>
                    <td className="px-3 py-2">
                      <Status v={r.verdict} />
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {canEdit && <Actions row={r} busy={busy === r.code} onDecide={decide} />}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Card({ label, value, note, tone = "plain" }: { label: string; value: string; note: string; tone?: "plain" | "chase" | "muted" }) {
  const ring =
    tone === "chase" ? "border-amber-200 bg-amber-50" : tone === "muted" ? "border-gray-200 bg-gray-50" : "border-gray-100 bg-white";
  const text = tone === "chase" ? "text-amber-900" : "text-gray-900";
  return (
    <div className={`rounded-xl border p-4 ${ring}`}>
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${text}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{note}</div>
    </div>
  );
}

/**
 * Why this code is or is not a rep, never just that it is.
 *
 * "Not a rep" alone is unactionable: a person looking at it cannot tell whether
 * somebody ticked it or a rule swept it up, and those need different fixes.
 */
function Status({ v }: { v: Verdict }) {
  if (v.routable) {
    return v.reason === "explicit" ? (
      <span className="text-green-700" title={v.note || "Somebody confirmed this is a rep"}>
        Rep (confirmed)
      </span>
    ) : (
      <span className="text-gray-500">Rep</span>
    );
  }
  if (v.reason === "prefix") {
    return (
      <span className="text-gray-700">
        Not a rep
        <span className="ml-1 text-[10px] text-gray-500">
          (rule {v.prefix}*{v.prefixLabel ? ` · ${v.prefixLabel}` : ""})
        </span>
      </span>
    );
  }
  return (
    <span className="text-gray-700" title={v.note || undefined}>
      Not a rep
      <span className="ml-1 text-[10px] text-gray-500">(set by hand)</span>
    </span>
  );
}

function Actions({
  row,
  busy,
  onDecide,
}: {
  row: CodeRow;
  busy: boolean;
  onDecide: (code: string, routable: boolean | null) => void;
}) {
  if (busy) return <span className="text-gray-400">Saving...</span>;

  // A code swept up by a rule gets a "No, it IS a rep" escape hatch rather than
  // a plain untick — unticking would do nothing, because the rule would catch
  // it again on the next render and the button would look broken.
  if (row.verdict.reason === "prefix") {
    return (
      <button
        onClick={() => onDecide(row.code, true)}
        className="text-xs text-blue-600 hover:text-blue-800 underline"
        title={`Keep ${row.code} as a rep even though the ${row.verdict.prefix}* rule excludes it`}
      >
        It is a rep
      </button>
    );
  }

  if (row.verdict.reason === "explicit") {
    return (
      <button
        onClick={() => onDecide(row.code, null)}
        className="text-xs text-gray-500 hover:text-gray-800 underline"
        title="Clear this decision and follow the rules again"
      >
        Undo
      </button>
    );
  }

  return (
    <button
      onClick={() => onDecide(row.code, false)}
      className="text-xs text-gray-600 hover:text-red-700 underline"
      title={`${row.code} is not a rep — stop counting its outlets as missed coverage`}
    >
      Not a rep
    </button>
  );
}
