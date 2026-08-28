import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, getSession } from "@/lib/auth";
import { getRepslyConfig, saveRepslyConfig, getRepslyVisits, saveRepslyVisits, getRepslyWorkingTime, saveRepslyWorkingTime, getRepslySchedules, saveRepslySchedules, appendSyncLog } from "@/lib/repslyData";
import { getStores, getReps, saveStores, saveReps } from "@/lib/data";
import { fetchAllVisits, fetchAllClients, fetchAllDailyWorkingTime, fetchAllReps, fetchVisitSchedules } from "@/lib/repslyApi";
import { logActivity } from "@/lib/activityLog";
import { RepslySyncConfig, RepslySyncLogEntry } from "@/lib/types";

export const maxDuration = 60;

// POST — run a sync
// Body: { type: "clients" | "visits" | "working_time" | "reps", mode: "test" | "import" }
export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { type, mode } = await request.json();
  if (!["clients", "visits", "working_time", "reps", "call_cycles"].includes(type)) {
    return NextResponse.json({ error: "Invalid sync type" }, { status: 400 });
  }
  if (!["test", "import"].includes(mode)) {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }

  const config = await getRepslyConfig();
  if (!config.apiKey || !config.apiPasscode) {
    return NextResponse.json({ error: "Repsly API credentials not configured" }, { status: 400 });
  }

  try {
    if (type === "visits") {
      return await syncVisits(config, mode);
    } else if (type === "clients") {
      return await syncClients(config, mode);
    } else if (type === "working_time") {
      return await syncWorkingTime(config, mode);
    } else if (type === "reps") {
      return await syncReps(config, mode);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    await appendSyncLog({
      timestamp: new Date().toISOString(),
      type,
      recordsImported: 0,
      recordsSkipped: 0,
      error: errorMsg,
    });
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }

  return NextResponse.json({ error: "Unknown type" }, { status: 400 });
}

// ---------- Sync: Visits ----------

