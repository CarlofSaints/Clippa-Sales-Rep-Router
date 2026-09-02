/**
 * Build the workbook of IMS questions for the client, from LIVE data.
 *
 *   npx tsx scripts/ims-questions-pack.ts [output-directory]
 *
 * Three things nobody here can decide alone:
 *
 *   1. The IMS rep codes this app has no rep record for. A store behind such a
 *      code is dropped from the map, from every call cycle and from capacity,
 *      silently, so the allocation refuses to move it and asks instead.
 *   2. Which of those codes are suffixed spellings of reps we already have.
 *   3. The shops IMS flags as closed that are still buying stock.
 *
 * Read-only: it never writes to the blob. It reads the blobs directly rather
 * than through lib/data, for the reason data-health-snapshot.ts gives.
 *
 * It calls the SAME planImsAllocation and planClosures the pages call, so the
 * counts in the workbook are the counts on screen.
 *
 * The sales column is labelled with the window the SNAPSHOT was actually built
 * over, never an assumed six months. The two came apart once already, and a
 * mislabelled rand figure in a client's inbox is not a mistake you get to
 * correct quietly.
 */

import fs from "fs";
import path from "path";
import XLSX from "xlsx";
import { get } from "@vercel/blob";
import { planImsAllocation, type AllocationSettings } from "../lib/allocationSource";
import { planClosures, type ClosedReason } from "../lib/closedStores";
import type { Rep, Store } from "../lib/types";
import type { MapRow } from "../lib/mapStatus";

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

interface ImsMapBlob {
  fetchedAt: string;
  monthsBack: number;
  rows: Record<string, MapRow>;
}

const REASON_LABEL: Record<ClosedReason, string> = {
  ims_accc: "IMS rep code ACCC (closed account)",
  ims_flag: "IMS Closed Status flag",
  manual: "Closed by hand in the router",
};

const IMS_SETTINGS: AllocationSettings = {
  source: "ims",
  allowUnknownReps: false,
  updatedAt: null,
  updatedBy: null,
};

