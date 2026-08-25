/**
 * Load a rep spreadsheet against LIVE data, using the same lib the upload button
 * uses.
 *
 * Dry run (default, writes nothing):
 *   npx tsx scripts/import-reps-from-file.ts "path/to/file.xlsx"
 * Apply:
 *   npx tsx scripts/import-reps-from-file.ts "path/to/file.xlsx" --apply
 *
 * It imports `lib/repImport` and `lib/data` directly rather than reimplementing
 * either, so a green run here is evidence about the code that actually ships —
 * a copy of the logic would only be evidence about the copy.
 *
 * ⚠️ This reads and writes PRODUCTION blob data. `--apply` backs the current rep
 * list up to ./backups first and prints where it went.
 *
 * 🔴 ORDER MATTERS AND IT BIT ONCE. `lib/data.ts` decides between the blob and
 * the local ./data directory with a MODULE-LEVEL const:
 *
 *     const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
 *
 * evaluated the instant the module is first imported. A static
 * `import { getReps } from "../lib/data"` therefore runs BEFORE any env loading
 * in main(), lands on useBlob = false, reads a ./data directory that does not
 * exist, and returns [] — which reads exactly like "the app has no reps yet".
 * Applying that would have written the spreadsheet over the live list and
 * destroyed every rep id, team link and zone assignment on it. So the env is
 * loaded at the top level and lib/data is pulled in with a DYNAMIC import
 * afterwards. Do not turn that back into a static import.
 */

import fs from "fs";
import path from "path";
import XLSX from "xlsx";
// Pure, no environment of its own — safe to import statically.
import { applyRepImport, parseRepSheet } from "../lib/repImport";

function loadEnv() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

// Top level, so it has run before the dynamic import below.
loadEnv();

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("No BLOB_READ_WRITE_TOKEN — this would read the local ./data dir, not live data.");
  process.exit(1);
}

async function main() {
  const { getReps, saveReps } = await import("../lib/data");

  const filePath = process.argv[2];
  const apply = process.argv.includes("--apply");
  const allowEmpty = process.argv.includes("--allow-empty");

  if (!filePath) {
    console.error('Usage: npx tsx scripts/import-reps-from-file.ts "<file.xlsx>" [--apply]');
    process.exit(1);
  }

  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames[0];
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
    header: 1,
    blankrows: false,
    defval: "",
  });

  const parsed = parseRepSheet(rawRows);
  if (parsed.error) {
    console.error(parsed.error);
    process.exit(1);
  }

  const existing = await getReps();

  // The safety net for the failure above. An empty read is indistinguishable from
  // a genuinely empty system, so it must never silently become a full overwrite.
  if (existing.length === 0 && !allowEmpty) {
    console.error(
      "\nREFUSING TO RUN: the live rep list came back EMPTY.\n" +
        "That is almost always a bad read (wrong env, blob unreachable), not an empty system,\n" +
        "and continuing would write this spreadsheet over whatever is really there.\n" +
        "If the system genuinely has no reps, re-run with --allow-empty.\n"
    );
    process.exit(1);
  }

  const result = applyRepImport(existing, parsed.rows);

  console.log(`\nFile      ${path.basename(filePath)}  (sheet "${sheetName}")`);
  console.log(`Rows read ${parsed.rows.length}`);
  console.log(`Columns   ${result.columnsPresent.join(", ") || "rep code only"}`);
  console.log(`Reps now  ${existing.length}  ->  ${result.reps.length}\n`);

  console.log(`CREATE   ${result.created.length}`);
  console.log(`UPDATE   ${result.updated.length}`);
  console.log(`SAME     ${result.unchanged}`);
  console.log(`REJECT   ${result.rejected.length}`);

  if (result.rejected.length) {
    console.log("\nRejected rows:");
    for (const r of result.rejected) console.log(`  row ${r.row}: ${r.reason}`);
  }
  if (result.warnings.length) {
    console.log("\nWarnings:");
    for (const w of result.warnings) console.log(`  ${w}`);
  }
  if (result.nameDifferences.length) {
    console.log(`\nName differences (reported, NOT applied) — ${result.nameDifferences.length}:`);
    for (const n of result.nameDifferences) {
      console.log(`  ${n.code.padEnd(9)} here "${n.current}"  |  file "${n.inFile}"`);
    }
  }
  if (result.updated.length) {
    console.log("\nUpdated:");
    for (const u of result.updated) console.log(`  ${u.code.padEnd(9)} ${u.name} — ${u.fields.join("; ")}`);
  }
  if (result.created.length) {
    console.log(`\nCreated (${result.created.length}):`);
    for (const c of result.created) console.log(`  ${c.code.padEnd(9)} ${c.name} — ${c.fields.join("; ")}`);
  }

  if (!apply) {
    console.log("\nDRY RUN — nothing was written. Re-run with --apply to save.\n");
    process.exit(0);
  }

  // Nobody's rep record should vanish because of an import. The importer has no
  // delete path, so this is a belt-and-braces check on the array about to be saved.
  const lostCodes = existing
    .map((r) => r.code)
    .filter((code) => !result.reps.some((r) => r.code === code));
  if (lostCodes.length > 0) {
    console.error(`\nREFUSING TO SAVE: these reps would disappear — ${lostCodes.join(", ")}\n`);
    process.exit(1);
  }

  const dir = path.join(process.cwd(), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `reps-before-import-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backup, JSON.stringify(existing, null, 2));
  console.log(`\nBackup written: ${backup}`);

  await saveReps(result.reps);

  // Read back from the blob rather than trusting the write.
  const after = await getReps();
  const withEmail = after.filter((r) => (r.email || "").trim()).length;
  console.log(`Saved. Reps in the blob now: ${after.length}, of which ${withEmail} have an email.\n`);

}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
