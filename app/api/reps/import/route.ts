import { NextRequest, NextResponse } from "next/server";
import { getReps, saveReps, getRepCodeRules } from "@/lib/data";
import { requirePermission } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { applyRepImport, parseRepSheet } from "@/lib/repImport";
import XLSX from "xlsx";

/**
 * The door reps come in through.
 *
 * `?mode=preview` reads the file and reports what WOULD change without saving —
 * always run first from the UI, because the same upload both edits existing reps
 * and creates new ones, and nobody should discover which after the fact.
 */
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const session = await requirePermission("manage_reps");
    const preview = request.nextUrl.searchParams.get("mode") === "preview";

    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) {
      return NextResponse.json({ error: "That workbook has no sheets in it." }, { status: 400 });
    }

    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
      header: 1,
      blankrows: false,
      defval: "",
    });

    const parsed = parseRepSheet(rawRows);
    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    if (parsed.rows.length === 0) {
      return NextResponse.json(
        { error: "The header row was found but there are no rows under it." },
        { status: 400 }
      );
    }

    const [existing, repCodeRules] = await Promise.all([getReps(), getRepCodeRules()]);
    const result = applyRepImport(existing, parsed.rows, repCodeRules);

    if (!preview && (result.created.length > 0 || result.updated.length > 0)) {
      await saveReps(result.reps);
      logActivity({
        action: "Imported reps",
        actor: session?.email || "unknown",
        actorName: session?.name || "Unknown",
        summary: `Imported reps from ${file.name || "a spreadsheet"}: ${result.created.length} created, ${result.updated.length} updated`,
      });
    }

    // The rep list itself is not echoed back — the page only needs the report,
    // and 63 full records is a payload nobody reads.
    return NextResponse.json({
      preview,
      sheet: sheetName,
      rowsRead: parsed.rows.length,
      columnsPresent: result.columnsPresent,
      created: result.created,
      updated: result.updated,
      unchanged: result.unchanged,
      rejected: result.rejected,
      warnings: result.warnings,
      nameDifferences: result.nameDifferences,
      saved: !preview && (result.created.length > 0 || result.updated.length > 0),
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Forbidden")) {
      return NextResponse.json({ error: "You do not have permission to import reps." }, { status: 403 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
