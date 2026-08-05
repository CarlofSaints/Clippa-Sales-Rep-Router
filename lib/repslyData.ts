import { put, get } from "@vercel/blob";
import { RepslyVisit, RepslyWorkingTime, RepslySyncConfig, RepslySyncLogEntry } from "./types";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

const MAX_SYNC_LOG_ENTRIES = 100;

// ---------- low-level helpers (mirrors data.ts pattern) ----------

// Read by key, never via list() — see the note on readJSON in lib/data.ts.
// This module holds the Repsly visit history the sync appends to, so a read
// that quietly returned empty would have the sync write a truncated visit
// list back over the real one.
async function readJSON<T>(key: string, fallback: T): Promise<T> {
  if (useBlob) {
    const result = await get(`${key}.json`, { access: "private", useCache: false });
    if (!result) return fallback;
    const text = await new Response(result.stream).text();
    if (!text.trim()) return fallback;
    return JSON.parse(text) as T;
  }
  const filePath = path.join(DATA_DIR, `${key}.json`);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJSON<T>(key: string, data: T): Promise<void> {
  const body = JSON.stringify(data, null, 2);
  if (useBlob) {
    await put(`${key}.json`, body, {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return;
  }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, `${key}.json`), body, "utf-8");
}

// ---------- Repsly Config ----------

const DEFAULT_CONFIG: RepslySyncConfig = {
  apiKey: "",
  apiPasscode: "",
  enabled: false,
  lastClientSync: null,
  lastVisitSync: null,
  lastWorkingTimeSync: null,
  lastRepSync: null,
};

export async function getRepslyConfig(): Promise<RepslySyncConfig> {
  return readJSON<RepslySyncConfig>("config/repsly-api", DEFAULT_CONFIG);
}

export async function saveRepslyConfig(config: RepslySyncConfig): Promise<void> {
  await writeJSON("config/repsly-api", config);
}

// ---------- Repsly Visits ----------

export async function getRepslyVisits(): Promise<RepslyVisit[]> {
  return readJSON<RepslyVisit[]>("repsly-visits", []);
}

export async function saveRepslyVisits(visits: RepslyVisit[]): Promise<void> {
  await writeJSON("repsly-visits", visits);
}

// ---------- Repsly Working Time ----------

export async function getRepslyWorkingTime(): Promise<RepslyWorkingTime[]> {
  return readJSON<RepslyWorkingTime[]>("repsly-working-time", []);
}

export async function saveRepslyWorkingTime(records: RepslyWorkingTime[]): Promise<void> {
  await writeJSON("repsly-working-time", records);
}

// ---------- Sync Log ----------

export async function getRepslySyncLog(): Promise<RepslySyncLogEntry[]> {
  return readJSON<RepslySyncLogEntry[]>("logs/repsly-sync", []);
}

export async function appendSyncLog(entry: RepslySyncLogEntry): Promise<void> {
  const log = await getRepslySyncLog();
  log.unshift(entry); // newest first
  // Keep only last N entries
  if (log.length > MAX_SYNC_LOG_ENTRIES) log.length = MAX_SYNC_LOG_ENTRIES;
  await writeJSON("logs/repsly-sync", log);
}
