import { NextRequest, NextResponse } from "next/server";
import { requirePermission, requireSession } from "@/lib/auth";
import { isSqlProxyConfigured } from "@/lib/sqlProxy";
import { buildImsSnapshot, getImsSnapshot, saveImsSnapshot, saveImsRecon } from "@/lib/imsSnapshot";

/**
 * The cached IMS map.
 *
 * GET is cheap and readable by any signed-in user, because the Stores page shows
 * Map Status to everyone who can see stores. POST rebuilds it from SQL, costs
 * about twenty seconds, and is gated behind the same permission as SQL Direct.
 *
 * POST now also rebuilds the cached RECONCILIATION, because both come out of the
 * same three queries. This is the single place in the app that pays for the ten
 * megabyte outlet master, which is what keeps every page render off it.
 */

// 300, not 60. This is the ONE request in the app that pulls the ten megabyte
// outlet master, and that query was measured at 94 seconds when the client's
// SQL server is contended. At 60 the platform killed the only button that can
// build the cache, which left no way to escape the slow path at all.
export const maxDuration = 300;
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

    const { snapshot, recon } = await buildImsSnapshot(monthsBack);
    // Written together. A map saved without its reconciliation would leave the
    // two caches describing different instants while both claim the same age.
    await Promise.all([saveImsSnapshot(snapshot), saveImsRecon(recon)]);

    return NextResponse.json({
      built: true,
      fetchedAt: snapshot.fetchedAt,
      monthsBack: snapshot.monthsBack,
      totals: snapshot.totals,
      reconRows: recon.result.rows.length,
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