const norm = (v: unknown) => String(v ?? "").trim().toUpperCase();

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("No BLOB_READ_WRITE_TOKEN in .env.local");
    process.exit(1);
  }

  const [reps, stores, map] = await Promise.all([
    readBlob<Rep[]>("reps", []),
    readBlob<Store[]>("stores", []),
    readBlob<ImsMapBlob | null>("ims-map", null),
  ]);

  if (reps.length === 0 || stores.length === 0) {
    console.error("Live read came back empty. Refusing to report on nothing.");
    process.exit(1);
  }
  if (!map?.rows) {
    console.error("No IMS snapshot has been built. Press Refresh snapshot on /admin/ims first.");
    process.exit(1);
  }

  const plan = planImsAllocation(stores, reps, map.rows, IMS_SETTINGS);
  const closures = planClosures(stores, map.rows, { includeImsFlag: true });

  const months = map.monthsBack;
  const windowLabel = months + (months === 1 ? " month" : " months");
  const SALES = "IMS sales, last " + windowLabel + " (R)";
  const asAt = map.fetchedAt.slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  const byId = new Map(stores.map((s) => [s.id, s]));
  const rowFor = (s: Store | undefined) => (s ? map.rows[norm(s.placeId || s.id)] : undefined);

  // One row per IMS rep code we have no person for.
  const codeRows = plan.unknownCodes.map((u) => {
    const held = plan.held.filter((h) => h.to === u.code);
    const provinces = new Set<string>();
    let stillOpen = 0;
    for (const h of held) {
      const store = byId.get(h.storeId);
      if (store && !store.closed) stillOpen++;
      const p = rowFor(store)?.imsProvince;
      if (p) provinces.add(String(p));
    }
    return {
      "IMS rep code": u.code,
      "Stores behind it": u.stores,
      "Of those, still open": stillOpen,
      [SALES]: Math.round(held.reduce((n, h) => n + (h.sixMonthSales ?? 0), 0)),
      Provinces: [...provinces].sort().join(", "),
      "Example stores": held.slice(0, 3).map((h) => h.storeName).join(" | "),
      "Is this a person? (Y/N)": "",
      "If yes, full name": "",
      "If no, what is it?": "",
    };
  });

  // Every store held behind one of those codes.
  const heldRows = plan.held
    .slice()
    .sort((a, b) => a.to.localeCompare(b.to) || (b.sixMonthSales ?? 0) - (a.sixMonthSales ?? 0))
    .map((h) => {
      const store = byId.get(h.storeId);
      const row = rowFor(store);
      return {
        "IMS rep code": h.to,
        "Place ID": h.placeId,
        "Store name": h.storeName,
        "Rep in the router today": h.from || "(none)",
        "IMS province": row?.imsProvince ?? "",
        "IMS channel": row?.imsChannel ?? "",
        [SALES]: Math.round(h.sixMonthSales ?? 0),
        "IMS says closed": row?.flags?.closedInIms ? "Yes" : "No",
        "Closed in the router": store?.closed ? "Yes" : "No",
      };
    });

  // Shut, and still buying.
  const closedRows = closures.closedButSelling.map((c) => ({
    "Place ID": c.placeId,
    "Store name": c.name,
    Rep: c.repCode || "(none)",
    "IMS province": rowFor(byId.get(c.storeId))?.imsProvince ?? "",
    [SALES]: Math.round(c.sixMonthSales ?? 0),
    "Why we closed it": REASON_LABEL[c.reason] ?? c.reason,
    "Still trading? (Y/N)": "",
    Comment: "",
  }));

  const readme: (string | number)[][] = [
    ["Clippa Sales Rep Router: questions for IMS"],
    [""],
    ["Date", today],
    ["IMS data as at", asAt],
    ["Sales window in this file", windowLabel + " rolling"],
    [""],
    ["Store base in the router", stores.length],
    ["Of those, marked closed", stores.filter((s) => s.closed).length],
    ["Reps in the router", reps.length],
    ["Stores held back by the questions below", plan.held.length],
    [""],
    ["What we need back"],
    ["1", "Sheet '2. Codes to identify' lists the rep codes IMS uses that we have no person for."],
    ["", "For each one: is it a person, or a branch, house or holding account?"],
    ["", "If it is a person, their full name, so we can add them and hand them their stores."],
    ["2", "Some of those codes look like suffixed spellings of reps we already have."],
    ["", "Please confirm whether they are the same person as the code without the suffix."],
    ["3", "Sheet '4. Closed but selling' lists shops IMS flags as closed that still bought stock"],
    ["", "inside the window above. Please confirm whether each one is genuinely shut."],
    [""],
    ["Why it matters"],
    ["", "A store sitting on a rep code with no person behind it disappears from the map,"],
    ["", "from every call cycle and from the capacity figures. Nobody is sent to it."],
  ];

  const wb = XLSX.utils.book_new();
  const addSheet = (name: string, rows: Record<string, unknown>[]) => {
    const ws = XLSX.utils.json_to_sheet(rows);
    const keys = Object.keys(rows[0] ?? {});
    ws["!cols"] = keys.map((k) => ({
      wch: Math.min(Math.max(k.length + 2, ...rows.map((r) => String(r[k] ?? "").length + 2)), 46),
    }));
    if (ws["!ref"]) ws["!autofilter"] = { ref: ws["!ref"] };
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  const readmeWs = XLSX.utils.aoa_to_sheet(readme);
  readmeWs["!cols"] = [{ wch: 34 }, { wch: 96 }];
  XLSX.utils.book_append_sheet(wb, readmeWs, "1. Read me");
  addSheet("2. Codes to identify", codeRows);
  addSheet("3. Held-back stores", heldRows);
  addSheet("4. Closed but selling", closedRows);

  const outDir = process.argv[2] || process.cwd();
  const out = path.join(outDir, "Clippa - questions for IMS " + today + ".xlsx");
  XLSX.writeFile(wb, out);

  console.log("Written: " + out);
  console.log("  IMS snapshot      : " + map.fetchedAt + " over " + windowLabel);
  console.log("  Codes to identify : " + codeRows.length);
  console.log("  Held-back stores  : " + heldRows.length);
  console.log("  Closed but selling: " + closedRows.length);
  if (months !== 6) {
    console.log(
      "  NOTE: the snapshot covers " + windowLabel + ", not six. Every rand figure in the workbook is that window."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