async function syncVisits(config: RepslySyncConfig, mode: string) {
  const fetched = await fetchAllVisits(config.apiKey, config.apiPasscode, config.lastVisitSync);

  if (mode === "test") {
    return NextResponse.json({
      mode: "test",
      type: "visits",
      recordsFound: fetched.length,
      sample: fetched.slice(0, 5),
    });
  }

  // Import — merge with existing, deduplicate by visitId
  const existing = await getRepslyVisits();
  const existingIds = new Set(existing.map((v) => v.visitId));
  let imported = 0;
  let skipped = 0;

  for (const v of fetched) {
    if (existingIds.has(v.visitId)) {
      skipped++;
    } else {
      existing.push(v);
      existingIds.add(v.visitId);
      imported++;
    }
  }

  await saveRepslyVisits(existing);

  // Update last sync timestamp
  config.lastVisitSync = new Date().toISOString();
  await saveRepslyConfig(config);

  const logEntry: RepslySyncLogEntry = {
    timestamp: new Date().toISOString(),
    type: "visits",
    recordsImported: imported,
    recordsSkipped: skipped,
  };
  await appendSyncLog(logEntry);

  const session = await getSession();
  logActivity({ action: "Synced Repsly visits", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Synced Repsly visits: ${imported} imported, ${skipped} skipped` });

  return NextResponse.json({
    mode: "import",
    type: "visits",
    recordsImported: imported,
    recordsSkipped: skipped,
    totalStored: existing.length,
  });
}

// ---------- Sync: Call Cycles (Repsly's visit schedules) ----------

/**
 * How far either side of today to ask for.
 *
 * The schedules endpoint takes a date RANGE rather than a "since" cursor, so
 * unlike the other three this sync cannot be incremental. A fixed window is
 * honest about that: it always fetches the same span and replaces what it holds,
 * so the stored set is a snapshot of the current cycle, never a growing pile.
 */
const SCHEDULE_DAYS_BACK = 30;
const SCHEDULE_DAYS_FORWARD = 60;

async function syncCallCycles(config: RepslySyncConfig, mode: string) {
  const now = new Date();
  const begin = new Date(now);
  begin.setDate(begin.getDate() - SCHEDULE_DAYS_BACK);
  const end = new Date(now);
  end.setDate(end.getDate() + SCHEDULE_DAYS_FORWARD);

  const { schedules, rawSample, envelope, url } = await fetchVisitSchedules(
    config.apiKey,
    config.apiPasscode,
    begin,
    end
  );

  // ⚠️ Zero rows has two very different causes and they must not look the same:
  // no schedules exist in the window, or the response came back in a shape this
  // parser does not recognise. `envelope` separates them, and Test reports both.
  const unrecognised = envelope === null;

  if (mode === "test") {
    return NextResponse.json({
      mode: "test",
      type: "call_cycles",
      recordsFound: schedules.length,
      sample: schedules.slice(0, 5),
      // Everything needed to diagnose a first run that returns nothing, without
      // anybody having to add logging and try again.
      diagnostics: {
        url,
        envelope,
        unrecognised,
        rawSample,
        window: { from: begin.toISOString().substring(0, 10), to: end.toISOString().substring(0, 10) },
      },
    });
  }

  if (unrecognised) {
    throw new Error(
      `Repsly answered ${url} but the rows were not under any expected key. Press Test to see the raw response before importing.`
    );
  }

  // Replace, not append: this is a snapshot of a moving window, and merging
  // would keep schedules that Repsly has since moved or cancelled.
  const previous = await getRepslySchedules();
  const seen = new Set<string>();
  const deduped = schedules.filter((s) => {
    if (seen.has(s.scheduleId)) return false;
    seen.add(s.scheduleId);
    return true;
  });
  await saveRepslySchedules(deduped);

  config.lastCallCycleSync = new Date().toISOString();
  await saveRepslyConfig(config);

  const logEntry: RepslySyncLogEntry = {
    timestamp: new Date().toISOString(),
    type: "call_cycles",
    recordsImported: deduped.length,
    recordsSkipped: schedules.length - deduped.length,
  };
  await appendSyncLog(logEntry);

  const session = await getSession();
  logActivity({
    action: "Synced Repsly call cycles",
    actor: session?.email || "unknown",
    actorName: session?.name || "Unknown",
    summary: `Synced Repsly call cycles: ${deduped.length} scheduled visits (replaced ${previous.length})`,
  });

  return NextResponse.json({
    mode: "import",
    type: "call_cycles",
    recordsImported: deduped.length,
    recordsSkipped: schedules.length - deduped.length,
    totalStored: deduped.length,
    replaced: previous.length,
  });
}

// ---------- Sync: Clients ----------

async function syncClients(config: RepslySyncConfig, mode: string) {
  const fetched = await fetchAllClients(config.apiKey, config.apiPasscode);

  if (mode === "test") {
    return NextResponse.json({
      mode: "test",
      type: "clients",
      recordsFound: fetched.length,
      sample: fetched.slice(0, 5),
    });
  }

  // Match Repsly clients to existing stores by clientCode === store.placeId
  const stores = await getStores();
  let updated = 0;
  let skipped = 0;

  for (const client of fetched) {
    if (!client.code) { skipped++; continue; }
    const store = stores.find((s) => s.placeId === client.code);
    if (!store) { skipped++; continue; }

    // Update GPS only if blank
    let changed = false;
    if ((!store.gpsLat || store.gpsLat === "0") && client.lat) {
      store.gpsLat = String(client.lat);
      changed = true;
    }
    if ((!store.gpsLng || store.gpsLng === "0") && client.lng) {
      store.gpsLng = String(client.lng);
      changed = true;
    }
    if (changed) updated++;
    else skipped++;
  }

  if (updated > 0) await saveStores(stores);

  config.lastClientSync = new Date().toISOString();
  await saveRepslyConfig(config);

  await appendSyncLog({
    timestamp: new Date().toISOString(),
    type: "clients",
    recordsImported: updated,
    recordsSkipped: skipped,
  });

  const session = await getSession();
  logActivity({ action: "Synced Repsly clients", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Synced Repsly clients: ${updated} updated, ${skipped} skipped` });

  return NextResponse.json({
    mode: "import",
    type: "clients",
    recordsImported: updated,
    recordsSkipped: skipped,
    totalRepslyClients: fetched.length,
    totalStores: stores.length,
  });
}

