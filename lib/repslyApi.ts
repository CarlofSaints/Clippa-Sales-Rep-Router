import { RepslyVisit, RepslyWorkingTime, RepslyVisitSchedule } from "./types";

const BASE_URL = "https://api.repsly.com/v3";

function authHeaders(apiKey: string, apiPasscode: string): Record<string, string> {
  const encoded = Buffer.from(`${apiKey}:${apiPasscode}`).toString("base64");
  return {
    Authorization: `Basic ${encoded}`,
    "Content-Type": "application/json",
  };
}

// ---------- Connection Test ----------

export async function testConnection(apiKey: string, apiPasscode: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/export/representatives`, {
      headers: authHeaders(apiKey, apiPasscode),
    });
    if (res.status === 401) return { ok: false, error: "Invalid API key or passcode" };
    if (!res.ok) return { ok: false, error: `Repsly returned HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

// ---------- Representatives ----------

interface RepslyRepRaw {
  Code: string;
  Name: string;
  Email: string;
  Phone: string;
  Active: boolean;
}

export interface RepslyRep {
  code: string;
  name: string;
  email: string;
  phone: string;
  active: boolean;
}

export async function fetchAllReps(apiKey: string, apiPasscode: string): Promise<RepslyRep[]> {
  const res = await fetch(`${BASE_URL}/export/representatives`, {
    headers: authHeaders(apiKey, apiPasscode),
  });
  if (!res.ok) throw new Error(`Repsly reps API returned ${res.status}`);
  const data = await res.json();
  const raw: RepslyRepRaw[] = data?.Representatives ?? data ?? [];
  return raw.map((r) => ({
    code: r.Code ?? "",
    name: r.Name ?? "",
    email: r.Email ?? "",
    phone: r.Phone ?? "",
    active: r.Active !== false,
  }));
}

// ---------- Clients ----------

interface RepslyClientRaw {
  Code: string;
  Name: string;
  Street: string;
  City: string;
  ZipCode: string;
  State: string;
  Latitude: number;
  Longitude: number;
  Active: boolean;
  Tag: string;
  RepresentativeCode: string;
  RepresentativeName: string;
}

export interface RepslyClient {
  code: string;
  name: string;
  street: string;
  city: string;
  zipCode: string;
  state: string;
  lat: number;
  lng: number;
  active: boolean;
  tag: string;
  repCode: string;
  repName: string;
}

export async function fetchAllClients(apiKey: string, apiPasscode: string): Promise<RepslyClient[]> {
  const results: RepslyClient[] = [];
  let skip = 0;
  const take = 50;

  while (true) {
    const res = await fetch(`${BASE_URL}/export/clients/${skip}`, {
      headers: authHeaders(apiKey, apiPasscode),
    });
    if (!res.ok) throw new Error(`Repsly clients API returned ${res.status}`);
    const data = await res.json();
    const meta = data?.MetaCollectionResult;
    const raw: RepslyClientRaw[] = data?.Clients ?? [];

    for (const c of raw) {
      results.push({
        code: c.Code ?? "",
        name: c.Name ?? "",
        street: c.Street ?? "",
        city: c.City ?? "",
        zipCode: c.ZipCode ?? "",
        state: c.State ?? "",
        lat: c.Latitude ?? 0,
        lng: c.Longitude ?? 0,
        active: c.Active !== false,
        tag: c.Tag ?? "",
        repCode: c.RepresentativeCode ?? "",
        repName: c.RepresentativeName ?? "",
      });
    }

    if (!meta || meta.TotalCount === 0 || raw.length === 0) break;
    skip += take;
  }

  return results;
}

// ---------- Visits ----------

interface RepslyVisitRaw {
  VisitID: number;
  Date: string;
  DateAndTime: string;
  DateTimeStart: string;
  DateTimeEnd: string;
  RepresentativeCode: string;
  RepresentativeName: string;
  ClientCode: string;
  ClientName: string;
  ScheduledVsUnscheduled: string;
  Latitude: number;
  Longitude: number;
}

export async function fetchAllVisits(
  apiKey: string,
  apiPasscode: string,
  since?: string | null
): Promise<RepslyVisit[]> {
  const results: RepslyVisit[] = [];
  // Repsly visits export uses timestamp-based pagination
  // GET /v3/export/visits/{timestamp} where timestamp is "YYYYMMDDHHmmss" or "0" for all
  let timestamp = "0";
  if (since) {
    // Convert ISO datetime to Repsly timestamp format
    const d = new Date(since);
    if (!isNaN(d.getTime())) {
      timestamp = d.getFullYear().toString() +
        String(d.getMonth() + 1).padStart(2, "0") +
        String(d.getDate()).padStart(2, "0") +
        String(d.getHours()).padStart(2, "0") +
        String(d.getMinutes()).padStart(2, "0") +
        String(d.getSeconds()).padStart(2, "0");
    }
  }

  while (true) {
    const res = await fetch(`${BASE_URL}/export/visits/${timestamp}`, {
      headers: authHeaders(apiKey, apiPasscode),
    });
    if (!res.ok) throw new Error(`Repsly visits API returned ${res.status}`);
    const data = await res.json();
    const meta = data?.MetaCollectionResult;
    const raw: RepslyVisitRaw[] = data?.Visits ?? [];

    for (const v of raw) {
      const dateStr = v.Date ? v.Date.substring(0, 10) : "";
      results.push({
        visitId: String(v.VisitID),
        date: dateStr,
        repCode: v.RepresentativeCode ?? "",
        repName: v.RepresentativeName ?? "",
        clientCode: v.ClientCode ?? "",
        clientName: v.ClientName ?? "",
        dateTimeStart: v.DateTimeStart ?? v.DateAndTime ?? "",
        dateTimeEnd: v.DateTimeEnd ?? "",
        scheduledVsUnscheduled: v.ScheduledVsUnscheduled ?? "",
        latStart: v.Latitude ?? 0,
        lngStart: v.Longitude ?? 0,
      });
    }

    if (!meta || meta.TotalCount === 0 || raw.length === 0) break;

    // Use the last timestamp from meta for next page
    if (meta.Timestamp) {
      timestamp = meta.Timestamp;
    } else {
      break;
    }
  }

  return results;
}

// ---------- Daily Working Time ----------

interface RepslyWorkingTimeRaw {
  DailyWorkingTimeID: number;
  Date: string;
  RepresentativeCode: string;
  RepresentativeName: string;
  DayStart: string;
  DayEnd: string;
  Length: number;
  MileageTotal: number;
  NoOfVisits: number;
  TimeAtClient: number;
  TimeAtTravel: number;
}

export async function fetchAllDailyWorkingTime(
  apiKey: string,
  apiPasscode: string,
  since?: string | null
): Promise<RepslyWorkingTime[]> {
  const results: RepslyWorkingTime[] = [];
  // GET /v3/export/dailyworkingtime/{lastId} — 0 for all
  let lastId = "0";
  if (since) {
    // since is stored as the last ID we fetched
    lastId = since;
  }

  while (true) {
    const res = await fetch(`${BASE_URL}/export/dailyworkingtime/${lastId}`, {
      headers: authHeaders(apiKey, apiPasscode),
    });
    if (!res.ok) throw new Error(`Repsly working time API returned ${res.status}`);
    const data = await res.json();
    const meta = data?.MetaCollectionResult;
    const raw: RepslyWorkingTimeRaw[] = data?.DailyWorkingTimes ?? [];

    for (const w of raw) {
      const dateStr = w.Date ? w.Date.substring(0, 10) : "";
      results.push({
        id: String(w.DailyWorkingTimeID),
        date: dateStr,
        repCode: w.RepresentativeCode ?? "",
        repName: w.RepresentativeName ?? "",
        dayStart: w.DayStart ?? "",
        dayEnd: w.DayEnd ?? "",
        lengthMinutes: w.Length ?? 0,
        mileageTotal: w.MileageTotal ?? 0,
        noOfVisits: w.NoOfVisits ?? 0,
        timeAtClient: w.TimeAtClient ?? 0,
        timeAtTravel: w.TimeAtTravel ?? 0,
      });
    }

    if (!meta || meta.TotalCount === 0 || raw.length === 0) break;

    // Use last ID for next page
    if (raw.length > 0) {
      const maxId = Math.max(...raw.map((w) => w.DailyWorkingTimeID));
      const newLastId = String(maxId);
      if (newLastId === lastId) break; // no progress
      lastId = newLastId;
    } else {
      break;
    }
  }

  return results;
}

// ---------- Visit Schedules (the call cycle Repsly holds) ----------

/**
 * ⚠️ This endpoint has never been called against a live Repsly account from
 * here, so its exact response shape is unverified.
 *
 * Everything below is therefore written to survive being slightly wrong rather
 * than to assume it is right: the envelope key is looked for under several
 * names, every field is read case-insensitively, and `fetchVisitSchedules`
 * hands back the raw first row alongside the parsed rows so the Test button can
 * show what actually arrived. A parser that silently returned zero rows would
 * be indistinguishable from a rep with no schedule.
 */

export interface RepslyScheduleFetch {
  schedules: RepslyVisitSchedule[];
  /** What Repsly actually sent, first row only, for the Test view. */
  rawSample: unknown;
  /** The envelope key the rows were found under, or null if none matched. */
  envelope: string | null;
  /** The URL that was called, so a 404 can be told from an empty week. */
  url: string;
}

/** Repsly's date path segments are plain YYYY-MM-DD. */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Field lookup that does not care how Repsly cased or spaced the key. */
export function pick(row: Record<string, unknown>, ...names: string[]): string {
  const entries = Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v] as const);
  for (const n of names) {
    const hit = entries.find(([k]) => k === n.trim().toLowerCase());
    if (hit && hit[1] !== null && hit[1] !== undefined && hit[1] !== "") return String(hit[1]).trim();
  }
  return "";
}

