import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { isSqlProxyConfigured } from "@/lib/sqlProxy";
import { buildReconciliation } from "@/lib/imsRecon";

/**
 * Read-only reconciliation of the store list against the client's IMS database.
 *
 * Nothing here writes. Applying the sales figures is a separate, explicit POST,
 * so looking at the comparison can never change the data being compared.
 */

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requirePermission("view_sql_direct");

    if (!isSqlProxyConfigured()) {
      return NextResponse.json(
        { error: "SQL_PROXY_URL and SQL_PROXY_API_KEY are not set on this deployment." },
        { status: 503 }
      );
    }

    const raw = Number(request.nextUrl.searchParams.get("monthsBack"));
    const monthsBack = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 24) : 6;

    const result = await buildReconciliation(monthsBack);
    return NextResponse.json(result);
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Forbidden")) {
      return NextResponse.json({ error: "You do not have permission to view this." }, { status: 403 });
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
