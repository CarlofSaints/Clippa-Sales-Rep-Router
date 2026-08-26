import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { getStores } from "@/lib/data";
import { isSqlProxyConfigured, profileColumns, sqlQuery, CLIPPA_SQL_CLIENT } from "@/lib/sqlProxy";

/**
 * Read-only reconnaissance against the SQL proxy.
 *
 * It exists to answer three questions before anybody writes an importer:
 *   1. Can this deployment reach the proxy at all?
 *   2. What does a given named query actually RETURN, and how populated is it?
 *   3. Do the Place IDs in that result match the Place IDs already in this app?
 *
 * Question 3 is the one that decides the project. The store list here came from
 * Repsly uploads and the sales figures will come from an IMS database that has
 * never met it; if the keys do not line up, everything downstream is guesswork.
 * Measuring the overlap is cheap and answers it outright.
 *
 * NOTHING here writes. No stores, no reps, no channels, no activity log entry
 * beyond what the proxy itself records. That is what makes it safe to run beside
 * the live upload path.
 */

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Anything that looks like a store identifier, whatever the SP decided to call it. */
const ID_KEYS = ["SiteID", "Site ID", "PlaceID", "Place ID", "StoreID", "Store ID", "SiteCode", "Store Code", "CustomerCode", "Customer Code", "AccountNumber", "Account Number"];

function pickIdColumn(rows: Record<string, unknown>[]): string | null {
  if (rows.length === 0) return null;
  const names = new Set<string>();
  for (const r of rows.slice(0, 50)) for (const k of Object.keys(r)) names.add(k);
  for (const candidate of ID_KEYS) {
    const hit = [...names].find((n) => n.toLowerCase().replace(/[^a-z]/g, "") === candidate.toLowerCase().replace(/[^a-z]/g, ""));
    if (hit) return hit;
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    await requirePermission("view_sql_direct");

    if (!isSqlProxyConfigured()) {
      return NextResponse.json({
        configured: false,
        error:
          "SQL_PROXY_URL and SQL_PROXY_API_KEY are not set on this deployment. They are the same two values the ARIA Scorecard portal and the Haier tracker use.",
      });
    }

    const body = await request.json().catch(() => ({}));
    const query = String(body?.query || "").trim();
    const client = String(body?.client || CLIPPA_SQL_CLIENT).trim();
    const compareOnPlaceId = body?.compareOnPlaceId !== false;
    // The IMS query takes a rolling window instead of a client name. Sent only
    // when supplied: the proxy clamps it, and queries that do not declare it
    // ignore it.
    const rawMonths = Number(body?.monthsBack);
    const monthsBack = Number.isFinite(rawMonths) ? Math.trunc(rawMonths) : null;

    if (!query) {
      return NextResponse.json({ error: "No query named." }, { status: 400 });
    }

    const startedAt = Date.now();
    // `client` is passed for the queries that take it; the proxy ignores params a
    // query does not declare, so sending it always is harmless.
    const result = await sqlQuery(query, {
      client,
      ...(monthsBack === null ? {} : { monthsBack }),
    });
    const ms = Date.now() - startedAt;

    const rows = result.data ?? [];
    const columns = profileColumns(rows);

    const response: Record<string, unknown> = {
      configured: true,
      query,
      client,
      monthsBack,
      ms,
      rowCount: result.count ?? rows.length,
      sampled: Math.min(rows.length, 200),
      columns,
      firstRow: rows[0] ?? null,
    };

    // ── The overlap question ────────────────────────────────────────────
    if (compareOnPlaceId && rows.length > 0) {
      const idColumn = pickIdColumn(rows);
      if (!idColumn) {
        response.match = {
          idColumn: null,
          note: "No column in this result looks like a store identifier, so the overlap could not be measured. Say which column to use.",
        };
      } else {
        const norm = (v: unknown) => String(v ?? "").trim().toUpperCase();
        const sqlIds = new Set(rows.map((r) => norm(r[idColumn])).filter(Boolean));

        const stores = await getStores();
        const appIds = new Set(stores.map((s) => norm(s.placeId || s.id)).filter(Boolean));

        let inBoth = 0;
        for (const id of appIds) if (sqlIds.has(id)) inBoth++;

        // A handful of each side's misses, because "2 000 did not match" is not
        // actionable and "these five look like MG-1234 versus 1234" is.
        const appOnly = [...appIds].filter((id) => !sqlIds.has(id)).slice(0, 10);
        const sqlOnly = [...sqlIds].filter((id) => !appIds.has(id)).slice(0, 10);

        response.match = {
          idColumn,
          appStores: appIds.size,
          sqlRows: sqlIds.size,
          inBoth,
          appMatchedPercent: appIds.size === 0 ? 0 : Math.round((inBoth / appIds.size) * 1000) / 10,
          appOnlySample: appOnly,
          sqlOnlySample: sqlOnly,
        };
      }
    }

    return NextResponse.json(response);
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Forbidden")) {
      return NextResponse.json({ error: "You do not have permission to use SQL Direct." }, { status: 403 });
    }
    // The proxy's own message is the useful part and is passed through intact.
    return NextResponse.json({ configured: true, error: msg }, { status: 502 });
  }
}
