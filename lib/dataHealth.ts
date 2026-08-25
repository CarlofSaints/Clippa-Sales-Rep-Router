import { Channel, Rep, Store, StoreOverride } from "./types";
import { computeOutliers } from "./outliers";
import { buildDuplicateGroups } from "./duplicates";
import { overriddenStoreIds } from "./channelDefaults";

/**
 * Every way this data can be wrong, in one place.
 *
 * The checks themselves already existed, scattered across four pages: coverage
 * on one, GPS behind a filter on another, outliers on a third, duplicates on a
 * fourth. Two of them had no export at all. Answering "what is wrong with our
 * data" therefore meant visiting four screens and stitching three files
 * together, which in practice means nobody asks.
 *
 * Every check returns the SAME shape, so the page renders them generically and
 * the export writes one sheet per check without knowing what any of them mean.
 * Adding a check is adding one function to CHECKS and nothing else.
 */

export type Severity = "blocking" | "warning" | "info";

export interface HealthIssue {
  /** Stable id, used as the sheet name and the React key. */
  id: string;
  title: string;
  severity: Severity;
  count: number;
  /** What it means, in a sentence. */
  summary: string;
  /** What to actually do about it. */
  action: string;
  columns: string[];
  rows: (string | number)[][];
}

export interface DataHealthReport {
  checkedAt: string;
  totals: {
    stores: number;
    reps: number;
    channels: number;
    /** Checks that found something. */
    issueTypes: number;
    blocking: number;
    /** Distinct stores touched by at least one BLOCKING check. */
    storesBlocked: number;
  };
  issues: HealthIssue[];
}

export interface HealthInput {
  reps: Rep[];
  stores: Store[];
  channels: Channel[];
  overrides: StoreOverride[];
  outlierRadiusKm: number;
}

/** The same GPS rule the route engine uses, so the two can never disagree. */
export function gpsProblem(store: Store): "blank" | "zero" | "outside" | null {
  const rawLat = String(store.gpsLat ?? "").trim();
  const rawLng = String(store.gpsLng ?? "").trim();
  if (!rawLat || !rawLng) return "blank";
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "blank";
  if (lat === 0 && lng === 0) return "zero";
  // Roughly South Africa's bounding box.
  if (lat < -35 || lat > -21 || lng < 15 || lng > 34) return "outside";
  return null;
}

const code = (value: string | undefined) => (value || "").trim().toUpperCase();

/**
 * Severity means "can this store be planned", not "is this untidy".
 *
 * blocking — the record cannot appear in a route at all.
 * warning  — it will be planned, but probably wrongly.
 * info     — worth knowing, nothing is broken.
 */
function issue(
  id: string,
  title: string,
  severity: Severity,
  summary: string,
  action: string,
  columns: string[],
  rows: (string | number)[][]
): HealthIssue {
  return { id, title, severity, count: rows.length, summary, action, columns, rows };
}

