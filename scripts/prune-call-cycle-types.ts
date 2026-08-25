/**
 * Remove the Hybrid and Dynamic call cycle types from LIVE data.
 *
 *   npx tsx scripts/prune-call-cycle-types.ts            (dry run)
 *   npx tsx scripts/prune-call-cycle-types.ts --apply
 *
 * They were dropped from the code long ago: `CallCycleStrategy` is already just
 * "channel_dedicated" | "geography", and nothing in the app references either
 * name. But `getCallCycleTypes()` returns the SAVED blob as-is and never
 * reconciles it against the defaults, so the two dead rows survived every
 * deployment and kept appearing in the dropdowns on Routes and Map. Removing
 * them from code was never going to be enough; the rows have to be deleted.
 *
 * ⚠️ Hybrid is the ACTIVE type on live data, so removing it would leave nothing
 * active. Route generation copes (an unknown strategy falls through to "every
 * store allocated to the rep", which is Geography's behaviour anyway), but the
 * screens would show no selected type. Geography is therefore made active: it is
 * what the last real generation actually used.
 *
 * Saved route documents for the removed types are NOT deleted. They become
 * unreachable, which is the point, but throwing away someone's generated plan is
 * not this script's decision to make.
 */

import fs from "fs";
import path from "path";

function loadEnv() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
loadEnv();

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("No BLOB_READ_WRITE_TOKEN in .env.local");
  process.exit(1);
}

/** Strategies the app still understands. Anything else is dead. */
const KEEP = new Set(["channel_dedicated", "geography"]);
const PREFERRED_ACTIVE = "geography";

interface Row {
  id: string;
  name: string;
  strategy: string;
  active: boolean;
  description?: string;
}

async function main() {
  // Imported dynamically, AFTER loadEnv: lib/data decides blob-vs-local with a
  // module-level const evaluated at import time.
  const { getCallCycleTypes, saveCallCycleTypes } = await import("../lib/data");

  const before = (await getCallCycleTypes()) as unknown as Row[];
  const apply = process.argv.includes("--apply");

  if (before.length === 0) {
    console.error("No call cycle types came back. Refusing to write over an empty read.");
    process.exit(1);
  }

  console.log("\nBEFORE:");
  for (const t of before) {
    console.log(`  ${t.id.padEnd(16)} ${t.name.padEnd(20)} ${t.strategy.padEnd(18)} active=${t.active}`);
  }

  const kept = before.filter((t) => KEEP.has(t.strategy));
  const dropped = before.filter((t) => !KEEP.has(t.strategy));

  if (kept.length === 0) {
    console.error("\nEvery type would be removed. Refusing: that would leave nothing to generate with.");
    process.exit(1);
  }

  // Something has to be active, and it should be what was really being used.
  if (!kept.some((t) => t.active)) {
    const target = kept.find((t) => t.strategy === PREFERRED_ACTIVE) ?? kept[0];
    target.active = true;
    console.log(`\nNothing left active, so "${target.name}" is now the active type.`);
  }

  console.log("\nREMOVING:");
  if (dropped.length === 0) console.log("  nothing, already clean");
  for (const t of dropped) {
    console.log(`  ${t.id.padEnd(16)} ${t.name.padEnd(20)} ${t.strategy.padEnd(18)} active=${t.active}`);
  }

  console.log("\nAFTER:");
  for (const t of kept) {
    console.log(`  ${t.id.padEnd(16)} ${t.name.padEnd(20)} ${t.strategy.padEnd(18)} active=${t.active}`);
  }

  if (dropped.length > 0) {
    console.log(
      `\n⚠️ Saved route plans for the removed types are left in place and become unreachable:\n` +
        dropped.map((t) => `     routes-${t.id}.json`).join("\n")
    );
  }

  if (!apply) {
    console.log("\nDRY RUN. Nothing written. Re-run with --apply.\n");
    return;
  }

  const dir = path.join(process.cwd(), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `call-cycle-types-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backup, JSON.stringify(before, null, 2));
  console.log(`\nBackup written: ${backup}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await saveCallCycleTypes(kept as any);

  const after = (await getCallCycleTypes()) as unknown as Row[];
  console.log(`Saved. ${after.length} type(s) live, active: ${after.find((t) => t.active)?.name ?? "NONE"}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
