import { put, list, del } from "@vercel/blob";
import { Visit } from "./types";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
const BLOB_KEY = "visits.json";

export async function getVisits(): Promise<Visit[]> {
  if (useBlob) {
    try {
      const { blobs } = await list({ prefix: BLOB_KEY });
      if (blobs.length === 0) return [];
      const res = await fetch(blobs[0].url, {
        headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
      });
      return (await res.json()) as Visit[];
    } catch {
      return [];
    }
  }
  const filePath = path.join(DATA_DIR, BLOB_KEY);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as Visit[];
  } catch {
    return [];
  }
}

export async function saveVisits(visits: Visit[]): Promise<void> {
  const body = JSON.stringify(visits, null, 2);
  if (useBlob) {
    try {
      const { blobs } = await list({ prefix: BLOB_KEY });
      for (const b of blobs) await del(b.url);
    } catch { /* ignore */ }
    await put(BLOB_KEY, body, {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
    });
    return;
  }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, BLOB_KEY), body, "utf-8");
}
