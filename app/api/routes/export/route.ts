import { NextRequest, NextResponse } from "next/server";
import { getRoutes, getReps, getTeams } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { WeekLabel, DayLabel } from "@/lib/types";
import XLSX from "xlsx";

const WEEKS: WeekLabel[] = ["Wk1", "Wk2", "Wk3", "Wk4"];
const DAYS: DayLabel[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();

    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get("teamId") || "";
    const includeTimes = searchParams.get("includeTimes") === "1";
    // The exact reps on screen, for a selection a single teamId cannot express
    // — a team leader who runs several teams, or the reps in no team at all.
    // A file that quietly holds more reps than the screen it was exported from
    // is worse than no export.
    const repCodesParam = searchParams.get("repCodes") || "";
    const requestedCodes = repCodesParam
      ? new Set(repCodesParam.split(",").map((c) => c.trim()).filter(Boolean))
      : null;

    const routes = await getRoutes();
    if (!routes || routes.repPlans.length === 0) {
      return NextResponse.json({ error: "No routes generated" }, { status: 404 });
    }

    const reps = await getReps();
    const teams = await getTeams();

    let repPlans = routes.repPlans;

    /**
     * 🔴 Server-side scoping. This route asked only that you be SIGNED IN, so
     * any rep or viewer could call it with no parameters and download every
     * rep's entire route book — the Routes page hid the control, and hiding a
     * control is not a permission. The filters below are a convenience on top
     * of this, never a substitute for it.
     * See [[permissions-were-decorative]], [[server-action-exports-are-public-endpoints]].
     */
    if (session.role === "rep") {
      const own = session.repCode;
      repPlans = own ? repPlans.filter((p) => p.repCode === own) : [];
    } else if (session.role === "teamManager") {
      const theirs = new Set(
        reps.filter((r) => r.teamId && r.teamId === session.teamId).map((r) => r.code)
      );
      repPlans = repPlans.filter((p) => theirs.has(p.repCode));
    } else if (session.role !== "admin" && session.role !== "superAdmin") {
      // A viewer, or any role added later that nobody thought about here.
      // Defaulting to "everything" is how a new role silently gets the book.
      // See [[a-visibility-check-must-fail-closed]].
      repPlans = [];
    }

    // Filter rep plans by team if specified
    if (teamId) {
      const teamRepCodes = new Set(
        reps.filter((r) => r.teamId === teamId).map((r) => r.code)
      );
      repPlans = repPlans.filter((p) => teamRepCodes.has(p.repCode));
    }

    // Narrowing only: intersected with what the role already allows, so a
    // crafted list can never reach past it.
    if (requestedCodes) {
      repPlans = repPlans.filter((p) => requestedCodes.has(p.repCode));
    }

    if (repPlans.length === 0) {
      return NextResponse.json(
        { error: "No routes you can see match that selection" },
        { status: 404 }
      );
    }

    const wb = XLSX.utils.book_new();
    const usedNames = new Set<string>();

    for (const plan of repPlans) {
      // Build sheet name (max 31 chars, deduplicated)
      let sheetName = plan.repName.slice(0, 31);
      if (usedNames.has(sheetName)) {
        const suffix = ` (${plan.repCode})`;
        sheetName = plan.repName.slice(0, 31 - suffix.length) + suffix;
      }
      usedNames.add(sheetName);

      // Build day plans lookup
      const dayLookup = new Map<string, typeof plan.days[0]>();
      for (const dp of plan.days) {
        dayLookup.set(`${dp.week}-${dp.day}`, dp);
      }

      const rows: (string | null)[][] = [];

      // Row 1: Rep Name (RepCode)
      rows.push([`${plan.repName} (${plan.repCode})`]);
      // Row 2: blank
      rows.push([]);

      for (const week of WEEKS) {
        // Week header row
        rows.push([week]);

        // Day header row
        rows.push([null, ...DAYS]);

        // Find max stops in any day of this week
        let maxStops = 0;
        for (const day of DAYS) {
          const dp = dayLookup.get(`${week}-${day}`);
          if (dp) maxStops = Math.max(maxStops, dp.stops.length);
        }

        // Stop rows
        for (let stopIdx = 0; stopIdx < maxStops; stopIdx++) {
          const row: (string | null)[] = [null]; // first column blank (aligned under week label)
          for (const day of DAYS) {
            const dp = dayLookup.get(`${week}-${day}`);
            const stop = dp?.stops[stopIdx];
            if (stop) {
              row.push(
                includeTimes
                  ? `${stop.storeName} (${stop.arrivalTime})`
                  : stop.storeName
              );
            } else {
              row.push(null);
            }
          }
          rows.push(row);
        }

        // If no stops at all for this week, add one empty row
        if (maxStops === 0) {
          rows.push([null, ...DAYS.map(() => null)]);
        }

        // Blank row between weeks
        rows.push([]);
      }

      const ws = XLSX.utils.aoa_to_sheet(rows);

      // Set column widths
      ws["!cols"] = [
        { wch: 6 },  // Week label column
        { wch: 30 }, // Monday
        { wch: 30 }, // Tuesday
        { wch: 30 }, // Wednesday
        { wch: 30 }, // Thursday
        { wch: 30 }, // Friday
      ];

      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    // Build filename
    const teamName = teamId
      ? teams.find((t) => t.id === teamId)?.name || "Team"
      : requestedCodes
        ? "Selection"
        : "All";
    const filename = `Routes_${teamName}_${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Export error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
