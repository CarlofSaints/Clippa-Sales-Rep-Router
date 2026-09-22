"use client";

/**
 * The team leader and team selects, as one control used by every page that
 * narrows to a team.
 *
 * It lives here because Routes, Map and Rep Capacity all ask the same question
 * and had started answering it differently — Routes with a single dropdown
 * keyed on team id but LABELLED by manager, the other two not at all. Three
 * copies of a filter is three chances for one of them to disagree about what
 * "Pretoria" means.
 */

import type { Team } from "@/lib/types";
import {
  NO_TEAM,
  teamCounts,
  teamLeaderOptions,
  teamsForLeader,
  withLeader,
  withTeam,
  type TeamSelection,
} from "@/lib/teamFilter";

interface Props {
  teams: Team[];
  value: TeamSelection;
  onChange: (next: TeamSelection) => void;
  /** Reps in scope, only for the counts beside each option. */
  reps: { teamId?: string }[];
  className?: string;
}

const SELECT =
  "border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red";

export function TeamFilter({ teams, value, onChange, reps, className = "" }: Props) {
  const leaders = teamLeaderOptions(teams);
  const available = teamsForLeader(teams, value.leaderId);
  const counts = teamCounts(teams, reps);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <select
        value={value.leaderId}
        onChange={(e) => onChange(withLeader(teams, value, e.target.value))}
        className={SELECT}
        aria-label="Team leader"
      >
        <option value="">All team leaders</option>
        {leaders.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
            {/* Named when a leader runs more than one team, because then the
                leader select and the team select stop being the same question
                and the difference has to be visible. */}
            {l.teamIds.length > 1 ? ` (${l.teamIds.length} teams)` : ""}
          </option>
        ))}
      </select>

      <select
        value={value.teamId}
        onChange={(e) => onChange(withTeam(teams, value, e.target.value))}
        className={SELECT}
        aria-label="Team"
      >
        <option value="">
          {value.leaderId ? "All their teams" : "All teams"}
        </option>
        {available.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name || "Unnamed team"} ({counts.byTeam.get(t.id) ?? 0})
          </option>
        ))}
        {/* 🔴 Always offered, and never hidden by the leader select: a rep in no
            team has no leader either, so filtering it away would make three
            quarters of the reps unreachable from this control. */}
        <option value={NO_TEAM}>No team ({counts.noTeam})</option>
      </select>
    </div>
  );
}
