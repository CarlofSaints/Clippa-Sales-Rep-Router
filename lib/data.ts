import { put, list, del } from "@vercel/blob";
import { Channel, Rep, Store, User, Team } from "./types";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

// ---------- low-level helpers ----------

async function readJSON<T>(key: string, fallback: T): Promise<T> {
  if (useBlob) {
    try {
      const { blobs } = await list({ prefix: `${key}.json` });
      if (blobs.length === 0) return fallback;
      // downloadUrl works for both public and private blobs (signed URL)
      const res = await fetch(blobs[0].downloadUrl);
      return (await res.json()) as T;
    } catch {
      return fallback;
    }
  }
  // local file fallback
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
    // delete old blob first
    try {
      const { blobs } = await list({ prefix: `${key}.json` });
      for (const b of blobs) await del(b.url);
    } catch { /* ignore */ }
    await put(`${key}.json`, body, {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
    });
    return;
  }
  // local file fallback
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, `${key}.json`), body, "utf-8");
}

// ---------- Channels ----------

export async function getChannels(): Promise<Channel[]> {
  return readJSON<Channel[]>("channels", []);
}

export async function saveChannels(channels: Channel[]): Promise<void> {
  await writeJSON("channels", channels);
}

// ---------- Reps ----------

export async function getReps(): Promise<Rep[]> {
  return readJSON<Rep[]>("reps", []);
}

export async function saveReps(reps: Rep[]): Promise<void> {
  await writeJSON("reps", reps);
}

// ---------- Stores ----------

export async function getStores(): Promise<Store[]> {
  return readJSON<Store[]>("stores", []);
}

export async function saveStores(stores: Store[]): Promise<void> {
  await writeJSON("stores", stores);
}

// ---------- Users ----------

export async function getUsers(): Promise<User[]> {
  return readJSON<User[]>("users", []);
}

export async function saveUsers(users: User[]): Promise<void> {
  await writeJSON("users", users);
}

// ---------- Teams ----------

export async function getTeams(): Promise<Team[]> {
  return readJSON<Team[]>("teams", []);
}

export async function saveTeams(teams: Team[]): Promise<void> {
  await writeJSON("teams", teams);
}
