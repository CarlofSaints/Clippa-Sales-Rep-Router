import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { isSqlProxyConfigured } from "@/lib/sqlProxy";
import { buildReconciliation } from "@/lib/imsRecon";
import { getImsRecon } from "@/lib/imsSnapshot";

/**
 * Read-only reconciliation of the store list against the client's IMS database.
 *
 * Nothing here writes. Applying the sales figures is a separate, explicit POST,
 * so looking at the comparison can never change the data being compared.
 *
 * ⚠️ By default this serves the CACHED reconciliation and touches no SQL.
 *
 * It used to run three live queries on every page load, one of them the whole
 * ten megabyte outlet master. That is ~20 seconds when the client's server is
 * idle and was measured at 94 seconds during a spike, which is past the sixty
 * second function limit — so merely opening the page failed, and failed in the
 * way that looks like the app is broken. The snapshot the Stores page already
 * relies on is built from exactly the same three queries, so the answer was
 * sitting in a blob the whole time.
 *
 * `?live=1` still forces the live pull, for when the cache is genuinely too old
 * to trust and rebuilding the snapshot is not what you want.
 */

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requirePermission("view_sql_direct");

    const raw = Number(request.nextUrl.searchParams.get("monthsBack"));
    const monthsBack = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 24) : 6;
    const live = request.nextUrl.searchParams.get("live") === "1";

    if (!live) {
      const cached = await getImsRecon();
      if (cached) {
        // The age travels with the data. A reconciliation read from cache and
        // one pulled live are indistinguishable on screen otherwise, and these
        // numbers get quoted to the client.
        return NextResponse.json({
          ...cached.result,
          cached: true,
          fetchedAt: cached.fetchedAt,
          monthsBack: cached.monthsBack,
        });
      }
      // Never built. Say so rather than silently falling through to the slow
      // path the cache exists to avoid.
      return NextResponse.json(
        {
          error:
            "No IMS reconciliation has been cached yet. Press Refresh from IMS to build it, which takes about twenty seconds.",
          needsBuild: true,
        },
        { status: 200 }
      );
    }

    if (!isSqlProxyConfigured()) {
      return NextResponse.json(
        { error: "SQL_PROXY_URL and SQL_PROXY_API_KEY are not set on this deployment." },
        { status: 503 }
      );
    }

    const result = await buildReconciliation(monthsBack);
    return NextResponse.json({ ...result, cached: false, fetchedAt: new Date().toISOString(), monthsBack });
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Forbidden")) {
      return NextResponse.json({ error: "You do not have permission to view this." }, { status: 403 });
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
