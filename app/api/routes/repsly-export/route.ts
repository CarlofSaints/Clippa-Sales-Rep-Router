import { NextRequest, NextResponse } from "next/server";
import { getRoutes, getRoutesForType, getStores } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { cycleStartMonday, parseIsoDate } from "@/lib/repslySchedule";
import { buildRepslyWorkbook } from "@/lib/repslyWorkbook";
import XLSX from "xlsx";

export async function GET(request: NextRequest) {
  try {
    await requireSession();

    const sp = request.nextUrl.searchParams;
    const typeId = sp.get("typeId");
    const repFilter = sp.get("repCode") || "";
    const format = sp.get("format") === "csv" ? "csv" : "xlsx";
    // Week 1 of the cycle starts on this Monday; any other day moves to the next Monday
    const start = cycleStartMonday(parseIsoDate(sp.get("start")) ?? new Date());

    const [doc, stores] = await Promise.all([
      typeId ? getRoutesForType(typeId) : getRoutes(),
      getStores(),
    ]);
    const { importSheet, workbook } = buildRepslyWorkbook(doc, stores, { start, repCode: repFilter });

    const date = new Date().toISOString().slice(0, 10);
    const scope = repFilter || "all-reps";
    const base = `Repsly_CallCycle_${scope}_from-${start.toISOString().slice(0, 10)}_${date}`;

    if (format === "csv") {
      return new NextResponse(XLSX.utils.sheet_to_csv(importSheet), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${base}.csv"`,
        },
      });
    }

    const buf = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${base}.xlsx"`,
      },
    });
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Repsly export error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
