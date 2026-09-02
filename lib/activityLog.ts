import { put, get } from "@vercel/blob";
import { after } from "next/server";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
const MAX_ENTRIES = 500;

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  action: string;
  actor: string;      // email
  actorName: string;
  summary: string;
  details?: string;
}

function monthKey(month?: string): string {
  if (month && /^\d{4}-\d{2}$/.test(month)) return month;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function blobKey(month: string): string {
  return `logs/activity/${month}`;
}

async function readLog(month: string): Promise<ActivityLogEntry[]> {
  const key = blobKey(month);
  if (useBlob) {
    // Read by key, not via list() — see the note on readJSON in lib/data.ts.
    // The listing index lags a write, and turning the resulting 404 into an
    // empty log meant writing that empty log back over the month's entries.
    const result = await get(`${key}.json`, { access: "private", useCache: false });
    if (!result) return [];
    const text = await new Response(result.stream).text();
    if (!text.trim()) return [];
    return JSON.parse(text) as ActivityLogEntry[];
  }
  const filePath = path.join(DATA_DIR, `${key}.json`);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as ActivityLogEntry[];
  } catch {
    return [];
  }
}

async function writeLog(month: string, entries: ActivityLogEntry[]): Promise<void> {
  const key = blobKey(month);
  const body = JSON.stringify(entries, null, 2);
  if (useBlob) {
    await put(`${key}.json`, body, {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return;
  }
  const dir = path.dirname(path.join(DATA_DIR, `${key}.json`));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, `${key}.json`), body, "utf-8");
}

/**
 * Appends run ONE AT A TIME, in this instance.
 *
 * 🔴 Every append is a read-modify-write of the whole month: read the array,
 * unshift, write it all back. Two of them in flight together both read the same
 * array and the second write erases the first entry. Measured: a route that
 * logged twice in one request reliably kept only one of the two, and NINE
 * routes here log more than once per handler. `/api/allocation` is the worst of
 * them — its two entries are the allocation-source change and the list of every
 * store that moved, which is the record that makes the change reversible by
 * inspection rather than by a backup nobody took.
 *
 * A promise chain fixes that completely, because both calls are in one process.
 *
 * ⚠️ It does NOT make concurrent appends from two serverless INSTANCES safe;
 * that needs a per-entry write rather than one shared array. Two people acting
 * in the same second can still lose an entry. This removes the failure that was
 * happening on every single multi-log request.
 */
let appendChain: Promise<void> = Promise.resolve();

/**
 * Activity logger. Call without await in API routes — the write is handed to
 * Next's after(), which keeps the serverless instance alive until it finishes.
 *
 * A bare fire-and-forget promise does NOT survive on Vercel: once the response
 * is sent the instance can be frozen mid-write, so entries were being dropped.
 */
export function logActivity(entry: Omit<ActivityLogEntry, "id" | "timestamp">): void {
  const full: ActivityLogEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  };
  const month = monthKey();

  const write = async () => {
    // Queue behind whatever is already appending. The chain is never allowed to
    // reject, or one failed write would silently swallow every later one.
    const mine = appendChain.then(async () => {
      const entries = await readLog(month);
      entries.unshift(full);
      if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
      await writeLog(month, entries);
    });
    appendChain = mine.catch(() => {});
    await mine;
  };

  const run = () => write().catch((err) => {
    console.error("logActivity failed:", err);
  });

  try {
    // Only available inside a request lifecycle; scripts and tests fall back.
    after(run);
  } catch {
    run();
  }
}

/**
 * Read log entries for a given month.
 */
export async function getActivityLog(month?: string): Promise<ActivityLogEntry[]> {
  return readLog(monthKey(month));
}
