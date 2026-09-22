"use client";

/**
 * Every store the call cycle misses, as a working list.
 *
 * The map answers "where are the gaps"; this answers "which ones, and what are
 * they worth". They share `lib/notInCycle`, so the seven reasons, the two
 * families and the counts are the same on both screens — a store cannot be
 * "over the calls-per-day target" here and "closed" over there.
 *
 * The default view is deliberately the actionable one: OPEN stores only, so
 * the page opens on the shops somebody can do something about rather than on
 * 267 closed ones. The filter says so, and switching it is one click.
 */

import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { useTableSort, useSortedRows, SortableTh } from "@/components/TableSort";
import { TeamFilter } from "@/components/TeamFilter";
import {
  EMPTY_SELECTION,
  filterRepsByTeam,
  matchesTeam,
  type TeamSelection,
} from "@/lib/teamFilter";
import {
  findNotInCycle,
  isCorrectlyOut,
  REASONS,
  type NotInCycleReason,
} from "@/lib/notInCycle";
import { buildStoreRanks, formatRank } from "@/lib/storeRanks";
import { knownSixMonthSales } from "@/lib/storeValue";
import { isClosed } from "@/lib/closedStores";
import type {
  Channel,
  Rep,
  RoutePlanDocument,
  Store,
  StoreOverride,
  SubChannel,
  Team,
} from "@/lib/types";

type StatusFilter = "open" | "closed" | "all";

