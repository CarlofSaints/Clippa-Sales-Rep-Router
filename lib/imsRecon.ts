import "server-only";
import { sqlQuery } from "./sqlProxy";
import { getStores } from "./data";
import { reconcile, norm, type ImsStore, type ReconResult } from "./imsReconCore";

/**
 * Fetches what the reconciliation needs and hands it to the pure logic in
 * `imsReconCore`. This file is the only part that touches SQL or the blob, which
 * is what lets the interesting half be asserted in `scripts/check-ims-recon.ts`.
 */

export * from "./imsReconCore";

interface ImsSale {
  "Place ID": string;
  SalesValue: number;
}

export async function buildReconciliation(monthsBack = 6): Promise<ReconResult> {
  // Three reads, run together. The six-month window alone cannot tell "dormant"
  // from "never sold", and neither window can say whether IMS has even heard of
  // the store — that is what the outlet master is for.
  const [salesRes, sales12Res, masterRes, stores] = await Promise.all([
    sqlQuery<ImsSale>("clippa_ims_place_sales", { monthsBack }),
    sqlQuery<ImsSale>("clippa_ims_place_sales", { monthsBack: 12 }),
    sqlQuery<ImsStore>("clippa_ims_store_master", {}),
    getStores(),
  ]);

  const sales = new Map<string, number>();
  for (const r of salesRes.data ?? []) sales.set(norm(r["Place ID"]), Number(r.SalesValue) || 0);

  const sales12 = new Set<string>();
  for (const r of sales12Res.data ?? []) sales12.add(norm(r["Place ID"]));

  const master = new Map<string, ImsStore>();
  for (const r of masterRes.data ?? []) master.set(norm(r["Store Code"]), r);

  return reconcile(stores, sales, sales12, master, monthsBack);
}
