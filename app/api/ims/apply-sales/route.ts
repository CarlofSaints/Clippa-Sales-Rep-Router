import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { getStores, saveStores } from "@/lib/data";
import { isSqlProxyConfigured, sqlQuery } from "@/lib/sqlProxy";
import { applySalesToStores } from "@/lib/imsReconCore";

/**
 * Write the IMS six-month sales figure onto the stores.
 *
 * Two modes, and preview is the default: `?mode=apply` is the only thing that
 * writes. Everything a preview reports is computed by the SAME function that
 * does the write, so the preview cannot drift from the outcome.
 *
 * ⚠️ Stores with no IMS figure are LEFT ALONE, never set to zero. Absent means
 * "never supplied" and is deliberately distinct from a real zero.
 */

export const maxDuration = 60;
export const dynamic = "force-dynamic";

interface ImsSale {
  "Place ID": string;
  SalesValue: number;
}

const norm = (v: unknown) => String(v ?? "").trim().toUpperCase();

export async function POST(request: NextRequest) {
  try {
    await requirePermission("upload_stores");

    if (!isSqlProxyConfigured()) {
      return NextResponse.json(
        { error: "SQL_PROXY_URL and SQL_PROXY_API_KEY are not set on this deployment." },
        { status: 503 }
      );
    }

    const mode = request.nextUrl.searchParams.get("mode") === "apply" ? "apply" : "preview";

    // The window is fixed at six months on purpose. `monthlySales` is defined as
    // sixMonthSales / 6, so writing a twelve-month total through here would put
    // a number in the field that does not mean what every reader thinks it does.
    const salesRes = await sqlQuery<ImsSale>("clippa_ims_place_sales", { monthsBack: 6 });
    const sales = new Map<string, number>();
    for (const r of salesRes.data ?? []) sales.set(norm(r["Place ID"]), Number(r.SalesValue) || 0);

    const before = await getStores();
    const { stores: after, updated, unchanged, untouched } = applySalesToStores(before, sales);

    // What the write actually disturbs: stores that already carried a figure and
    // will now carry a different one. That is the number worth seeing first.
    let overwritingExisting = 0;
    let firstTimeValue = 0;
    const samples: Array<{ placeId: string; name: string; from: number | null; to: number }> = [];
    for (let i = 0; i < before.length; i++) {
      const b = before[i];
      const a = after[i];
      if (a === b) continue;
      if (b.sixMonthSales === undefined) firstTimeValue++;
      else overwritingExisting++;
      if (samples.length < 15) {
        samples.push({
          placeId: b.placeId || b.id,
          name: b.name,
          from: b.sixMonthSales ?? null,
          to: a.sixMonthSales as number,
        });
      }
    }

    if (mode === "apply") {
      await saveStores(after);
    }

    return NextResponse.json({
      mode,
      applied: mode === "apply",
      imsCodes: sales.size,
      appStores: before.length,
      updated,
      unchanged,
      untouched,
      overwritingExisting,
      firstTimeValue,
      samples,
    });
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Forbidden")) {
      return NextResponse.json({ error: "You do not have permission to write store sales." }, { status: 403 });
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
