import { SessionPayload, Team } from "./types";
import { getReps, getTeams, getUsers } from "./data";

/**
 * An email address reduced to the thing worth comparing.
 *
 * Real, on live data 3 Sep 2026: a team manager was saved as
 * `"ALEC@CLIPPASALES.COM "` — typed with a trailing space, stored verbatim.
 * Four separate places match a manager to their login with
 * `t.managerEmail.toLowerCase() === session.email.toLowerCase()`, and every one
 * of them would have missed, so that manager's `teamId` would silently never
 * resolve at sign-in. Nothing would say why.
 */
export function normaliseEmail(value: string | undefined | null): string {
  return (value || "").trim().toLowerCase();
}

/**
 * The team this person manages, if any.
 *
 * Exists so the four callers share ONE comparison. They had four copies of it,
 * which is exactly the shape where a fix lands in three of them.
 */
export function findTeamForManager(teams: Team[], email: string | undefined | null): Team | undefined {
  const wanted = normaliseEmail(email);
  if (!wanted) return undefined;
  return teams.find((t) => normaliseEmail(t.managerEmail) === wanted);
}

export interface ManagerInfo {
  name: string;
  email: string;
  cell: string;
  title: string;
}

export async function resolveManager(
  session: SessionPayload
): Promise<ManagerInfo | null> {
  if (session.role === "rep") {
    // Rep → their team manager
    const reps = await getReps();
    const rep = reps.find(
      (r) => r.email.toLowerCase() === session.email.toLowerCase()
    );
    if (!rep?.teamId) return null;
    const teams = await getTeams();
    const team = teams.find((t) => t.id === rep.teamId);
    if (!team) return null;
    return {
      name: team.managerName,
      email: team.managerEmail,
      cell: team.managerCell,
      title: "Team Manager",
    };
  }

  if (session.role === "teamManager") {
    // Team manager → the superAdmin user (National Manager)
    const users = await getUsers();
    const superAdmin = users.find((u) => u.role === "superAdmin");
    if (!superAdmin) return null;
    return {
      name: superAdmin.name,
      email: superAdmin.email,
      cell: superAdmin.cell || "",
      title: "National Manager",
    };
  }

  // Admin / SuperAdmin / Viewer → no manager
  return null;
}
