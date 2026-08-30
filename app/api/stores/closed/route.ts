import { NextRequest, NextResponse } from "next/server";
import { requirePermission, getSession } from "@/lib/auth";
import { getStores, saveStores } from "@/lib/data";
import { getImsSnapshot } from "@/lib/imsSnapshot";
import { planClosures, type ClosedReason } from "@/lib/closedStores";
import { logActivity } from "@/lib/activityLog";

/**
 * Mark stores IMS says are shut, so no rep is routed to them.
 *
 * Reads the CACHED snapshot, never live SQL, so it works while the IMS server
 * is busy and costs nothing to preview.
 *
 * Preview is the default; `?mode=apply` is the only thing that writes, and
 * reopening is a third, separate mode. Closing and reopening are deliberately
 * not one button: one stops visits, the other starts them again, and a person
 * should have to mean each.
 */

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    await requirePermission("upload_stores");

    const mode = request.nextUrl.searchParams.get("mode");
    const includeImsFlag = request.nextUrl.searchParams.get("includeImsFlag") === "1";

    const [stores, snapshot] = await Promise.all([getStores(), getImsSnapshot()]);
    if (!snapshot) {
      return NextResponse.json(
        { error: "No IMS snapshot has been built yet. Press Refresh snapshot first." },
        { status: 400 }
      );
    }

    // ⚠️ The snapshot is a point in time. Closing a store is not reversible by
    // an upload, so it must not be decided from a picture that predates the
    // store list it is being applied to.
    if (snapshot.totals.appStores !== stores.length) {
      return NextResponse.json(
        {
          error: `The snapshot describes ${snapshot.totals.appStores.toLocaleString(
            "en-ZA"
          )} stores but there are now ${stores.length.toLocaleString(
            "en-ZA"
          )}. Refresh the snapshot before closing anything.`,
        },
        { status: 400 }
      );
    }

    const plan = planClosures(stores, snapshot.rows, { includeImsFlag });

    if (mode !== "apply" && mode !== "reopen") {
      return NextResponse.json({
        mode: "preview",
        wouldClose: plan.toClose.length,
        byReason: plan.byReason,
        alreadyClosed: plan.unchanged,
        wouldReopen: plan.toReopen.length,
        closedButSelling: plan.closedButSelling.length,
        sample: plan.toClose.slice(0, 25),
        reopenSample: plan.toReopen.slice(0, 25),
        sellingSample: plan.closedButSelling.slice(0, 10),
      });
    }

    const session = await getSession();
    const byId = new Map(stores.map((s) => [s.id, s]));
    const now = new Date().toISOString();
    let changed = 0;

    if (mode === "apply") {
      for (const move of plan.toClose) {
        const store = byId.get(move.storeId);
        if (!store) continue;
        store.closed = true;
        store.closedReason = move.reason as ClosedReason;
        store.closedAt = now;
        changed++;
      }
    } else {
      for (const move of plan.toReopen) {
        const store = byId.get(move.storeId);
        if (!store) continue;
        // Cleared rather than set to false, so the record looks like one that
        // was never closed instead of carrying a tombstone forever.
        delete store.closed;
        delete store.closedReason;
        delete store.closedAt;
        changed++;
      }
    }

    await saveStores(stores);

    await logActivity({
      action: mode === "apply" ? "Closed stores" : "Reopened stores",
      actor: session?.email ?? "unknown",
      actorName: session?.name ?? "Unknown",
      summary:
        mode === "apply"
          ? `Marked ${changed} stores closed (${plan.byReason.ims_accc} ACCC, ${plan.byReason.ims_flag} IMS closed status)`
          : `Reopened ${changed} stores IMS no longer calls closed`,
    });

    return NextResponse.json({ mode, changed, byReason: plan.byReason });
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Forbidden")) {
      return NextResponse.json({ error: "You do not have permission to close stores." }, { status: 403 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
