import { NextRequest, NextResponse } from "next/server";
import { requirePermission, requireSession } from "@/lib/auth";
import { isSqlProxyConfigured } from "@/lib/sqlProxy";
import { buildImsSnapshot, getImsSnapshot, saveImsSnapshot } from "@/lib/imsSnapshot";

/**
 * The cached IMS map.
 *
 * GET is cheap and readable by any signed-in user, because the Stores page shows
 * Map Status to everyone who can see stores. POST rebuilds it from SQL, costs
 * about twenty seconds, and is gated behind the same permission as SQL Direct.
 */

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Any signed-in user, so the Stores grid can colour its rows.
    await requireSession();
    const snapshot = await getImsSnapshot();
    if (!snapshot) {
      return NextResponse.json(
        { built: false, message: "No IMS snapshot has been taken yet. Refresh it from IMS Reconciliation." },
        { status: 200 }
      );
    }
    return NextResponse.json({ built: true, ...snapshot });
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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

    const snapshot = await buildImsSnapshot(monthsBack);
    await saveImsSnapshot(snapshot);

    return NextResponse.json({
      built: true,
      fetchedAt: snapshot.fetchedAt,
      monthsBack: snapshot.monthsBack,
      totals: snapshot.totals,
    });
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Forbidden")) {
      return NextResponse.json({ error: "You do not have permission to refresh the IMS snapshot." }, { status: 403 });
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
