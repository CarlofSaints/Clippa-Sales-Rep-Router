import { Rep, RepCodeRules } from "./types";
import { resolveRepCode } from "./repCodeRules";

/**
 * Loading a rep list from a spreadsheet.
 *
 * The app had no way to get reps IN. They arrived once, by hand, and the list
 * then drifted from the client's: on 25 Aug the stores carried 34 different rep
 * codes and only 17 of them had a rep record, so 2 570 stores were allocated to
 * people the app had never heard of and could not route.
 *
 * Written as a pure function over already-parsed rows so the same logic serves
 * the upload button and a script run against live data — and so it can be tested
 * without a spreadsheet, a session or a network.
 */

export interface RepImportRow {
  code: string;
  name?: string;
  email?: string;
  cell?: string;
  homeAddress?: string;
  workingHoursPerDay?: number;
}

export interface RepImportChange {
  code: string;
  name: string;
  /** What actually changed, e.g. `email: "" -> grant.gerber@clippasales.com`. */
  fields: string[];
}

export interface RepImportResult {
  created: RepImportChange[];
  updated: RepImportChange[];
  unchanged: number;
  /** Rows that could not be used at all. */
  rejected: { row: number; reason: string }[];
  /** Things that worked but somebody should look at. */
  warnings: string[];
  /**
   * Existing reps whose NAME differs from the file. Deliberately not applied —
   * see applyRepImport — but always reported, because a name mismatch can mean
   * the code has been reassigned to a different person.
   */
  nameDifferences: { code: string; current: string; inFile: string }[];
  /** Which optional columns the file carried. An absent column is left alone. */
  columnsPresent: string[];
  /** The new rep list, ready to save. Identical to the input when nothing changed. */
  reps: Rep[];
}