export function buildDataHealthReport(input: HealthInput): DataHealthReport {
  const { reps, stores, channels, overrides, outlierRadiusKm } = input;

  const repByCode = new Map(reps.map((r) => [code(r.code), r]));
  const channelById = new Map(channels.map((c) => [c.id, c]));
  const channelName = (id: string) => channelById.get(id)?.name || id || "";
  const repName = (c: string) => repByCode.get(code(c))?.name || "";

  const storesByCode = new Map<string, Store[]>();
  for (const s of stores) {
    const c = code(s.repCode);
    if (!c) continue;
    storesByCode.set(c, [...(storesByCode.get(c) || []), s]);
  }

  const issues: HealthIssue[] = [];
  const blockedStoreIds = new Set<string>();

  // ── 1. Stores whose rep code names nobody ────────────────────────────
  {
    const rows: (string | number)[][] = [];
    for (const s of stores) {
      const c = code(s.repCode);
      if (!c || repByCode.has(c)) continue;
      blockedStoreIds.add(s.id);
      rows.push([s.repCode, s.placeId || s.id, s.name, channelName(s.channelId), s.province || "", s.gpsLat || "", s.gpsLng || ""]);
    }
    rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[2]).localeCompare(String(b[2])));
    issues.push(
      issue(
        "stores-unknown-rep",
        "Stores allocated to a rep who does not exist",
        "blocking",
        "The rep code on the store does not match any rep in the system, so nothing ties the store to a person. It is dropped from the map, every route and all capacity figures, silently.",
        "Add the missing reps on the Reps page (Import Excel), or correct the rep code on the stores. Then regenerate routes.",
        ["REP CODE", "PLACE ID", "PLACE NAME", "CHANNEL", "PROVINCE", "GPS LATITUDE", "GPS LONGITUDE"],
        rows
      )
    );
  }

  // ── 2. Stores with no rep code at all ────────────────────────────────
  {
    const rows: (string | number)[][] = [];
    for (const s of stores) {
      if (code(s.repCode)) continue;
      blockedStoreIds.add(s.id);
      rows.push([s.placeId || s.id, s.name, channelName(s.channelId), s.province || "", s.region || "", s.gpsLat || "", s.gpsLng || ""]);
    }
    issues.push(
      issue(
        "stores-no-rep",
        "Stores with no rep code",
        "blocking",
        "Nobody is allocated to these stores at all. Store allocation is what the whole call cycle is built from, so they can never be planned.",
        "Set a rep code on each, either in the Stores grid or through Store Upload.",
        ["PLACE ID", "PLACE NAME", "CHANNEL", "PROVINCE", "REGION", "GPS LATITUDE", "GPS LONGITUDE"],
        rows
      )
    );
  }

  // ── 3. GPS problems, split by kind: each needs a different fix ───────
  {
    const kinds: { key: "blank" | "zero" | "outside"; id: string; title: string; summary: string; action: string }[] = [
      {
        key: "blank",
        id: "stores-gps-blank",
        title: "Stores with no GPS coordinates",
        summary: "The store has no location, so it cannot be clustered into a day or ordered into a driving route.",
        action: "Export the Stores grid, fill in the coordinates, and import it back. Google Maps gives you them from the store name and suburb.",
      },
      {
        key: "zero",
        id: "stores-gps-zero",
        title: "Stores sitting at 0,0",
        summary: "0,0 is a placeholder, not a place. It is in the Gulf of Guinea, so any distance calculated from it is nonsense and it drags a rep's territory centre with it.",
        action: "Treat these as missing coordinates: clear them or replace them through the Stores export and import.",
      },
      {
        key: "outside",
        id: "stores-gps-outside",
        title: "Stores plotting outside South Africa",
        summary: "The coordinates are valid numbers but fall outside the country, which usually means a lost minus sign or a swapped latitude and longitude.",
        action: "Check for a missing minus on the latitude first, that is the common cause. Fix through the Stores export and import.",
      },
    ];

    for (const kind of kinds) {
      const rows: (string | number)[][] = [];
      for (const s of stores) {
        if (gpsProblem(s) !== kind.key) continue;
        blockedStoreIds.add(s.id);
        rows.push([s.repCode || "", repName(s.repCode), s.placeId || s.id, s.name, channelName(s.channelId), s.province || "", s.gpsLat || "", s.gpsLng || ""]);
      }
      rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[3]).localeCompare(String(b[3])));
      issues.push(
        issue(
          kind.id,
          kind.title,
          "blocking",
          kind.summary,
          kind.action,
          ["REP CODE", "REP NAME", "PLACE ID", "PLACE NAME", "CHANNEL", "PROVINCE", "GPS LATITUDE", "GPS LONGITUDE"],
          rows
        )
      );
    }
  }

  // ── 4. Reps nobody's stores name ─────────────────────────────────────
  {
    const rows: (string | number)[][] = [];
    for (const r of reps) {
      if (storesByCode.has(code(r.code))) continue;
      rows.push([r.code, r.name, r.email || "", r.cell || "", r.homeAddress || ""]);
    }
    rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    issues.push(
      issue(
        "reps-no-stores",
        "Reps with no stores",
        "warning",
        "The rep exists but not one store carries their code, so there is nothing to build a call cycle from. Usually the store allocations have not been updated, or their stores sit under a different code.",
        "Confirm with the client which stores belong to them. A manager who genuinely carries no territory can be ignored here.",
        ["REP CODE", "REP NAME", "EMAIL", "CELL", "HOME ADDRESS"],
        rows
      )
    );
  }

  // ── 5. Two reps, one inbox ───────────────────────────────────────────
  {
    const byEmail = new Map<string, Rep[]>();
    for (const r of reps) {
      const e = (r.email || "").trim().toLowerCase();
      if (!e) continue;
      byEmail.set(e, [...(byEmail.get(e) || []), r]);
    }
    const rows: (string | number)[][] = [];
    for (const [email, group] of byEmail) {
      if (group.length < 2) continue;
      for (const r of group) {
        rows.push([email, r.code, r.name, group.length, storesByCode.get(code(r.code))?.length ?? 0]);
      }
    }
    rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    issues.push(
      issue(
        "reps-shared-email",
        "Reps sharing an email address",
        "warning",
        "A login is keyed on the email address, so only one of these reps can ever have an account. The second attempt is refused and the person is left without a way in.",
        "Get a distinct address for each rep before creating logins.",
        ["EMAIL", "REP CODE", "REP NAME", "REPS SHARING IT", "STORES"],
        rows
      )
    );
  }

  // ── 6. Reps with no email at all ─────────────────────────────────────
  {
    const rows: (string | number)[][] = [];
    for (const r of reps) {
      const e = (r.email || "").trim();
      if (e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) continue;
      rows.push([r.code, r.name, e || "(blank)", storesByCode.get(code(r.code))?.length ?? 0]);
    }
    issues.push(
      issue(
        "reps-no-email",
        "Reps with no usable email address",
        "info",
        "There is nowhere to send a login or a route, so this rep cannot maintain their own home address.",
        "Collect the address from the client. Nothing else is affected: routes still plan normally.",
        ["REP CODE", "REP NAME", "EMAIL ON FILE", "STORES"],
        rows
      )
    );
  }

  // ── 7. A home address that never became coordinates ──────────────────
  {
    const rows: (string | number)[][] = [];
    for (const r of reps) {
      const address = (r.homeAddress || "").trim();
      const hasGps = !!(r.homeGpsLat || "").trim() && !!(r.homeGpsLng || "").trim();
      if (!address || hasGps) continue;
      rows.push([r.code, r.name, address, storesByCode.get(code(r.code))?.length ?? 0]);
    }
    issues.push(
      issue(
        "reps-address-no-gps",
        "Reps whose home address has no coordinates",
        "info",
        "Their day still starts from the middle of their stores rather than from home, which usually adds driving. An informal address often cannot be resolved precisely enough to trust.",
        'Use "Set Home GPS" on the Reps page, or have the rep tap "Use my current location" on their own profile, which is exact.',
        ["REP CODE", "REP NAME", "HOME ADDRESS", "STORES"],
        rows
      )
    );
  }

  // ── 8. Stores far outside their rep's patch ──────────────────────────
  {
    const outliers = computeOutliers(reps, stores, outlierRadiusKm);
    const rows = outliers.stores
      .slice()
      .sort((a, b) => b.distanceKm - a.distanceKm)
      .map((o) => [o.repCode, o.repName, o.storeId, o.storeName, channelName(o.channelId), Math.round(o.distanceKm * 10) / 10]);
    issues.push(
      issue(
        "stores-outliers",
        `Stores more than ${outlierRadiusKm} km from their rep's area`,
        "warning",
        "The store is a long way from the middle of that rep's territory. Sometimes it is a genuine outlying call, and sometimes the store is allocated to the wrong person or its coordinates are wrong.",
        'Confirm the genuine ones with "Confirm in cycle" on the Rep Capacity page so they stop being reported. Reallocate or fix the rest.',
        ["REP CODE", "REP NAME", "STORE ID", "STORE NAME", "CHANNEL", "DISTANCE (KM)"],
        rows
      )
    );
  }

  // ── 9. The same shop recorded more than once ─────────────────────────
  {
    const { groups } = buildDuplicateGroups(stores);
    const rows: (string | number)[][] = [];
    for (const g of groups) {
      for (const r of g.records) {
        rows.push([g.storeName, g.repCode, r.placeId, channelName(r.channelId), r.gpsLat || "", r.gpsLng || "", r.keep ? "KEEP" : "duplicate", g.records.length]);
      }
    }
    issues.push(
      issue(
        "stores-duplicates",
        "Duplicate store records",
        "warning",
        "The same shop appears more than once under one rep, so it is visited twice in a cycle and inflates every count, every capacity figure and the driving time.",
        "Use the Duplicate Stores page to collapse each group to the best record.",
        ["STORE NAME", "REP CODE", "PLACE ID", "CHANNEL", "GPS LATITUDE", "GPS LONGITUDE", "VERDICT", "IN GROUP"],
        rows
      )
    );
  }

  // ── 10. Stores with no channel, or a channel that does not exist ─────
  {
    const rows: (string | number)[][] = [];
    for (const s of stores) {
      const id = (s.channelId || "").trim();
      if (id && channelById.has(id)) continue;
      rows.push([s.repCode || "", s.placeId || s.id, s.name, id || "(blank)", s.frequency || "", s.duration ?? ""]);
    }
    issues.push(
      issue(
        "stores-no-channel",
        "Stores with a missing or unknown channel",
        "warning",
        "Call frequency and visit length come from the channel. Without one the store keeps whatever it was last given and stops following the rules everything else follows.",
        "Set the channel on the Stores page, then use Apply defaults to stores on the Channels page.",
        ["REP CODE", "PLACE ID", "PLACE NAME", "CHANNEL ON FILE", "FREQUENCY", "DURATION"],
        rows
      )
    );
  }

  // ── 11. Store rhythm that disagrees with its channel ─────────────────
  {
    const pinned = overriddenStoreIds(overrides);
    const rows: (string | number)[][] = [];
    for (const s of stores) {
      const ch = channelById.get((s.channelId || "").trim());
      if (!ch) continue; // already reported by check 10
      if (pinned.has(s.id)) continue; // deliberately pinned by a manager
      const freqDiffers = s.frequency !== ch.frequency;
      const durDiffers = Number(s.duration) !== Number(ch.duration);
      if (!freqDiffers && !durDiffers) continue;
      rows.push([
        s.repCode || "", s.placeId || s.id, s.name, ch.name,
        s.frequency || "", ch.frequency,
        s.duration ?? "", ch.duration,
      ]);
    }
    issues.push(
      issue(
        "stores-channel-mismatch",
        "Stores that disagree with their channel's defaults",
        "info",
        "The store's call frequency or visit length differs from its channel, and no approved override explains why. Often left over from before the channel rules changed.",
        'Use "Apply defaults to stores" on the Channels page to bring them back into line, or record a store override if the difference is deliberate.',
        ["REP CODE", "PLACE ID", "PLACE NAME", "CHANNEL", "STORE FREQUENCY", "CHANNEL FREQUENCY", "STORE MINUTES", "CHANNEL MINUTES"],
        rows
      )
    );
  }

  const found = issues.filter((i) => i.count > 0);

  return {
    checkedAt: new Date().toISOString(),
    totals: {
      stores: stores.length,
      reps: reps.length,
      channels: channels.length,
      issueTypes: found.length,
      blocking: found.filter((i) => i.severity === "blocking").reduce((a, i) => a + i.count, 0),
      storesBlocked: blockedStoreIds.size,
    },
    // Worst first, then biggest. A clean check still ships, so the page can show
    // what was looked at and found nothing — silence is not the same as a pass.
    issues: issues.sort((a, b) => {
      const rank = { blocking: 0, warning: 1, info: 2 } as const;
      return rank[a.severity] - rank[b.severity] || b.count - a.count;
    }),
  };
}
