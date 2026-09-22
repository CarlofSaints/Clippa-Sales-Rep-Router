import { NextRequest, NextResponse } from "next/server";
import { getReps, getStores, getRoutes, getTeams, getChannels, getStoreOverrides, getSubChannels } from "@/lib/data";
import { computeCapacity } from "@/lib/capacity";
import { requireSession } from "@/lib/auth";
import XLSX from "xlsx";

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    const requestedParam = new URL(request.url).searchParams.get("repCodes") || "";
    const requestedCodes = requestedParam
      ? new Set(requestedParam.split(",").map((c) => c.trim()).filter(Boolean))
      : null;

    const [reps, stores, doc, teams, channels, overrides, subChannels] = await Promise.all([
      getReps(),
      getStores(),
      getRoutes(),
      getTeams(),
      getChannels(),
      getStoreOverrides(),
      getSubChannels(),
    ]);

    const result = computeCapacity(reps, stores, doc, channels, overrides, subChannels);
    const teamName = new Map(teams.map((t) => [t.id, t.name || t.managerName || ""]));

    const rows: (string | number)[][] = [
      [
        "Rep Code",
        "Rep Name",
        "Team",
        "Stores",
        "Calls/Month",
        "Hours/Day",
        "Scheduled Hours/Month",
        "Visit Hours",
        "Travel Hours",
        "Available Hours/Month",
        "Utilisation %",
        "Spare Hours",
        "Over-Capacity Days",
        "Unassigned Stores",
        "Routed",
      ],
    ];

    /**
     * 🔴 Server-side scoping. This route asked only that you be SIGNED IN, so
     * any rep or viewer could download every rep's capacity, hours and store
     * counts. The page hid the link; hiding a link is not a permission.
     * See [[permissions-were-decorative]].
     */
    let visible = result.reps;
    if (session.role === "rep") {
      visible = session.repCode ? visible.filter((r) => r.repCode === session.repCode) : [];
    } else if (session.role === "teamManager") {
      visible = visible.filter((r) => r.teamId && r.teamId === session.teamId);
    } else if (session.role !== "admin" && session.role !== "superAdmin") {
      // Fail closed, so a role added later does not inherit the whole book.
      visible = [];
    }
    // Narrowing only, intersected with what the role already allows.
    if (requestedCodes) visible = visible.filter((r) => requestedCodes.has(r.repCode));

    const sorted = [...visible].sort((a, b) => b.utilization - a.utilization);
    for (const r of sorted) {
      rows.push([
        r.repCode,
        r.repName,
        teamName.get(r.teamId) || "Unassigned",
        r.storeCount,
        r.callsPerMonth,
        r.workingHoursPerDay,
        r.hasRoute ? r.scheduledHours : "",
        r.hasRoute ? r.visitHours : "",
        r.hasRoute ? r.travelHours : "",
        r.availableHours,
        r.hasRoute ? Math.round(r.utilization * 100) : "",
        r.hasRoute ? r.spareHours : "",
        r.overCapacityDays,
        r.unassignedStores,
        r.hasRoute ? "Yes" : "No",
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [
      { wch: 12 }, { wch: 24 }, { wch: 20 }, { wch: 8 }, { wch: 11 },
      { wch: 9 }, { wch: 20 }, { wch: 11 }, { wch: 12 }, { wch: 20 },
      { wch: 12 }, { wch: 11 }, { wch: 17 }, { wch: 16 }, { wch: 8 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rep Capacity");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const date = new Date().toISOString().slice(0, 10);

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Rep_Capacity_${date}.xlsx"`,
      },
    });
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Rep capacity export error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
