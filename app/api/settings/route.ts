import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/data";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    return NextResponse.json(await getSettings());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const current = await getSettings();
    const next = { ...current };

    const changes: string[] = [];

    if (body.outlierRadiusKm !== undefined) {
      const km = Number(body.outlierRadiusKm);
      if (!isNaN(km) && km > 0 && km !== next.outlierRadiusKm) {
        next.outlierRadiusKm = Math.round(km);
        changes.push(`out-of-range radius to ${next.outlierRadiusKm} km`);
      }
    }

    // Calls per day. `null` clears the target and returns day sizing to the
    // clock; that is a real choice and has to be expressible, which is why it
    // is not folded in with "undefined" (meaning the caller said nothing).
    if (body.callsPerDay !== undefined) {
      const previous = next.callsPerDay;
      if (body.callsPerDay === null || body.callsPerDay === "") {
        delete next.callsPerDay;
        if (previous !== undefined) changes.push("calls per day back to no target");
      } else {
        const calls = Number(body.callsPerDay);
        if (!isNaN(calls) && calls >= 1 && calls <= 30 && calls !== previous) {
          next.callsPerDay = Math.round(calls);
          changes.push(`calls per day to ${next.callsPerDay}`);
        }
      }
    }

    await saveSettings(next);

    const session = await getSession();
    const { logActivity } = await import("@/lib/activityLog");
    // Only when something actually moved. A settings page that saves on every
    // render would otherwise bury the real changes in identical entries.
    if (changes.length > 0) {
      logActivity({
        action: "Updated settings",
        actor: session?.email || "unknown",
        actorName: session?.name || "Unknown",
        summary: `Set ${changes.join(" and ")}`,
      });
    }

    return NextResponse.json(next);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