/** "GRANT GERBER" -> "Grant Gerber", leaving mixed-case names as they are. */
export function tidyName(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  // Only reformat shouting. A name already cased by a human is left alone.
  if (trimmed !== trimmed.toUpperCase()) return trimmed;
  return trimmed
    .toLowerCase()
    .replace(/(^|[\s\-'/(])([a-z])/g, (_m, lead, ch) => lead + ch.toUpperCase());
}

export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Apply `rows` to `existing`.
 *
 * Rules, and why:
 *
 * - Matched on REP CODE, case-insensitively. The code is what the store list
 *   uses, so it is the only key that ties the two together.
 * - An unknown code is CREATED. This importer exists to onboard the reps the app
 *   is missing, which is the opposite of the stores importer's update-only rule.
 * - A column ABSENT from the file leaves that field alone on every rep, so a
 *   cut-down "codes and emails" sheet is safe to send.
 * - A cell that is PRESENT BUT BLANK also leaves the field alone. ⚠️ This is
 *   deliberately DIFFERENT from the stores importer, where blank clears. Bulk
 *   clearing is the whole point there (wrong coordinates) and nobody bulk-clears
 *   an email address, so the risk of silently wiping 63 addresses outweighs the
 *   convenience. Clearing one email is an inline edit on the grid.
 * - A NAME that differs on an existing rep is reported, never written. The app's
 *   names are cased properly and the client's exports shout; overwriting would
 *   trade good data for bad. The report is there so a genuine reassignment gets
 *   noticed.
 */
/**
 * @param rules Which codes are not a rep. Optional, and absent means "no rules
 * apply" — the behaviour before this existed, which keeps every existing caller
 * and every assertion honest. When supplied, a code the rules exclude can never
 * be CREATED as a rep, however the sheet is written. Updating a rep that
 * already exists is left alone on purpose: the guard is against a spreadsheet
 * inventing `CMRINL` as a person, not against maintaining a real record.
 */
export function applyRepImport(
  existing: Rep[],
  rows: RepImportRow[],
  rules?: RepCodeRules
): RepImportResult {
  const reps: Rep[] = existing.map((r) => ({ ...r }));
  const byCode = new Map(reps.map((r) => [r.code.trim().toUpperCase(), r]));

  const created: RepImportChange[] = [];
  const updated: RepImportChange[] = [];
  const rejected: { row: number; reason: string }[] = [];
  const warnings: string[] = [];
  const nameDifferences: { code: string; current: string; inFile: string }[] = [];
  let unchanged = 0;

  const columnsPresent: string[] = [];
  const has = (key: keyof RepImportRow) => rows.some((r) => r[key] !== undefined);
  for (const key of ["name", "email", "cell", "homeAddress", "workingHoursPerDay"] as const) {
    if (has(key)) columnsPresent.push(key);
  }

  const seenInFile = new Set<string>();
  const emailOwners = new Map<string, string[]>();

  rows.forEach((row, i) => {
    // +2 because row 1 is the header and spreadsheet rows are 1-indexed.
    const rowNumber = i + 2;
    const code = (row.code || "").trim().toUpperCase();

    if (!code) {
      rejected.push({ row: rowNumber, reason: "No rep code" });
      return;
    }
    if (seenInFile.has(code)) {
      warnings.push(`${code} appears more than once in the file — the last row won.`);
    }
    seenInFile.add(code);

    const email = (row.email || "").trim().toLowerCase();
    if (email && !looksLikeEmail(email)) {
      rejected.push({ row: rowNumber, reason: `${code}: "${row.email}" is not a usable email address` });
      return;
    }
    if (email) {
      emailOwners.set(email, [...(emailOwners.get(email) || []), code]);
    }

    const fileName = tidyName(row.name || "");
    const target = byCode.get(code);

    if (!target) {
      // Carl's rule, 3 Sep 2026: a code that is not a rep must never become
      // one. Rejected with the reason, and with what to do about it, because
      // "rejected" on its own reads as a broken importer.
      if (rules) {
        const verdict = resolveRepCode(code, rules);
        if (!verdict.routable) {
          rejected.push({
            row: rowNumber,
            reason:
              `${code} is marked as not a rep` +
              (verdict.reason === "prefix" ? ` by the ${verdict.prefix}* rule` : "") +
              `, so no rep record was created. Change it on the Rep Codes page if that is wrong.`,
          });
          return;
        }
      }

      const rep: Rep = {
        id: crypto.randomUUID(),
        code: (row.code || "").trim(),
        name: fileName,
        email,
        cell: (row.cell || "").trim(),
        homeAddress: (row.homeAddress || "").trim(),
        homeGpsLat: "",
        homeGpsLng: "",
        teamId: "",
        workingHoursPerDay: row.workingHoursPerDay ?? 8.5,
      };
      reps.push(rep);
      byCode.set(code, rep);
      created.push({
        code: rep.code,
        name: rep.name,
        fields: [email ? `email: ${email}` : "no email"],
      });
      return;
    }

    const fields: string[] = [];

    if (email && email !== (target.email || "").trim().toLowerCase()) {
      fields.push(`email: ${target.email || "(blank)"} -> ${email}`);
      target.email = email;
    }
    if (row.cell !== undefined && row.cell.trim() && row.cell.trim() !== (target.cell || "")) {
      fields.push(`cell: ${target.cell || "(blank)"} -> ${row.cell.trim()}`);
      target.cell = row.cell.trim();
    }
    if (
      row.homeAddress !== undefined &&
      row.homeAddress.trim() &&
      row.homeAddress.trim() !== (target.homeAddress || "")
    ) {
      // Same rule as PUT /api/reps: coordinates derived from the old address
      // must not survive it, or the rep's week anchors on where they used to live.
      fields.push(`home address: ${target.homeAddress || "(blank)"} -> ${row.homeAddress.trim()}`);
      target.homeAddress = row.homeAddress.trim();
      target.homeGpsLat = "";
      target.homeGpsLng = "";
    }
    if (
      row.workingHoursPerDay !== undefined &&
      Number.isFinite(row.workingHoursPerDay) &&
      row.workingHoursPerDay !== target.workingHoursPerDay
    ) {
      fields.push(`hours/day: ${target.workingHoursPerDay ?? 8.5} -> ${row.workingHoursPerDay}`);
      target.workingHoursPerDay = row.workingHoursPerDay;
    }

    if (fileName && fileName.toUpperCase() !== (target.name || "").trim().toUpperCase()) {
      nameDifferences.push({ code: target.code, current: target.name, inFile: fileName });
    }

    if (fields.length > 0) updated.push({ code: target.code, name: target.name, fields });
    else unchanged++;
  });

  for (const [email, codes] of emailOwners) {
    if (codes.length > 1) {
      warnings.push(
        `${email} is on ${codes.length} reps (${codes.join(", ")}). Only one of them can ever have a login, ` +
          `because a login is keyed on the email address.`
      );
    }
  }

  return { created, updated, unchanged, rejected, warnings, nameDifferences, columnsPresent, reps };
}

/**
 * Header spellings this importer understands, lowercased and stripped of
 * everything that is not a letter. Both the app's own export headers and the
 * client's own column names are listed, so a file from either direction loads.
 */
const HEADER_ALIASES: Record<keyof RepImportRow, string[]> = {
  code: ["repcode", "code", "representativeid", "repid"],
  name: ["repname", "name", "representativename", "fullname"],
  email: ["repemailaddress", "email", "emailaddress", "repemail"],
  cell: ["cellnumber", "cell", "mobile", "phone", "contactnumber"],
  homeAddress: ["homeaddress", "address"],
  workingHoursPerDay: ["hoursday", "hoursperday", "workinghoursperday"],
};

const normaliseHeader = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

/**
 * Turn a raw sheet (array of arrays) into rows.
 *
 * It hunts for the header row rather than assuming row 1, because a positional
 * parser rejects perfectly good files that carry a title or a blank line above
 * the headers.
 */
export function parseRepSheet(rawRows: unknown[][]): {
  rows: RepImportRow[];
  headerRowIndex: number;
  headers: string[];
  error?: string;
} {
  let headerRowIndex = -1;
  let map: Partial<Record<keyof RepImportRow, number>> = {};

  for (let i = 0; i < Math.min(rawRows.length, 20); i++) {
    const cells = (rawRows[i] || []).map(normaliseHeader);
    const candidate: Partial<Record<keyof RepImportRow, number>> = {};
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [keyof RepImportRow, string[]][]) {
      const idx = cells.findIndex((c) => c && aliases.includes(c));
      if (idx !== -1 && candidate[field] === undefined) candidate[field] = idx;
    }
    if (candidate.code !== undefined) {
      headerRowIndex = i;
      map = candidate;
      break;
    }
  }

  const headers = headerRowIndex === -1 ? [] : (rawRows[headerRowIndex] || []).map((c) => String(c ?? ""));

  if (headerRowIndex === -1) {
    const firstRow = (rawRows[0] || []).map((c) => String(c ?? "")).join(", ");
    return {
      rows: [],
      headerRowIndex,
      headers,
      error: `No rep code column found. Expected a column called REPCODE or "Rep Code". The first row of the file reads: ${firstRow || "(empty)"}`,
    };
  }

  const cell = (row: unknown[], idx?: number) =>
    idx === undefined ? undefined : String(row[idx] ?? "").trim();

  const rows: RepImportRow[] = [];
  for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
    const raw = rawRows[i] || [];
    if (raw.every((c) => String(c ?? "").trim() === "")) continue;

    const hours = cell(raw, map.workingHoursPerDay);
    rows.push({
      code: cell(raw, map.code) || "",
      name: cell(raw, map.name),
      email: cell(raw, map.email),
      cell: cell(raw, map.cell),
      homeAddress: cell(raw, map.homeAddress),
      workingHoursPerDay: hours ? Number(hours) : undefined,
    });
  }

  return { rows, headerRowIndex, headers };
}
