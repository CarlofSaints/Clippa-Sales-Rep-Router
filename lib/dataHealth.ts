import { Channel, Rep, Store, StoreOverride, getMonthlyRate } from "./types";
import { computeOutliers } from "./outliers";
import { buildDuplicateGroups } from "./duplicates";
import { overriddenStoreIds } from "./channelDefaults";
import { activeStores } from "./closedStores";

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

/**
 * Working days in the cycle the route engine builds: 4 weeks of 5 days.
 * Matching the engine matters — a check that used a calendar month would
 * disagree with the plan it is meant to be describing.
 */
const DAY_SLOTS_PER_CYCLE = 20;
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
    /**
     * Closed stores, excluded from every check above.
     *
     * Shown rather than silently subtracted: "31 stores have no valid rep" and
     * "7 do, and 24 are shut" are different reports, and only one of them is
     * a list of work.
     */
    storesClosed: number;
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
  const { reps, stores: allStores, channels, overrides, outlierRadiusKm } = input;

  /**
   * Closed stores are excluded from every store check below.
   *
   * A shut shop is never routed, so a missing rep code or blank GPS on one is
   * not a problem to fix — it is a fact about a shop that no longer trades.
   * Counting them made the blocking list read as 31 stores needing attention
   * when 24 of them were deliberately closed and only 7 were real.
   *
   * Reported as its own count so the number is visible rather than silently
   * subtracted, which is its own kind of lie.
   */
  const stores = activeStores(allStores);
  const closedCount = allStores.length - stores.length;

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

  // ── A book that cannot fit the rep's hours ───────────────────────────
  //
  // 🔴 The check that would have found the Pretoria five without anyone going
  // looking. GAU053's stores ask for 743 visits a month against 20 working
  // days: 37 calls a day, and 659 hours of visit time against 170 available.
  // No amount of clustering or route optimisation fixes that, because nothing
  // here is a routing problem. The store FREQUENCIES are the problem, and they
  // are invisible on every other screen.
  //
  // Measured on visit time alone, with no travel at all. That is deliberate:
  // travel is an estimate and would make this arguable, whereas a rep whose
  // visits alone exceed their hours is impossible on arithmetic nobody can
  // dispute. Real days are worse than this says.
  {
    const rows: (string | number)[][] = [];
    for (const rep of reps) {
      const repCode = code(rep.code);
      if (!repCode) continue;
      const mine = stores.filter((s: Store) => code(s.repCode) === repCode);
      if (mine.length === 0) continue;

      let visits = 0;
      let minutes = 0;
      for (const s of mine) {
        const rate = getMonthlyRate(s.frequency || "monthly");
        visits += rate;
        minutes += rate * (s.duration || 0);
      }

      const hoursNeeded = minutes / 60;
      const hoursAvailable = (rep.workingHoursPerDay ?? 8.5) * DAY_SLOTS_PER_CYCLE;
      if (hoursNeeded <= hoursAvailable) continue;

      rows.push([
        rep.code,
        rep.name,
        mine.length,
        Math.round(visits),
        Math.round((visits / DAY_SLOTS_PER_CYCLE) * 10) / 10,
        Math.round(hoursNeeded),
        Math.round(hoursAvailable),
        `${Math.round((hoursNeeded / hoursAvailable) * 10) / 10}x`,
        // The frequencies driving it, so the fix is obvious from the row.
        mine.filter((s: Store) => getMonthlyRate(s.frequency || "monthly") >= 4).length,
      ]);
    }
    // Worst first: the ratio is what says how far from possible it is.
    rows.sort((a, b) => Number(b[5]) / Number(b[6]) - Number(a[5]) / Number(a[6]));

    issues.push(
      issue(
        "rep-book-exceeds-hours",
        "Reps whose call cycle cannot fit their hours",
        "blocking",
        "The stores allocated to this rep, at the frequencies those stores carry, need more visit time than the rep has in a four-week cycle. Travel is not even counted. Any route plan for them will schedule what fits and report the rest as overflow, which reads as a routing failure when it is really a workload one.",
        "Fix the FREQUENCIES, not the routes. Check whether those stores should genuinely be visited weekly: a channel default of weekly cascades onto every store in the channel, so one wrong channel can do this to a whole team at once. Reducing the frequency, or moving stores to another rep, are the only two things that change this number.",
        ["REP CODE", "REP NAME", "STORES", "VISITS / MONTH", "CALLS / DAY", "HOURS NEEDED", "HOURS AVAILABLE", "OVER BY", "STORES VISITED WEEKLY OR MORE"],
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
        "Stores whose call rhythm ignores their channel",
        "warning",
        "The store's call frequency or visit length differs from its channel, with no approved override to explain it. Routes and capacity are built from the STORE's values, so wherever these disagree the plan is not following the agreed call rules.",
        'Compare the totals before acting. "Apply defaults to stores" on the Channels page rewrites every store in one go, and if the channel rules were never applied in the first place that can multiply the planned workload several times over. Check it against what a rep can actually do in a month first.',
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
      storesClosed: closedCount,
    },
    // Worst first, then biggest. A clean check still ships, so the page can show
    // what was looked at and found nothing — silence is not the same as a pass.
    issues: issues.sort((a, b) => {
      const rank = { blocking: 0, warning: 1, info: 2 } as const;
      return rank[a.severity] - rank[b.severity] || b.count - a.count;
    }),
  };
}
