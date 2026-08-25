import { NextRequest, NextResponse } from "next/server";
import { getReps, getStores, getChannels } from "@/lib/data";
import { requirePermission } from "@/lib/auth";
import { buildCoverageReport } from "@/lib/coverage";
import XLSX from "xlsx";

/**
 * The coverage gap as a file somebody can send to the client.
 *
 * Three sheets, because two different people need two different things: a
 * manager wants the one-page list of missing rep codes, and whoever fixes the
 * data needs every affected store with the columns that identify it.
 */
export async function GET(request: NextRequest) {
  try {
    await requirePermission("export_data");

    const [reps, stores, channels] = await Promise.all([getReps(), getStores(), getChannels()]);
    const report = buildCoverageReport(reps, stores);

    const knownCodes = new Set(reps.map((r) => (r.code || "").trim().toUpperCase()).filter(Boolean));
    const channelName = new Map(channels.map((c) => [c.id, c.name]));

    const wb = XLSX.utils.book_new();

    // ── Sheet 1: the summary, in words ────────────────────────────────────
    const s = report.summary;
    const summaryRows: (string | number)[][] = [
      ["CLIPPA REP ROUTER - STORE COVERAGE"],
      ["Generated", new Date().toISOString().slice(0, 16).replace("T", " ")],
      [],
      ["Stores in the system", s.totalStores],
      ["Reps in the system", s.totalReps],
      [],
      ["Rep codes used by stores", s.distinctCodesOnStores],
      ["  ...that have a rep record", s.matchedCodes],
      ["  ...with NO rep record", s.unmatchedCodes],
      [],
      ["Stores that can be routed", s.storesOnMatchedReps],
      ["Stores allocated to a rep code the app does not know", s.storesOnUnmatchedCodes],
      ["Stores with no rep code at all", s.storesWithNoRepCode],
      ["Coverage %", s.coveragePercent],
      [],
      ["WHAT THIS MEANS"],
      [
        "A store is linked to its rep by the REP CODE on the store record. Nothing checks that code",
      ],
      [
        "against the rep list, so a store naming a rep who was never loaded is silently dropped: it is",
      ],
      [
        "not on the map, not in any route, and not counted in capacity. Add the rep (Reps > Import Excel)",
      ],
      ["and the stores attach themselves - then REGENERATE ROUTES."],
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
    wsSummary["!cols"] = [{ wch: 54 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

    // ── Sheet 2: the missing rep codes ────────────────────────────────────
    const missingRows: (string | number)[][] = [
      ["REP CODE", "STORES", "STORES WITH BAD GPS", "PROVINCES", "REGIONS"],
    ];
    for (const u of report.unmatched) {
      missingRows.push([
        u.repCode,
        u.storeCount,
        u.storesWithBadGps,
        u.provinces.join(", "),
        u.regions.join(", "),
      ]);
    }
    if (report.unmatched.length === 0) missingRows.push(["Every rep code on a store has a rep record."]);
    const wsMissing = XLSX.utils.aoa_to_sheet(missingRows);
    wsMissing["!cols"] = [{ wch: 12 }, { wch: 9 }, { wch: 20 }, { wch: 40 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsMissing, "Missing Reps");

    // ── Sheet 3: every store behind them ──────────────────────────────────
    const storeRows: (string | number)[][] = [
      [
        "REP CODE",
        "PLACE ID",
        "PLACE NAME",
        "CHANNEL",
        "PROVINCE",
        "REGION",
        "GPS LATITUDE",
        "GPS LONGITUDE",
        "FREQUENCY",
        "DURATION (MIN)",
      ],
    ];
    const orphanStores = stores
      .filter((st) => {
        const code = (st.repCode || "").trim().toUpperCase();
        return !!code && !knownCodes.has(code);
      })
      .sort(
        (a, b) =>
          (a.repCode || "").localeCompare(b.repCode || "") || (a.name || "").localeCompare(b.name || "")
      );

    for (const st of orphanStores) {
      storeRows.push([
        st.repCode || "",
        st.placeId || st.id || "",
        st.name || "",
        channelName.get(st.channelId) || st.channelId || "",
        st.province || "",
        st.region || "",
        st.gpsLat || "",
        st.gpsLng || "",
        st.frequency || "",
        st.duration ?? "",
      ]);
    }
    const wsStores = XLSX.utils.aoa_to_sheet(storeRows);
    wsStores["!cols"] = [
      { wch: 11 },
      { wch: 16 },
      { wch: 44 },
      { wch: 20 },
      { wch: 16 },
      { wch: 16 },
      { wch: 14 },
      { wch: 14 },
      { wch: 13 },
      { wch: 14 },
    ];
    XLSX.utils.book_append_sheet(wb, wsStores, "Unrouted Stores");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const date = new Date().toISOString().slice(0, 10);

    // ASCII only. HTTP headers are latin-1, and a single em dash in a filename
    // makes Content-Disposition throw before the file ever leaves the server.
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Clippa_Store_Coverage_${date}.xlsx"`,
      },
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Forbidden")) {
      return NextResponse.json({ error: "You do not have permission to export data." }, { status: 403 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
