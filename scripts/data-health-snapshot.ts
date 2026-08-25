/**
 * Run the Data Health checks against LIVE data and write the workbook to disk.
 *
 *   npx tsx scripts/data-health-snapshot.ts [output-directory]
 *
 * Read-only: it never writes to the blob. It reads the blobs directly rather
 * than through lib/data, so it does not depend on the module-level `useBlob`
 * const that decides blob-vs-local at import time (see
 * scripts/import-reps-from-file.ts for what that cost once).
 *
 * It calls the SAME buildDataHealthReport the page and the export route call, so
 * what lands on disk is what the button produces.
 */

import fs from "fs";
import path from "path";
import XLSX from "xlsx";
import { get } from "@vercel/blob";
import { buildDataHealthReport } from "../lib/dataHealth";
import { Channel, Rep, Store, StoreOverride } from "../lib/types";

function loadEnv() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
loadEnv();

async function readBlob<T>(key: string, fallback: T): Promise<T> {
  const r = await get(`${key}.json`, { access: "private", useCache: false });
  if (!r) return fallback;
  const text = await new Response(r.stream).text();
  return text.trim() ? (JSON.parse(text) as T) : fallback;
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("No BLOB_READ_WRITE_TOKEN in .env.local");
    process.exit(1);
  }

  const [reps, stores, channels, overrides, settings] = await Promise.all([
    readBlob<Rep[]>("reps", []),
    readBlob<Store[]>("stores", []),
    readBlob<Channel[]>("channels", []),
    readBlob<StoreOverride[]>("store-overrides", []),
    readBlob<{ outlierRadiusKm?: number }>("settings", {}),
  ]);

  if (reps.length === 0 || stores.length === 0) {
    console.error("Live read came back empty. Refusing to report on nothing.");
    process.exit(1);
  }

  const report = buildDataHealthReport({
    reps,
    stores,
    channels,
    overrides,
    outlierRadiusKm: settings.outlierRadiusKm ?? 50,
  });

  const t = report.totals;
  console.log(`\n${t.stores.toLocaleString()} stores | ${t.reps} reps | ${t.channels} channels`);
  console.log(`${t.issueTypes} of ${report.issues.length} checks found something`);
  console.log(`${t.blocking.toLocaleString()} records cannot be planned at all`);
  console.log(`${t.storesBlocked.toLocaleString()} distinct stores blocked\n`);
  console.log("SEVERITY  COUNT   CHECK");
  for (const i of report.issues) {
    console.log(`${i.severity.padEnd(9)} ${String(i.count).padStart(5)}   ${i.title}`);
  }

  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  const names = new Map<string, string>();
  for (const i of report.issues) {
    let name = i.id.replace(/[:\\/?*[\]]/g, "-").slice(0, 31);
    let n = 2;
    while (used.has(name)) name = name.slice(0, 29) + `~${n++}`;
    used.add(name);
    names.set(i.id, name);
  }

  const contents: (string | number)[][] = [
    ["CLIPPA REP ROUTER - DATA HEALTH"],
    ["Generated", new Date().toISOString().slice(0, 16).replace("T", " ")],
    [],
    ["Stores", t.stores],
    ["Reps", t.reps],
    ["Channels", t.channels],
    ["Checks that found something", t.issueTypes],
    ["Records that cannot be planned at all", t.blocking],
    ["Distinct stores blocked", t.storesBlocked],
    [],
    ["CHECK", "SEVERITY", "FOUND", "SHEET", "WHAT IT MEANS"],
  ];
  for (const i of report.issues) {
    contents.push([
      i.title,
      i.severity,
      i.count,
      i.count > 0 ? names.get(i.id)! : "(nothing found)",
      i.count > 0 ? i.summary : "Checked. No records matched.",
    ]);
  }
  contents.push([], ["WHAT TO DO"]);
  for (const i of report.issues) if (i.count > 0) contents.push([i.title, "", "", "", i.action]);
  contents.push([], ["SEVERITY MEANS"]);
  contents.push(["blocking", "", "", "", "The record cannot appear in a route at all."]);
  contents.push(["warning", "", "", "", "It will be planned, but probably wrongly."]);
  contents.push(["info", "", "", "", "Worth knowing. Nothing is broken."]);

  const ws = XLSX.utils.aoa_to_sheet(contents);
  ws["!cols"] = [{ wch: 48 }, { wch: 11 }, { wch: 8 }, { wch: 26 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(wb, ws, "Contents");

  for (const i of report.issues) {
    if (i.count === 0) continue;
    const rows = [i.columns, ...i.rows];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = i.columns.map((c) => ({ wch: Math.min(Math.max(c.length + 3, 12), 46) }));
    sheet["!autofilter"] = {
      ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: i.columns.length - 1, r: rows.length - 1 } }),
    };
    XLSX.utils.book_append_sheet(wb, sheet, names.get(i.id)!);
  }

  const outDir = process.argv[2] || process.cwd();
  const out = path.join(outDir, `Clippa_Data_Health_${new Date().toISOString().slice(0, 10)}.xlsx`);
  XLSX.writeFile(wb, out);
  console.log(`\nWritten: ${out}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