export const SCHEDULE_ENVELOPES = ["VisitSchedules", "VisitSchedule", "Schedules", "Visitschedules"];

export async function fetchVisitSchedules(
  apiKey: string,
  apiPasscode: string,
  beginDate: Date,
  endDate: Date
): Promise<RepslyScheduleFetch> {
  const url = `${BASE_URL}/export/visitschedules/${ymd(beginDate)}/${ymd(endDate)}`;
  const res = await fetch(url, { headers: authHeaders(apiKey, apiPasscode) });
  if (res.status === 401) throw new Error("Invalid API key or passcode");
  if (!res.ok) throw new Error(`Repsly visit schedules API returned ${res.status} for ${url}`);
  const data = await res.json();
  const { schedules, rawSample, envelope } = parseVisitSchedules(data);
  return { schedules, rawSample, envelope, url };
}

/**
 * Envelope detection and row mapping, split out from the fetch so it can be
 * asserted without a live Repsly account. This endpoint has never run against
 * the real API from here, so the parser is the part most likely to be wrong and
 * the part that most needs a test.
 */
export function parseVisitSchedules(data: unknown): {
  schedules: RepslyVisitSchedule[];
  rawSample: unknown;
  envelope: string | null;
} {
  let envelope: string | null = null;
  let raw: Record<string, unknown>[] = [];
  if (Array.isArray(data)) {
    envelope = "(bare array)";
    raw = data as Record<string, unknown>[];
  } else if (data && typeof data === "object") {
    for (const key of SCHEDULE_ENVELOPES) {
      const found = (data as Record<string, unknown>)[key];
      if (Array.isArray(found)) {
        envelope = key;
        raw = found as Record<string, unknown>[];
        break;
      }
    }
  }

  const schedules: RepslyVisitSchedule[] = raw.map((r) => {
    const date = pick(r, "ScheduleDate", "DueDate", "Date", "DateAndTime");
    const repCode = pick(r, "RepresentativeCode", "RepCode");
    const clientCode = pick(r, "ClientCode", "ClientID");
    // Repsly does not always issue a schedule id. Rep + client + day identifies
    // the call well enough to deduplicate on, and a composite key is honest
    // about being derived.
    const given = pick(r, "ScheduleCode", "VisitScheduleID", "ScheduleID", "ID");
    return {
      scheduleId: given || [repCode, clientCode, date.substring(0, 10)].join("|"),
      date: date.substring(0, 10),
      repCode,
      repName: pick(r, "RepresentativeName", "RepName"),
      clientCode,
      clientName: pick(r, "ClientName", "PlaceName"),
      dateTimeStart: pick(r, "DateTimeStart", "TimeStart", "DateAndTime"),
      dateTimeEnd: pick(r, "DateTimeEnd", "TimeEnd"),
      note: pick(r, "VisitNote", "Note", "Description"),
    };
  });

  return { schedules, rawSample: raw[0] ?? null, envelope };
}