// ---------- Sync: Working Time ----------

async function syncWorkingTime(config: RepslySyncConfig, mode: string) {
  const fetched = await fetchAllDailyWorkingTime(config.apiKey, config.apiPasscode, config.lastWorkingTimeSync);

  if (mode === "test") {
    return NextResponse.json({
      mode: "test",
      type: "working_time",
      recordsFound: fetched.length,
      sample: fetched.slice(0, 5),
    });
  }

  const existing = await getRepslyWorkingTime();
  const existingIds = new Set(existing.map((w) => w.id));
  let imported = 0;
  let skipped = 0;

  for (const w of fetched) {
    if (existingIds.has(w.id)) {
      skipped++;
    } else {
      existing.push(w);
      existingIds.add(w.id);
      imported++;
    }
  }

  await saveRepslyWorkingTime(existing);

  // Store last ID for incremental fetch
  if (existing.length > 0) {
    const maxId = Math.max(...existing.map((w) => parseInt(w.id) || 0));
    config.lastWorkingTimeSync = String(maxId);
  }
  await saveRepslyConfig(config);

  await appendSyncLog({
    timestamp: new Date().toISOString(),
    type: "working_time",
    recordsImported: imported,
    recordsSkipped: skipped,
  });

  const session = await getSession();
  logActivity({ action: "Synced Repsly working time", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Synced Repsly working time: ${imported} imported, ${skipped} skipped` });

  return NextResponse.json({
    mode: "import",
    type: "working_time",
    recordsImported: imported,
    recordsSkipped: skipped,
    totalStored: existing.length,
  });
}

// ---------- Sync: Reps ----------

async function syncReps(config: RepslySyncConfig, mode: string) {
  const fetched = await fetchAllReps(config.apiKey, config.apiPasscode);

  if (mode === "test") {
    return NextResponse.json({
      mode: "test",
      type: "reps",
      recordsFound: fetched.length,
      sample: fetched.slice(0, 5),
    });
  }

  // Match by rep code, update name/contact
  const reps = await getReps();
  let updated = 0;
  let skipped = 0;

  for (const repslyRep of fetched) {
    if (!repslyRep.code) { skipped++; continue; }
    const rep = reps.find((r) => r.code === repslyRep.code);
    if (!rep) { skipped++; continue; }

    let changed = false;
    if (repslyRep.name && rep.name !== repslyRep.name) {
      rep.name = repslyRep.name;
      changed = true;
    }
    if (repslyRep.email && rep.email !== repslyRep.email) {
      rep.email = repslyRep.email;
      changed = true;
    }
    if (repslyRep.phone && rep.cell !== repslyRep.phone) {
      rep.cell = repslyRep.phone;
      changed = true;
    }
    if (changed) updated++;
    else skipped++;
  }

  if (updated > 0) await saveReps(reps);

  config.lastRepSync = new Date().toISOString();
  await saveRepslyConfig(config);

  await appendSyncLog({
    timestamp: new Date().toISOString(),
    type: "reps",
    recordsImported: updated,
    recordsSkipped: skipped,
  });

  const session = await getSession();
  logActivity({ action: "Synced Repsly reps", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Synced Repsly reps: ${updated} updated, ${skipped} skipped` });

  return NextResponse.json({
    mode: "import",
    type: "reps",
    recordsImported: updated,
    recordsSkipped: skipped,
    totalRepslyReps: fetched.length,
    totalAppReps: reps.length,
  });
}