export default function NotInCyclePage() {
  const { session } = useSession();
  const isAdmin = session?.role === "superAdmin" || session?.role === "admin";
  const isRep = session?.role === "rep";
  const isTeamManager = session?.role === "teamManager";

  const [stores, setStores] = useState<Store[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [overrides, setOverrides] = useState<StoreOverride[]>([]);
  const [subChannels, setSubChannels] = useState<SubChannel[]>([]);
  const [routes, setRoutes] = useState<RoutePlanDocument | null>(null);
  const [loading, setLoading] = useState(true);

  const [teamSel, setTeamSel] = useState<TeamSelection>(EMPTY_SELECTION);
  const [repCode, setRepCode] = useState("");
  const [channelId, setChannelId] = useState("");
  const [reason, setReason] = useState<NotInCycleReason | "">("");
  // 🔴 Open by default. A list that opens on closed shops buries the ones
  // somebody can act on, and "not in the cycle" is a to-do list, not an archive.
  const [status, setStatus] = useState<StatusFilter>("open");
  const [search, setSearch] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/stores").then((r) => r.json()).catch(() => []),
      fetch("/api/reps").then((r) => r.json()).catch(() => []),
      fetch("/api/teams").then((r) => r.json()).catch(() => []),
      fetch("/api/channels").then((r) => r.json()).catch(() => []),
      fetch("/api/routes").then((r) => r.json()).catch(() => null),
      fetch("/api/store-overrides").then((r) => r.json()).catch(() => ({ overrides: [] })),
      fetch("/api/sub-channels").then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]).then(([st, rp, tm, ch, rt, ov, sub]) => {
      setStores(Array.isArray(st) ? st : []);
      setReps(Array.isArray(rp) ? rp : []);
      setTeams(Array.isArray(tm) ? tm : []);
      setChannels(Array.isArray(ch) ? ch : []);
      setRoutes(rt && typeof rt === "object" && "repPlans" in rt ? rt : null);
      setOverrides(Array.isArray(ov?.overrides) ? ov.overrides : Array.isArray(ov) ? ov : []);
      setSubChannels(Array.isArray(sub) ? sub : []);
      setLoading(false);
    });
  }, []);

  // Role scoping first, always. The filters narrow what this user may see, they
  // never reach past it.
  const roleScopedReps = useMemo(() => {
    if (isRep && session?.repCode) return reps.filter((r) => r.code === session.repCode);
    if (isTeamManager && session?.teamId) return reps.filter((r) => r.teamId === session.teamId);
    return reps;
  }, [reps, isRep, isTeamManager, session?.repCode, session?.teamId]);

  const repsInTeam = useMemo(
    () => filterRepsByTeam(teams, teamSel, roleScopedReps),
    [teams, teamSel, roleScopedReps]
  );

  /**
   * Ranks over everything this user may see — not over the filtered rows.
   * "1537th of 4445" has to mean the same thing whatever the filters say.
   */
  const ranks = useMemo(() => {
    const codes = new Set(roleScopedReps.map((r) => r.code));
    return buildStoreRanks(isAdmin ? stores : stores.filter((s) => codes.has(s.repCode)));
  }, [stores, isAdmin, roleScopedReps]);

  const repByCode = useMemo(() => new Map(reps.map((r) => [r.code, r])), [reps]);
  const channelById = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  /** The same seven reasons the map uses, over the same rule. */
  const result = useMemo(
    () =>
      findNotInCycle({
        stores,
        channels,
        overrides,
        subChannels,
        routes,
        // 🔴 Deliberately NOT narrowed by the rep filter. Passing it here made
        // the rep filter change the DENOMINATOR ("77 of 82") while the team and
        // channel filters changed only the numerator ("451 of 3943") — two
        // filters on one toolbar that meant different things. Every filter now
        // narrows the rows; the total is always the whole picture.
        visibleRepCodes: isAdmin ? undefined : new Set(roleScopedReps.map((r) => r.code)),
      }),
    [stores, channels, overrides, subChannels, routes, isAdmin, roleScopedReps]
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const inTeam = new Set(repsInTeam.map((r) => r.code));
    return result.missing
      .filter(({ store }) => {
        if (repCode && store.repCode !== repCode) return false;
        if (teamSel.leaderId || teamSel.teamId) {
          const rep = repByCode.get(store.repCode);
          // A store whose rep code matches no rep record has no team; it only
          // survives a team filter under "No team", which matchesTeam decides.
          if (!matchesTeam(teams, teamSel, rep?.teamId) && !inTeam.has(store.repCode)) return false;
        }
        if (channelId && store.channelId !== channelId) return false;
        if (status === "open" && isClosed(store)) return false;
        if (status === "closed" && !isClosed(store)) return false;
        if (reason && result.reasonOf.get(store.id) !== reason) return false;
        if (q && !`${store.name} ${store.placeId} ${store.repCode}`.toLowerCase().includes(q))
          return false;
        return true;
      })
      .map(({ store, reason: why }) => {
        const rep = repByCode.get(store.repCode);
        return {
          store,
          why,
          sales: knownSixMonthSales(store),
          overall: ranks.get(store.id)?.overall ?? null,
          repRank: ranks.get(store.id)?.rep ?? null,
          repName: rep?.name || store.repCode,
          teamName: rep?.teamId ? teamById.get(rep.teamId)?.name || "—" : "No team",
          leaderName: rep?.teamId ? teamById.get(rep.teamId)?.managerName || "—" : "—",
          channelName: channelById.get(store.channelId)?.name || store.channelId,
          closed: isClosed(store),
        };
      });
  }, [result, repsInTeam, teamSel, teams, repByCode, repCode, channelId, status, reason, search, ranks, teamById, channelById]);

  const sort = useTableSort("sales", "desc", ["sales", "overall", "repRank"]);
  const sorted = useSortedRows(
    rows,
    {
      name: (r) => r.store.name,
      rep: (r) => r.repName,
      team: (r) => r.teamName,
      channel: (r) => r.channelName,
      // 🔴 Absent sorts LAST whichever way the column is pointed, rather than
      // as 0. A store nobody has measured is not the worst-selling store.
      sales: (r) => (r.sales === null ? -Infinity : r.sales),
      overall: (r) => r.overall?.position ?? Infinity,
      repRank: (r) => r.repRank?.position ?? Infinity,
      why: (r) => REASONS[r.why].rank,
      status: (r) => (r.closed ? "Closed" : "Open"),
    },
    sort
  );

  const totalValue = rows.reduce((s, r) => s + (r.sales ?? 0), 0);
  const unmeasured = rows.filter((r) => r.sales === null).length;
  const fmt = (n: number) => "R " + Math.round(n).toLocaleString("en-ZA");

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-clippa-red border-t-transparent rounded-full" />
      </div>
    );
  }

  const SELECT =
    "border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red";

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">Stores not in a cycle</h1>
        <p className="text-sm text-gray-500">
          {routes
            ? <>
                {result.scheduled} of {result.totalStores} stores are visited.{" "}
                <span className="font-semibold text-amber-700">{rows.length}</span> shown here,
                worth <span className="font-semibold">{fmt(totalValue)}</span> over six months
                {unmeasured > 0 && (
                  <span className="text-gray-400"> · {unmeasured} with no sales figure</span>
                )}
              </>
            : "No routes have been generated yet, so nothing is in a cycle."}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {isAdmin && (
          <TeamFilter teams={teams} value={teamSel} onChange={setTeamSel} reps={roleScopedReps} />
        )}

        {!isRep && (
          <select value={repCode} onChange={(e) => setRepCode(e.target.value)} className={SELECT} aria-label="Rep">
            <option value="">All reps</option>
            {repsInTeam.map((r) => (
              <option key={r.code} value={r.code}>{r.name} ({r.code})</option>
            ))}
          </select>
        )}

        <select value={channelId} onChange={(e) => setChannelId(e.target.value)} className={SELECT} aria-label="Channel">
          <option value="">All channels</option>
          {/* ⚠️ Deduplicated by ID, not cosmetically. TWO channels share the id
              `ok_foods` — "OK FOODS" and "ok foods" — so both options would
              filter on exactly the same value and be impossible to tell apart
              once picked. React also refuses the duplicate key. The underlying
              data clash is a separate decision (merging changes 3 stores' call
              frequency) and is deliberately not touched here. */}
          {[...new Map(channels.map((c) => [c.id, c])).values()]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
        </select>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className={SELECT}
          aria-label="Status"
        >
          <option value="open">Open only</option>
          <option value="closed">Closed only</option>
          <option value="all">Open and closed</option>
        </select>

        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as NotInCycleReason | "")}
          className={SELECT}
          aria-label="Reason"
        >
          <option value="">Any reason</option>
          {(Object.keys(REASONS) as NotInCycleReason[])
            .sort((a, b) => REASONS[a].rank - REASONS[b].rank)
            .map((r) => (
              <option key={r} value={r}>
                {REASONS[r].label}
                {result.counts[r] ? ` (${result.counts[r]})` : ""}
              </option>
            ))}
        </select>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, ID or rep code..."
          className={`${SELECT} w-64`}
        />

        <span className="text-sm text-gray-500 ml-auto">
          {rows.length} of {result.missing.length} not in a cycle
        </span>
      </div>

      {/* Grid */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="max-h-[calc(100vh-280px)] overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 [&>tr>th]:sticky [&>tr>th]:top-0 [&>tr>th]:bg-gray-50 [&>tr>th]:z-10">
              <tr>
                <SortableTh sortId="name" sort={sort} className="px-4 py-3">Store</SortableTh>
                <SortableTh sortId="rep" sort={sort} className="px-4 py-3">Rep</SortableTh>
                <SortableTh sortId="team" sort={sort} className="px-4 py-3">Team</SortableTh>
                <SortableTh sortId="channel" sort={sort} className="px-4 py-3">Channel</SortableTh>
                <SortableTh sortId="sales" sort={sort} className="px-4 py-3 text-right">6-month sales</SortableTh>
                <SortableTh sortId="overall" sort={sort} className="px-4 py-3 text-right">Overall rank</SortableTh>
                <SortableTh sortId="repRank" sort={sort} className="px-4 py-3 text-right">Rep rank</SortableTh>
                <SortableTh sortId="status" sort={sort} className="px-4 py-3">Status</SortableTh>
                <SortableTh sortId="why" sort={sort} className="px-4 py-3">Why not in a cycle</SortableTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map((r) => (
                <tr key={r.store.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-gray-900">{r.store.name}</div>
                    <div className="text-xs text-gray-400 font-mono">{r.store.placeId}</div>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {r.repName}
                    <div className="text-xs text-gray-400 font-mono">{r.store.repCode}</div>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {r.teamName}
                    {r.leaderName !== "—" && (
                      <div className="text-xs text-gray-400">{r.leaderName}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{r.channelName}</td>
                  {/* Absent is a dash, never R 0,00 — 38.5% of the base has no
                      figure, and zero would assert that they bought nothing. */}
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {r.sales === null ? <span className="text-gray-300">—</span> : fmt(r.sales)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">
                    {formatRank(r.overall) ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">
                    {formatRank(r.repRank) ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded ${
                        r.closed ? "bg-gray-100 text-gray-500" : "bg-green-50 text-green-700"
                      }`}
                    >
                      {r.closed ? "Closed" : "Open"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-start gap-2">
                      <span
                        className="mt-1.5 w-2 h-2 rounded-full shrink-0"
                        style={{ background: REASONS[r.why].colour }}
                      />
                      <div>
                        <div className={isCorrectlyOut(r.why) ? "text-gray-500" : "text-gray-800"}>
                          {REASONS[r.why].label}
                        </div>
                        {REASONS[r.why].action && (
                          <div className="text-xs text-gray-400">{REASONS[r.why].action}</div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-gray-400">
                    {result.missing.length === 0
                      ? "Every store that can be visited is in the cycle."
                      : "No store matches these filters."}
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
