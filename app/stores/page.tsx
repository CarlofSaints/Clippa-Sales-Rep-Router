"use client";

import { Suspense, useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Store, Channel, Rep, Team, FREQUENCY_OPTIONS, FrequencyType, getFrequencyLabel, SA_PROVINCES } from "@/lib/types";
import { useSession } from "@/components/SessionProvider";
import StoreImportModal from "@/components/StoreImportModal";
import { useTableSort, useSortedRows, SortableTh } from "@/components/TableSort";
import { useColumnWidths } from "@/components/useColumnWidths";
import { FilterDropdown } from "@/components/FilterDropdown";
import { MAP_STATUS_LABEL, MAP_STATUS_HINT, FLAG_LABEL, type MapRow, type MapStatus, type MapFlags } from "@/lib/mapStatus";
import { rankStores, salesForRanking } from "@/lib/storeRanking";
import { storeStatus, closedReasonLabel } from "@/lib/closedStores";
import { canonicalRepCode } from "@/lib/allocationSource";
import type { SortValue } from "@/lib/tableSort";

const DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const WEEKS = ["", "Wk1", "Wk2", "Wk3", "Wk4", "Wk5"];

/**
 * South Africa's bounding box. Used only to WARN — a coordinate outside it is
 * still saved and still shown, it just gets flagged so a store sitting in the
 * ocean is visible in the grid instead of only on the map.
 */
const SA_BOUNDS = { latMin: -35.0, latMax: -22.0, lngMin: 16.0, lngMax: 33.0 };

/**
 * Active or closed, at a glance.
 *
 * 267 stores were shut by the IMS pass and this grid said nothing about any of
 * them: they rendered exactly like every other row while being excluded from
 * routes and capacity. A store a rep will never be sent to has to look
 * different from one they will.
 *
 * Declared at module level, never inside the page component, or every keystroke
 * in the grid would remount it.
 */
function StatusBadge({ store }: { store: Store }) {
  const closed = store.closed === true;
  if (!closed) {
    return (
      <span className="inline-block rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-800">
        Active
      </span>
    );
  }
  const why = closedReasonLabel(store);
  const when = store.closedAt ? new Date(store.closedAt).toLocaleDateString("en-ZA") : null;
  return (
    <span
      title={[why, when ? `Closed ${when}` : null, "Not in any call cycle"].filter(Boolean).join(" · ")}
      className="inline-block rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-700"
    >
      Closed
    </span>
  );
}

const MAP_STATUS_STYLE: Record<MapStatus, string> = {
  matched: "bg-green-100 text-green-800",
  matched_gaps: "bg-amber-100 text-amber-800",
  rr_only: "bg-purple-100 text-purple-800",
  ims_only: "bg-blue-100 text-blue-800",
  ims_only_no_rep: "bg-red-100 text-red-800",
};

/**
 * Where a store sits across the two systems, plus anything else true about it.
 *
 * Flags are separate chips rather than more statuses: a store can be matched,
 * silent, AND owned by a different rep in IMS, and folding those into one label
 * would need a word for every combination.
 */
function MapStatusCell({ row }: { row?: MapRow }) {
  if (!row) {
    return (
      <td className="px-3 py-2">
        <span className="text-gray-300" title="No IMS snapshot has been taken yet">&mdash;</span>
      </td>
    );
  }
  const flags = (Object.keys(row.flags) as (keyof MapFlags)[]).filter((k) => row.flags[k]);
  return (
    <td className="px-3 py-2 align-top">
      <span
        title={MAP_STATUS_HINT[row.status]}
        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${MAP_STATUS_STYLE[row.status]}`}
      >
        {MAP_STATUS_LABEL[row.status]}
      </span>
      {flags.length > 0 && (
        <span className="mt-0.5 block space-x-1">
          {flags.map((k) => (
            <span
              key={k}
              title={k === "duplicateAccount" && row.twinCode ? `Sales look like they go to ${row.twinCode}` : undefined}
              className="inline-block rounded bg-gray-100 px-1 text-[9px] text-gray-600"
            >
              {FLAG_LABEL[k]}
            </span>
          ))}
        </span>
      )}
    </td>
  );
}

/**
 * Who IMS thinks calls on this store, beside who the router says.
 *
 * The code is what IMS actually holds — `tblStores` has no rep name — so the
 * code is what is shown, with the router's name for it in the tooltip where the
 * two systems happen to use the same code.
 *
 * Always rendered, never omitted: a dash is a fact here, and it means one of
 * three different things, which is why each gets its own tooltip.
 */
function ImsRepCell({ row, repName }: { row?: MapRow; repName: (code: string) => string }) {
  const dash = (title: string) => (
    <td className="px-3 py-2">
      <span className="text-gray-300" title={title}>&mdash;</span>
    </td>
  );
  if (!row) return dash("No IMS snapshot has been taken yet");
  const code = (row.imsRepCode || "").trim();
  if (!code) {
    return dash(
      row.status === "rr_only"
        ? "IMS has no record of this store code at all"
        : "IMS holds this store but names no rep against it"
    );
  }
  const name = repName(code);
  const mismatch = row.flags.repMismatch;
  return (
    <td
      className={`px-3 py-2 font-mono truncate ${mismatch ? "text-amber-700 font-semibold" : "text-gray-500"}`}
      title={
        mismatch
          ? `IMS says ${code}${name ? ` (${name})` : ""} calls here. The router says someone else.`
          : name || `IMS rep code ${code}`
      }
    >
      {code}
      {mismatch && <span className="ml-1" aria-label="rep mismatch">&#9888;</span>}
    </td>
  );
}

/**
 * An outlet IMS invoices that has no store in the router.
 *
 * Read-only on purpose: there is nothing here to edit, because the row does not
 * exist in this app. It is shown so the grid can answer "what is Clippa selling
 * that nobody visits" without a second screen.
 */
function GhostRow({ row, repName }: { row: MapRow; repName: (code: string) => string }) {
  const money = (n: number | null) =>
    n === null ? "" : "R " + n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <tr className="bg-blue-50/30 text-gray-500 italic">
      <td className="px-3 py-2 font-mono">{row.placeId}</td>
      <td className="px-3 py-2 truncate" title={row.imsName || ""}>{row.imsName || "—"}</td>
      {/* A ghost has no store record here, so it has no open/closed status of
          its own. The cell still has to EXIST: every td below is positional,
          and a missing one shifts the whole row against the header. */}
      <td className="px-3 py-2">
        <span className="text-gray-300" title="Not in the router, so it has no status here">&mdash;</span>
      </td>
      <MapStatusCell row={row} />
      <td className="px-3 py-2 truncate">{row.imsChannel || "—"}</td>
      <td className="px-3 py-2 truncate">{row.imsProvince || "—"}</td>
      <td className="px-3 py-2">{"—"}</td>
      <td className="px-3 py-2">{"—"}</td>
      <td className="px-3 py-2">{"—"}</td>
      {/* No store in the router, so the router names nobody. The IMS code moves
          to its own column rather than posing as this app's rep. */}
      <td className="px-3 py-2">{"—"}</td>
      <ImsRepCell row={row} repName={repName} />
      <td className="px-3 py-2 text-right whitespace-nowrap truncate">{"—"}</td>
      <td className="px-3 py-2 text-right whitespace-nowrap truncate">{money(row.sixMonthSales)}</td>
      <td className="px-3 py-2 text-center">{"—"}</td>
      <td className="px-3 py-2 text-center">{"—"}</td>
      <td className="px-3 py-2 text-center">{"—"}</td>
      <td className="px-3 py-2">{"—"}</td>
      <td className="px-3 py-2 text-right">{"—"}</td>
      <td className="px-3 py-2">{"—"}</td>
      <td className="px-3 py-2">{"—"}</td>
      <td className="px-3 py-2 text-right text-[10px]">not in the router</td>
    </tr>
  );
}


type CoordCheck = { lat: number; lng: number; ok: boolean; problem: string };

/**
 * Coordinates are stored as free text (they arrive that way from the upload),
 * so this is the one place that decides whether a pair is usable.
 */
function checkCoords(rawLat: string | undefined, rawLng: string | undefined): CoordCheck {
  const latStr = (rawLat ?? "").trim();
  const lngStr = (rawLng ?? "").trim();
  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);

  if (!latStr || !lngStr)
    return { lat, lng, ok: false, problem: "No coordinates on this store" };
  if (Number.isNaN(lat) || Number.isNaN(lng))
    return { lat, lng, ok: false, problem: "Not a number — check for stray text or a comma decimal point" };
  if (lat === 0 && lng === 0)
    return { lat, lng, ok: false, problem: "0, 0 — this plots in the Atlantic Ocean off West Africa" };
  // SA latitude is negative and longitude positive; the reverse means the two
  // columns were transposed somewhere, which lands the pin in the Atlantic.
  if (lat >= SA_BOUNDS.lngMin && lat <= SA_BOUNDS.lngMax && lng >= SA_BOUNDS.latMin && lng <= SA_BOUNDS.latMax)
    return { lat, lng, ok: false, problem: "Latitude and longitude look swapped" };
  if (lat > 0)
    return { lat, lng, ok: false, problem: "Latitude is positive — South Africa is negative, the minus sign is missing" };
  if (lat < SA_BOUNDS.latMin || lat > SA_BOUNDS.latMax || lng < SA_BOUNDS.lngMin || lng > SA_BOUNDS.lngMax)
    return { lat, lng, ok: false, problem: "Outside South Africa" };

  return { lat, lng, ok: true, problem: "" };
}

/** Google Maps pin at an exact coordinate — not a name search, so what you see is what is stored. */
const googleMapsUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

/* ─── Multi-select checkbox dropdown with search ─── */
function StoresPageInner() {
  const { can } = useSession();
  const [stores, setStores] = useState<Store[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterChannels, setFilterChannels] = useState<Set<string>>(new Set());
  const [filterReps, setFilterReps] = useState<Set<string>>(new Set());
  const [filterTeamManagers, setFilterTeamManagers] = useState<Set<string>>(new Set());
  const [filterProvinces, setFilterProvinces] = useState<Set<string>>(new Set());
  const [filterRegions, setFilterRegions] = useState<Set<string>>(new Set());
  const [filterFrequencies, setFilterFrequencies] = useState<Set<string>>(new Set());
  // Empty means show both, matching every other filter here. Closed stores are
  // NOT hidden by default: they are excluded from routes, and a count that
  // silently disagrees with the one on the IMS page is worse than a longer grid.
  const [filterStatus, setFilterStatus] = useState<Set<string>>(new Set());
  const [onlyBadCoords, setOnlyBadCoords] = useState(false);
  const [imsMap, setImsMap] = useState<Record<string, MapRow>>({});
  const [ghosts, setGhosts] = useState<MapRow[]>([]);
  // Two controls, not one, because they combine differently: a store has exactly
  // one status but any number of flags, so folding them together would make
  // "Matched" and "Rep mismatch" look like alternatives when they are both true
  // of the same row.
  const [filterMapStatus, setFilterMapStatus] = useState<Set<string>>(new Set());
  const [filterMapFlags, setFilterMapFlags] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Store>>({});
  const [saving, setSaving] = useState(false);
  const [regionList, setRegionList] = useState<{ id: string; name: string }[]>([]);
  const [exporting, setExporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const load = () => {
    Promise.all([
      fetch("/api/stores").then((r) => r.json()).catch(() => []),
      fetch("/api/channels").then((r) => r.json()).catch(() => []),
      fetch("/api/reps").then((r) => r.json()).catch(() => []),
      fetch("/api/regions").then((r) => r.json()).catch(() => []),
      fetch("/api/teams").then((r) => r.json()).catch(() => []),
    ]).then(([st, ch, rp, reg, tm]) => {
      setStores(Array.isArray(st) ? st : []);
      setChannels(Array.isArray(ch) ? ch : []);
      setReps(Array.isArray(rp) ? rp : []);
      setRegionList(Array.isArray(reg) ? reg : []);
      setTeams(Array.isArray(tm) ? tm : []);
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, []);

  // Ranks are driven by the rolling six-month IMS figure. A store with no figure
  // is UNRANKED rather than ranked as though it had sold zero.
  const rankings = useMemo(() => rankStores(stores), [stores]);

  const channelMap = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);
  const repMap = useMemo(() => new Map(reps.map((r) => [r.code, r])), [reps]);

  /**
   * A rep's name from a code, for IMS codes.
   *
   * Case-and-space insensitive, and the CMR suffix is stripped, because IMS
   * carries a parallel spelling of the same person (CPT007 / CPT007CMR) — the
   * same allowance `sameRep` makes when deciding whether the two systems
   * actually disagree. Returns "" when the code belongs to nobody here, which
   * is common: an IMS rep need not exist in the router at all.
   */
  const repNameForCode = useMemo(() => {
    const byCode = new Map<string, string>();
    for (const r of reps) {
      const c = (r.code || "").trim().toUpperCase();
      if (c) byCode.set(c, r.name);
    }
    return (code: string) => {
      const c = (code || "").trim().toUpperCase();
      return byCode.get(c) || byCode.get(c.replace(/CMR$/, "")) || "";
    };
  }, [reps]);

  // Filter options
  const channelOptions = useMemo(
    () => channels.map((c) => ({ value: c.id, label: c.name })),
    [channels]
  );
  const repOptions = useMemo(
    () => reps.map((r) => ({ value: r.code, label: `${r.name} (${r.code})` })),
    [reps]
  );
  const provinceOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of stores) {
      if (s.province?.trim()) set.add(s.province.trim());
    }
    return [
      { value: "__none__", label: "No Province" },
      ...Array.from(set).sort().map((p) => ({ value: p, label: p })),
    ];
  }, [stores]);
  const regionFilterOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of stores) {
      if (s.region?.trim()) set.add(s.region.trim());
    }
    return [
      { value: "__none__", label: "No Region" },
      ...Array.from(set).sort().map((r) => ({ value: r, label: r })),
    ];
  }, [stores]);
  const frequencyOptions = useMemo(
    () => FREQUENCY_OPTIONS.map((f) => ({ value: f.value, label: f.label })),
    []
  );
  const teamManagerOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [
      { value: "__unassigned__", label: "No Team" },
    ];
    for (const t of teams) {
      opts.push({ value: t.id, label: `${t.managerName} (${t.name})` });
    }
    return opts;
  }, [teams]);

  // Map repCode → teamId for filtering
  const repTeamMap = useMemo(() => new Map(reps.map((r) => [r.code, r.teamId])), [reps]);


  /** The store's row in the IMS snapshot, or undefined if there is no snapshot. */
  const rowFor = useCallback(
    (s: Store) => imsMap[String(s.placeId || s.id).trim().toUpperCase()],
    [imsMap]
  );

  /**
   * Both dropdowns carry live counts, because the useful question is almost
   * always "how many" and reading it off the option saves filtering to find out.
   *
   * Statuses cover the ghost rows too, so the filter means the same thing
   * whether or not IMS-only outlets are being shown.
   */
  const mapStatusOptions = useMemo(() => {
    const counts = new Map<string, number>();
    const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
    for (const r of Object.values(imsMap)) bump(r.status);
    for (const g of ghosts) bump(g.status);
    return (Object.keys(MAP_STATUS_LABEL) as MapStatus[])
      .filter((k) => counts.has(k))
      .map((k) => ({ value: k, label: `${MAP_STATUS_LABEL[k]} (${(counts.get(k) ?? 0).toLocaleString("en-ZA")})` }));
  }, [imsMap, ghosts]);

  const mapFlagOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of Object.values(imsMap)) {
      for (const k of Object.keys(r.flags) as (keyof MapFlags)[]) {
        if (r.flags[k]) counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
    return (Object.keys(FLAG_LABEL) as (keyof MapFlags)[])
      .filter((k) => counts.has(k))
      .map((k) => ({ value: k, label: `${FLAG_LABEL[k]} (${(counts.get(k) ?? 0).toLocaleString("en-ZA")})` }));
  }, [imsMap]);

  const filtered = useMemo(() => {
    return stores.filter((s) => {
      if (search && !s.name.toLowerCase().includes(search.toLowerCase()) && !s.placeId.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterChannels.size > 0 && !filterChannels.has(s.channelId)) return false;
      if (filterReps.size > 0 && !filterReps.has(s.repCode)) return false;
      if (filterTeamManagers.size > 0) {
        const teamId = repTeamMap.get(s.repCode) || "";
        if (!teamId && !filterTeamManagers.has("__unassigned__")) return false;
        if (teamId && !filterTeamManagers.has(teamId)) return false;
      }
      if (filterProvinces.size > 0) {
        const prov = s.province?.trim() || "";
        if (!prov && !filterProvinces.has("__none__")) return false;
        if (prov && !filterProvinces.has(prov)) return false;
      }
      if (filterRegions.size > 0) {
        const reg = s.region?.trim() || "";
        if (!reg && !filterRegions.has("__none__")) return false;
        if (reg && !filterRegions.has(reg)) return false;
      }
      if (filterFrequencies.size > 0 && !filterFrequencies.has(s.frequency)) return false;
      if (filterStatus.size > 0 && !filterStatus.has(storeStatus(s))) return false;
      if (onlyBadCoords && checkCoords(s.gpsLat, s.gpsLng).ok) return false;
      if (filterMapStatus.size > 0 || filterMapFlags.size > 0) {
        const row = rowFor(s);
        // No snapshot means no status and no flags, which is not the same as a
        // store that has been looked at and found clean. It cannot satisfy
        // either filter, so it drops out rather than being counted as a match.
        if (!row) return false;
        if (filterMapStatus.size > 0 && !filterMapStatus.has(row.status)) return false;
        // Any one of the chosen flags is enough; a row carrying several still
        // appears once.
        if (filterMapFlags.size > 0) {
          const hit = Array.from(filterMapFlags).some((k) => row.flags[k as keyof MapFlags]);
          if (!hit) return false;
        }
      }
      return true;
    });
  }, [stores, search, filterChannels, filterReps, filterTeamManagers, filterProvinces, filterRegions, filterFrequencies, filterStatus, onlyBadCoords, filterMapStatus, filterMapFlags, rowFor, repTeamMap]);

  const cols = useColumnWidths("stores-grid-widths");

  // The IMS map is a cached snapshot, not a live query: building it costs three
  // SQL round trips and this is the busiest page in the app.
  const [imsFetchedAt, setImsFetchedAt] = useState<string | null>(null);
  const [showGhosts, setShowGhosts] = useState(false);

  useEffect(() => {
    // Deliberately not awaited with the store load. The grid is useful without
    // it, and this must never be what keeps the page blank.
    fetch("/api/ims/snapshot", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.built) return;
        setImsMap(d.rows || {});
        setGhosts(d.ghosts || []);
        setImsFetchedAt(d.fetchedAt || null);
      })
      .catch(() => {
        // No snapshot, or it could not be read. Map Status simply stays blank.
      });
  }, []);

  // Defaults chosen so the money columns fit "R 4 211 993,85" on ONE line.
  const COLUMNS: { key: string; label: string; w: number; align?: "left" | "right" | "center" }[] = [
    { key: "placeId", label: "Place ID", w: 90 },
    { key: "name", label: "Store Name", w: 210 },
    { key: "status", label: "Status", w: 90 },
    { key: "mapStatus", label: "Map Status", w: 150 },
    { key: "channel", label: "Channel", w: 130 },
    { key: "province", label: "Province", w: 110 },
    { key: "region", label: "Region", w: 110 },
    { key: "gpsLat", label: "Latitude", w: 100 },
    { key: "gpsLng", label: "Longitude", w: 100 },
    { key: "rep", label: "RR Rep", w: 130 },
    { key: "imsRep", label: "IMS Rep", w: 110 },
    { key: "monthlySales", label: "Avg Monthly Sales", w: 130, align: "right" },
    { key: "sixMonthSales", label: "6-Month Sales", w: 130, align: "right" },
    { key: "rankOverall", label: "Rank Overall", w: 90, align: "center" },
    { key: "rankRep", label: "Rank/Rep", w: 80, align: "center" },
    { key: "rankChannel", label: "Rank/Channel", w: 95, align: "center" },
    { key: "frequency", label: "Frequency", w: 110 },
    { key: "duration", label: "Duration", w: 80, align: "right" },
    { key: "dayOfWeek", label: "Day", w: 90 },
    { key: "weekNumber", label: "Week", w: 70 },
    { key: "actions", label: "Actions", w: 150, align: "right" },
  ];

  const sort = useTableSort("name", "asc", [
    "monthlySales", "sixMonthSales", "duration",
  ]);

  // Sorting a rank means sorting by the sales behind it, so an unranked store
  // sinks instead of landing at position 1 with a blank cell.
  const sortAccessors = useMemo<Record<string, (s: Store) => SortValue>>(() => ({
    placeId: (s) => s.placeId,
    name: (s) => s.name,
    // Closed sorts before active, so the shut ones gather at one end of the
    // grid rather than being hunted for a row at a time.
    status: (s) => storeStatus(s),
    // Sorts by status, so every "In IMS only" row groups together.
    mapStatus: (s) => imsMap[String(s.placeId || s.id).trim().toUpperCase()]?.status ?? null,
    channel: (s) => channelMap.get(s.channelId)?.name || s.channelId,
    province: (s) => s.province || null,
    region: (s) => s.region || null,
    gpsLat: (s) => (s.gpsLat?.trim() ? Number(s.gpsLat) : null),
    gpsLng: (s) => (s.gpsLng?.trim() ? Number(s.gpsLng) : null),
    rep: (s) => repMap.get(s.repCode)?.name || s.repCode,
    // The raw IMS code, so the mismatched rows group together under one owner.
    imsRep: (s) => imsMap[String(s.placeId || s.id).trim().toUpperCase()]?.imsRepCode || null,
    monthlySales: (s) => s.monthlySales ?? null,
    sixMonthSales: (s) => s.sixMonthSales ?? null,
    rankOverall: (s) => salesForRanking(s),
    rankRep: (s) => salesForRanking(s),
    rankChannel: (s) => salesForRanking(s),
    frequency: (s) => getFrequencyLabel(s.frequency),
    duration: (s) => s.duration ?? null,
    dayOfWeek: (s) => (s.dayOfWeek ? DAYS.indexOf(s.dayOfWeek) : null),
    weekNumber: (s) => s.weekNumber || null,
  }), [channelMap, repMap, imsMap]);

  const sorted = useSortedRows(filtered, sortAccessors, sort);

  /**
   * How many IMS-only outlets the current filters leave, regardless of whether
   * the toggle is on. The label needs this BEFORE anyone ticks the box, so
   * "Show 2 IMS-only outlets" is what invites the click.
   */
  const ghostsMatchingFilters = useMemo(() => {
    let rows = ghosts;
    if (filterReps.size > 0) {
      const wanted = new Set([...filterReps].map(canonicalRepCode));
      rows = rows.filter((g) => wanted.has(canonicalRepCode(g.imsRepCode)));
    }
    if (filterProvinces.size > 0) {
      rows = rows.filter((g) => {
        const p = (g.imsProvince || "").trim();
        return p ? filterProvinces.has(p) : filterProvinces.has("__none__");
      });
    }
    return rows;
  }, [ghosts, filterReps, filterProvinces]);
  /**
   * Which IMS-only outlets to show.
   *
   * 🔴 These used to follow the search box and nothing else, on the grounds
   * that "province, channel and rep all filter on fields these rows do not
   * have in this app". That was wrong for two of the three: a ghost carries
   * `imsRepCode` and `imsProvince`, and the rep code is exactly what Rep Sales
   * & Activity already uses to count them per rep. So the page could tell you
   * 2 524 outlets are unrouted but not WHICH TWO belong to a given rep, which
   * made the number impossible to act on.
   *
   * Channel genuinely is excluded: the filter matches this app's channel IDs
   * and a ghost carries the client's channel NAME, which is a different set.
   */
  const visibleGhosts = useMemo(() => {
    if (!showGhosts) return [];
    const q = search.trim().toUpperCase();
    let rows = q
      ? ghosts.filter((g) => g.placeId.includes(q) || (g.imsName || "").toUpperCase().includes(q))
      : ghosts;

    // The rep filter holds this app's codes; a ghost holds the IMS one. They
    // are the same person through canonicalRepCode, which is what strips the
    // parallel CMR spelling (GAU012 / GAU012CMR).
    if (filterReps.size > 0) {
      const wanted = new Set([...filterReps].map(canonicalRepCode));
      rows = rows.filter((g) => wanted.has(canonicalRepCode(g.imsRepCode)));
    }
    if (filterProvinces.size > 0) {
      rows = rows.filter((g) => {
        const p = (g.imsProvince || "").trim();
        // Same rule the store rows use: blank is its own bucket, not a match.
        return p ? filterProvinces.has(p) : filterProvinces.has("__none__");
      });
    }
    // Map Status is the one filter that DOES apply to a ghost, because the two
    // IMS-only statuses are the whole reason these rows exist. A flag filter
    // hides them all: nothing in the router flags a row that is not in it.
    if (filterMapStatus.size > 0) rows = rows.filter((g) => filterMapStatus.has(g.status));
    if (filterMapFlags.size > 0) rows = [];
    return [...rows].sort((a, b) => (b.sixMonthSales ?? 0) - (a.sixMonthSales ?? 0));
  }, [ghosts, showGhosts, search, filterReps, filterProvinces, filterMapStatus, filterMapFlags]);

  /**
   * Arrive already filtered.
   *
   * Rep Sales & Activity can say a rep has 2 unrouted outlets but not WHICH
   * two; this is the other half of that. `?rep=CODE&ghosts=1` lands here with
   * the rep ticked and the IMS-only rows already showing.
   *
   * Runs once, on mount. Re-applying it whenever the params changed would fight
   * the user every time they touched a filter afterwards.
   */
  const searchParams = useSearchParams();
  useEffect(() => {
    const rep = searchParams.get("rep");
    if (rep) setFilterReps(new Set([rep]));

    // 🔴 `unrouted=1` must show ONLY the unrouted outlets. Turning the ghost
    // rows on is not enough on its own: the rep's routed stores stay in the
    // grid, so arriving from a link that said "2 unrouted" landed on a page
    // showing 14 rows, and the two that were asked for sat at the bottom.
    //
    // The Map Status filter is what separates them, and it already works on
    // both kinds of row: a store that IS in the router carries matched /
    // matched_gaps / rr_only, never an IMS-only status, so filtering to the
    // two IMS-only statuses empties the store rows and leaves the ghosts.
    if (searchParams.get("unrouted") === "1") {
      setShowGhosts(true);
      setFilterMapStatus(new Set(["ims_only", "ims_only_no_rep"]));
    } else if (searchParams.get("ghosts") === "1") {
      // Kept for a link that wants the ghosts BESIDE the routed stores.
      setShowGhosts(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const badCoordCount = useMemo(
    () => stores.filter((s) => !checkCoords(s.gpsLat, s.gpsLng).ok).length,
    [stores]
  );

  // Counted over EVERY store, not the filtered set, so the chip tells the truth
  // about the base rather than about the current view.
  const statusCounts = useMemo(() => ({
    active: stores.filter((s) => s.closed !== true).length,
    closed: stores.filter((s) => s.closed === true).length,
  }), [stores]);

  const hasFilters = !!search || filterChannels.size > 0 || filterReps.size > 0 || filterTeamManagers.size > 0 || filterProvinces.size > 0 || filterRegions.size > 0 || filterFrequencies.size > 0 || filterStatus.size > 0 || onlyBadCoords || filterMapStatus.size > 0 || filterMapFlags.size > 0;

  const clearAllFilters = () => {
    setSearch("");
    setFilterChannels(new Set());
    setFilterReps(new Set());
    setFilterTeamManagers(new Set());
    setFilterProvinces(new Set());
    setFilterRegions(new Set());
    setFilterFrequencies(new Set());
    setFilterStatus(new Set());
    setOnlyBadCoords(false);
    setFilterMapStatus(new Set());
    setFilterMapFlags(new Set());
  };

  /**
   * The filters in force, in words. A filtered file that does not say it is
   * filtered is how someone concludes there are only 99 stores in the business.
   */
  const activeFilters = useMemo(() => {
    const out: string[] = [];
    if (search.trim()) out.push(`Search: "${search.trim()}"`);
    const named = (ids: Set<string>, lookup: (id: string) => string) =>
      Array.from(ids).map(lookup).join(", ");
    if (filterChannels.size)
      out.push(`Channels: ${named(filterChannels, (id) => channelMap.get(id)?.name || id)}`);
    if (filterReps.size)
      out.push(`Reps: ${named(filterReps, (c) => repMap.get(c)?.name || c)}`);
    if (filterTeamManagers.size)
      out.push(
        `Team Manager: ${named(filterTeamManagers, (id) =>
          id === "__unassigned__" ? "No Team" : teams.find((t) => t.id === id)?.managerName || id
        )}`
      );
    if (filterProvinces.size)
      out.push(`Provinces: ${named(filterProvinces, (p) => (p === "__none__" ? "No Province" : p))}`);
    if (filterRegions.size)
      out.push(`Regions: ${named(filterRegions, (r) => (r === "__none__" ? "No Region" : r))}`);
    if (filterFrequencies.size)
      out.push(`Frequency: ${named(filterFrequencies, (f) => getFrequencyLabel(f as FrequencyType))}`);
    if (filterStatus.size)
      out.push(`Status: ${named(filterStatus, (k) => (k === "closed" ? "Closed" : "Active"))}`);
    if (onlyBadCoords) out.push("GPS problems only");
    if (filterMapStatus.size)
      out.push(`Map Status: ${named(filterMapStatus, (k) => MAP_STATUS_LABEL[k as MapStatus] || k)}`);
    if (filterMapFlags.size)
      out.push(`IMS Flags: ${named(filterMapFlags, (k) => FLAG_LABEL[k as keyof MapFlags] || k)}`);
    return out;
  }, [search, filterChannels, filterReps, filterTeamManagers, filterProvinces, filterRegions, filterFrequencies, filterStatus, onlyBadCoords, filterMapStatus, filterMapFlags, channelMap, repMap, teams]);

  /**
   * Export what is on screen.
   *
   * Built in the browser rather than by an API route so the file is exactly the
   * filtered grid the user is looking at. A server route would have to
   * re-implement all eight filters, and the moment the two drifted the file
   * would stop matching the page it came from.
   *
   * MONTHLY SALES and the three rank columns are deliberately NOT in this file
   * even though the grid shows them. This export exists to be edited and sent
   * back through Import Stores, which does not read sales — so a sales figure
   * in the file would be a number someone could change with no effect, and the
   * ranks are derived from it anyway. Sales stay a screen-only column.
   *
   * xlsx is imported on click so it stays out of this page's initial bundle.
   */
  const exportExcel = async () => {
    setExporting(true);
    try {
      const { utils, write } = await import("xlsx");

      const header = [
        "PLACE ID",
        "PLACE NAME",
        "CHANNEL",
        "PROVINCE",
        "REGION",
        "GPS LATITUDE",
        "GPS LONGITUDE",
        "GPS PROBLEM",
        "REPRESENTATIVE ID",
        "REPRESENTATIVE NAME",
        "TEAM",
        "FREQUENCY",
        "DURATION (MIN)",
        "DAY",
        "WEEK",
      ];

      const rows: (string | number)[][] = [header];

      for (const s of filtered) {
        const rep = repMap.get(s.repCode);
        const coords = checkCoords(s.gpsLat, s.gpsLng);
        const team = rep?.teamId ? teams.find((t) => t.id === rep.teamId) : undefined;
        rows.push([
          s.placeId || "",
          s.name || "",
          channelMap.get(s.channelId)?.name || s.channelId || "",
          s.province?.trim() || "",
          s.region?.trim() || "",
          s.gpsLat?.trim() || "",
          s.gpsLng?.trim() || "",
          // The reason a coordinate is unusable, in the same words the grid
          // shows on hover. Blank means the pin is fine — this column is the
          // whole point of exporting the GPS problems filter.
          coords.ok ? "" : coords.problem,
          s.repCode || "",
          rep?.name || "",
          team?.name || "",
          getFrequencyLabel(s.frequency),
          s.duration ?? 0,
          s.dayOfWeek || "",
          s.weekNumber || "",
        ]);
      }

      const ws = utils.aoa_to_sheet(rows);
      ws["!cols"] = [
        { wch: 14 }, { wch: 34 }, { wch: 20 }, { wch: 16 }, { wch: 18 },
        { wch: 14 }, { wch: 14 }, { wch: 46 }, { wch: 14 }, { wch: 24 },
        { wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 8 },
      ];
      // Freeze the header so 6 000 rows stay readable.
      ws["!freeze"] = { xSplit: "0", ySplit: "1" };
      ws["!autofilter"] = { ref: utils.encode_range({ s: { c: 0, r: 0 }, e: { c: header.length - 1, r: rows.length - 1 } }) };

      const notes: (string | number)[][] = [
        ["Stores export"],
        ["Generated", new Date().toLocaleString("en-ZA")],
        ["Rows in this file", filtered.length],
        ["Stores in the system", stores.length],
        [],
        ["Filters applied"],
        ...(activeFilters.length
          ? activeFilters.map((f) => ["", f])
          : [["", "None — this is every store."]]),
        [],
        ["Sending this file back"],
        ["", "Import Stores on the Stores page reads PLACE ID, PLACE NAME, CHANNEL, PROVINCE, REGION, GPS LATITUDE and GPS LONGITUDE — store details only. It never reads a rep or team column, so those can be wrong, or deleted entirely, without any effect. Correcting GPS LATITUDE and GPS LONGITUDE and importing is the bulk way to fix the stores listed under GPS PROBLEM."],
        ["", "It updates existing stores only, matched on PLACE ID, and it will not create a channel — a channel name that matches nothing is reported and that store keeps the channel it has. Rows whose PLACE ID is not already in the system are listed back, not created."],
        ["", "A column you DELETE from this file is left untouched on every store. A column you keep but leave BLANK clears that field, which is how a wrong coordinate is removed in bulk."],
        ["", "It does NOT read FREQUENCY, DURATION, DAY or WEEK — those come from the Channels page or from editing a store, and a change made in this file will not come back in."],
        ["", "MONTHLY SALES is deliberately not in this file. The import does not read it, so a figure here would be one nobody could change from this file — it stays a screen-only column on the Stores page."],
        ["", "Store Upload (under Admin) is the other door: use it to ADD stores, or to load rep allocations and monthly sales. It writes the rep and sales columns, so only send it a file where those are correct."],
      ];
      const notesWs = utils.aoa_to_sheet(notes);
      notesWs["!cols"] = [{ wch: 22 }, { wch: 110 }];

      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, "Stores");
      utils.book_append_sheet(wb, notesWs, "Notes");

      const buf = write(wb, { type: "array", bookType: "xlsx" });
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Stores${activeFilters.length ? "_filtered" : ""}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const startEdit = (store: Store) => {
    setEditing(store.id);
    setEditData({
      repCode: store.repCode,
      channelId: store.channelId,
      frequency: store.frequency,
      duration: store.duration,
      dayOfWeek: store.dayOfWeek,
      weekNumber: store.weekNumber,
      province: store.province || "",
      gpsLat: store.gpsLat || "",
      gpsLng: store.gpsLng || "",
      region: store.region || "",
      // Seeded from the record, never defaulted to open. A form that starts on
      // "Active" for a closed store reopens it the moment anything else on the
      // row is saved.
      closed: store.closed === true,
    });
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    await fetch("/api/stores", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...editData }),
    });
    setEditing(null);
    setEditData({});
    setSaving(false);
    load();
  };

  // Non-breaking space: with a plain one the "R" wraps onto its own line the
  // moment the column is a little narrow.
  const fmt = (n: number) =>
    "R\u00A0" + (n ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-clippa-red border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Stores</h1>
          <p className="text-sm text-gray-500">
            {filtered.length} of {stores.length} stores
            {ghosts.length > 0 && (
              <label className="ml-3 inline-flex items-center gap-1.5 text-xs font-normal text-gray-500">
                <input
                  type="checkbox"
                  checked={showGhosts}
                  onChange={(e) => setShowGhosts(e.target.checked)}
                  className="rounded border-gray-300"
                />
                {/* Counts what the CURRENT filters leave, not the whole set. A
                    label reading 2 524 beside a grid showing two is how somebody
                    concludes the filter is broken. */}
                Show{" "}
                {(filterReps.size > 0 || filterProvinces.size > 0
                  ? ghostsMatchingFilters.length
                  : ghosts.length
                ).toLocaleString("en-ZA")}{" "}
                IMS-only outlet{(filterReps.size > 0 || filterProvinces.size > 0 ? ghostsMatchingFilters.length : ghosts.length) === 1 ? "" : "s"}
              </label>
            )}
            {imsFetchedAt && (
              <span className="ml-3 text-xs font-normal text-gray-400">
                IMS snapshot {new Date(imsFetchedAt).toLocaleString("en-ZA")}
              </span>
            )}
            {cols.customised && (
              <button
                onClick={cols.reset}
                className="ml-3 text-xs text-gray-400 underline hover:text-gray-600"
              >
                Reset column widths
              </button>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {can("export_data") && (
            <button
              onClick={exportExcel}
              disabled={exporting || filtered.length === 0}
              title={
                activeFilters.length
                  ? "Downloads the filtered list you are looking at — the filters are listed on the Notes sheet"
                  : "Downloads every store"
              }
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {exporting
                ? "Building..."
                : `Export Excel (${filtered.length.toLocaleString("en-ZA")}${activeFilters.length ? " filtered" : ""})`}
            </button>
          )}
          {/* The return leg of the export. Deliberately not a link to Store
              Upload: that page loads reps and sales too, and a file without
              those columns going through it unassigns the rep and zeroes the
              monthly average on every store it touches. */}
          {can("upload_stores") && (
            <button
              onClick={() => setImportOpen(true)}
              title="Send the exported file back after fixing GPS coordinates or store details. Reps, teams and sales are not touched."
              className="px-4 py-2 bg-clippa-red hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Import Excel
            </button>
          )}
        </div>
      </div>

      {importOpen && (
        <StoreImportModal onClose={() => setImportOpen(false)} onImported={load} />
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search store name or ID..."
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-1 focus:ring-clippa-red"
        />
        <FilterDropdown
          label="Channels"
          options={channelOptions}
          selected={filterChannels}
          onChange={setFilterChannels}
        />
        <FilterDropdown
          label="Reps"
          options={repOptions}
          selected={filterReps}
          onChange={setFilterReps}
        />
        <FilterDropdown
          label="Team Manager"
          options={teamManagerOptions}
          selected={filterTeamManagers}
          onChange={setFilterTeamManagers}
        />
        <FilterDropdown
          label="Provinces"
          options={provinceOptions}
          selected={filterProvinces}
          onChange={setFilterProvinces}
        />
        <FilterDropdown
          label="Regions"
          options={regionFilterOptions}
          selected={filterRegions}
          onChange={setFilterRegions}
        />
        <FilterDropdown
          label="Frequency"
          options={frequencyOptions}
          selected={filterFrequencies}
          onChange={setFilterFrequencies}
        />
        {/* Only offered once a snapshot exists. Without one every option would
            read zero and select nothing, which looks broken rather than empty. */}
        {mapStatusOptions.length > 0 && (
          <FilterDropdown
            label="Map Status"
            options={mapStatusOptions}
            selected={filterMapStatus}
            onChange={setFilterMapStatus}
          />
        )}
        {mapFlagOptions.length > 0 && (
          <FilterDropdown
            label="IMS Flags"
            options={mapFlagOptions}
            selected={filterMapFlags}
            onChange={setFilterMapFlags}
          />
        )}
        <FilterDropdown
          label="Status"
          options={[
            { value: "active", label: `Active (${statusCounts.active})` },
            { value: "closed", label: `Closed (${statusCounts.closed})` },
          ]}
          selected={filterStatus}
          onChange={setFilterStatus}
        />
        <button
          onClick={() => setOnlyBadCoords((prev) => !prev)}
          title="Blank, unparseable, swapped, or outside South Africa"
          className={`flex items-center gap-1.5 border rounded-lg px-3 py-2 text-sm ${
            onlyBadCoords
              ? "border-amber-500 bg-amber-50 text-amber-800 font-medium"
              : "border-gray-200 text-gray-700 hover:bg-gray-50"
          }`}
        >
          GPS problems
          <span
            className={`inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full text-[10px] font-bold ${
              badCoordCount > 0 ? "bg-amber-500 text-white" : "bg-gray-200 text-gray-500"
            }`}
          >
            {badCoordCount}
          </span>
        </button>
        {hasFilters && (
          <button
            onClick={clearAllFilters}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Stat Cards */}
      {(() => {
        const uniqueRegions = new Set(filtered.map((s) => (s.region || "").trim()).filter(Boolean));
        const uniqueProvinces = new Set(filtered.map((s) => (s.province || "").trim()).filter(Boolean));
        const uniqueReps = new Set(filtered.map((s) => (s.repCode || "").trim()).filter(Boolean));
        const closedShown = filtered.filter((s) => s.closed === true).length;
        const cards = [
          { label: "Stores", value: filtered.length, color: "text-gray-900" },
          // Shown, never silently subtracted. A count on this page that quietly
          // disagreed with the one on the IMS page is how somebody concludes the
          // store base has shrunk.
          { label: "Closed", value: closedShown, color: closedShown > 0 ? "text-gray-500" : "text-gray-300" },
          { label: "Reps", value: uniqueReps.size, color: "text-green-600" },
          { label: "Regions", value: uniqueRegions.size, color: "text-blue-600" },
          { label: "Provinces", value: uniqueProvinces.size, color: "text-purple-600" },
        ];
        return (
          <div className="grid grid-cols-5 gap-4 mb-4">
            {cards.map((c) => (
              <div key={c.label} className="bg-white rounded-xl shadow-sm border border-gray-100 px-4 py-3">
                <p className="text-xs text-gray-500 uppercase tracking-wider">{c.label}</p>
                <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {/* The header is sticky against THIS container, so it needs its own
            scroll and a bounded height — otherwise the page scrolls instead and
            the header leaves with it. */}
        <div className="overflow-auto max-h-[calc(100vh-22rem)]">
          <table className="w-full table-fixed text-xs" style={{ minWidth: COLUMNS.reduce((t, c) => t + cols.width(c.key, c.w), 0) }}>
            <colgroup>
              {COLUMNS.map((c) => (
                <col key={c.key} style={{ width: cols.width(c.key, c.w) }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr className="bg-gray-50 text-left text-[10px] text-gray-500 uppercase tracking-wider shadow-[inset_0_-1px_0_0_rgb(229,231,235)]">
                {COLUMNS.map((c) => (
                  <SortableTh
                    key={c.key}
                    sortId={c.key === "actions" ? undefined : c.key}
                    sort={sort}
                    align={c.align}
                    onResize={cols.startResize(c.key, c.w)}
                    className="px-3 py-2 bg-gray-50"
                  >
                    {c.label}
                  </SortableTh>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sorted.map((store) => {
                const isEditing = editing === store.id;
                const coords = checkCoords(store.gpsLat, store.gpsLng);
                // While editing, check-on-map follows what has been TYPED, not
                // what is saved — that is the point of it, to test a correction
                // before committing it.
                const editCoords = isEditing
                  ? checkCoords(editData.gpsLat, editData.gpsLng)
                  : coords;
                const shown = isEditing ? editCoords : coords;
                const mappable = !Number.isNaN(shown.lat) && !Number.isNaN(shown.lng);
                const ch = channelMap.get(store.channelId);
                const rep = repMap.get(store.repCode);
                const imsRow = imsMap[String(store.placeId || store.id).trim().toUpperCase()];
                return (
                  <tr key={store.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-gray-500">{store.placeId}</td>
                    <td className="px-3 py-2 font-medium text-gray-900 max-w-[200px] truncate" title={store.name}>
                      {store.name}
                    </td>
                    {/* Active or closed. In the common part of the row, not
                        duplicated into both branches, so there is one place to
                        get it right. */}
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <select
                          value={editData.closed ? "closed" : "active"}
                          onChange={(e) => setEditData({ ...editData, closed: e.target.value === "closed" })}
                          className="border border-gray-200 rounded px-1 py-0.5 text-xs w-full"
                        >
                          <option value="active">Active</option>
                          <option value="closed">Closed</option>
                        </select>
                      ) : (
                        <StatusBadge store={store} />
                      )}
                    </td>
                    <MapStatusCell row={imsRow} />

                    {isEditing ? (
                      <>
                        <td className="px-3 py-2">
                          <select
                            value={editData.channelId || ""}
                            onChange={(e) => setEditData({ ...editData, channelId: e.target.value })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-full"
                          >
                            {channels.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={editData.province || ""}
                            onChange={(e) => setEditData({ ...editData, province: e.target.value })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-full"
                          >
                            <option value="">—</option>
                            {SA_PROVINCES.map((p) => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={editData.region || ""}
                            onChange={(e) => setEditData({ ...editData, region: e.target.value })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-full"
                          >
                            <option value="">—</option>
                            {regionList.map((r) => (
                              <option key={r.id} value={r.name}>{r.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={editData.gpsLat ?? ""}
                            onChange={(e) => setEditData({ ...editData, gpsLat: e.target.value })}
                            placeholder="-26.0597"
                            className={`border rounded px-1 py-0.5 text-xs w-24 font-mono ${
                              editCoords.ok ? "border-gray-200" : "border-amber-400 bg-amber-50"
                            }`}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={editData.gpsLng ?? ""}
                            onChange={(e) => setEditData({ ...editData, gpsLng: e.target.value })}
                            placeholder="28.0920"
                            className={`border rounded px-1 py-0.5 text-xs w-24 font-mono ${
                              editCoords.ok ? "border-gray-200" : "border-amber-400 bg-amber-50"
                            }`}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={editData.repCode || ""}
                            onChange={(e) => setEditData({ ...editData, repCode: e.target.value })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-full"
                          >
                            {reps.map((r) => (
                              <option key={r.code} value={r.code}>{r.name}</option>
                            ))}
                          </select>
                        </td>
                        {/* Read-only while editing: IMS is the client's system, nothing here writes to it. */}
                        <ImsRepCell row={imsRow} repName={repNameForCode} />
                        <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap truncate">{fmt(store.monthlySales)}</td>
                        {/* Absent means never supplied, which is a different thing from zero. */}
                        <td className="px-3 py-2 text-right text-gray-500 whitespace-nowrap truncate">
                          {store.sixMonthSales == null ? <span className="text-gray-300">—</span> : fmt(store.sixMonthSales)}
                        </td>
                        <td className="px-3 py-2 text-center text-gray-400">{rankings.overallRank.get(store.id) ?? "—"}</td>
                        <td className="px-3 py-2 text-center text-gray-400">{rankings.repRank.get(store.id) ?? "—"}</td>
                        <td className="px-3 py-2 text-center text-gray-400">{rankings.channelRank.get(store.id) ?? "—"}</td>
                        <td className="px-3 py-2">
                          <select
                            value={editData.frequency || "monthly"}
                            onChange={(e) => setEditData({ ...editData, frequency: e.target.value as FrequencyType })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-full"
                          >
                            {FREQUENCY_OPTIONS.map((f) => (
                              <option key={f.value} value={f.value}>{f.label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={editData.duration ?? 30}
                            onChange={(e) => setEditData({ ...editData, duration: Number(e.target.value) })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-14 text-right"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={editData.dayOfWeek || ""}
                            onChange={(e) => setEditData({ ...editData, dayOfWeek: e.target.value })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-full"
                          >
                            {DAYS.map((d) => (
                              <option key={d} value={d}>{d || "\u2014"}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={editData.weekNumber || ""}
                            onChange={(e) => setEditData({ ...editData, weekNumber: e.target.value })}
                            className="border border-gray-200 rounded px-1 py-0.5 text-xs w-full"
                          >
                            {WEEKS.map((w) => (
                              <option key={w} value={w}>{w || "\u2014"}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                          {mappable ? (
                            <a
                              href={googleMapsUrl(shown.lat, shown.lng)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open these coordinates in Google Maps (unsaved edits included)"
                              className="text-blue-600 hover:text-blue-800 font-medium"
                            >
                              Check on Map
                            </a>
                          ) : (
                            <span className="text-gray-300" title={shown.problem}>Check on Map</span>
                          )}
                          <button onClick={() => saveEdit(store.id)} disabled={saving} className="text-green-600 hover:text-green-800 font-medium">
                            Save
                          </button>
                          <button onClick={() => { setEditing(null); setEditData({}); }} className="text-gray-400 hover:text-gray-600 font-medium">
                            Cancel
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-gray-600">{ch?.name || store.channelId}</td>
                        <td className="px-3 py-2 text-gray-500">{store.province || "\u2014"}</td>
                        <td className="px-3 py-2 text-gray-500">{store.region || "\u2014"}</td>
                        <td
                          className={`px-3 py-2 font-mono ${coords.ok ? "text-gray-500" : "text-amber-700 font-semibold"}`}
                          title={coords.ok ? "" : coords.problem}
                        >
                          {store.gpsLat?.trim() || "—"}
                          {!coords.ok && <span className="ml-1" aria-label="coordinate problem">⚠</span>}
                        </td>
                        <td
                          className={`px-3 py-2 font-mono ${coords.ok ? "text-gray-500" : "text-amber-700 font-semibold"}`}
                          title={coords.ok ? "" : coords.problem}
                        >
                          {store.gpsLng?.trim() || "—"}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{rep?.name || store.repCode}</td>
                        <ImsRepCell row={imsRow} repName={repNameForCode} />
                        <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap truncate">{fmt(store.monthlySales)}</td>
                        {/* Absent means never supplied, which is a different thing from zero. */}
                        <td className="px-3 py-2 text-right text-gray-500 whitespace-nowrap truncate">
                          {store.sixMonthSales == null ? <span className="text-gray-300">—</span> : fmt(store.sixMonthSales)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {rankings.overallRank.has(store.id) ? (
                            <span className="inline-flex items-center justify-center w-7 h-5 rounded bg-blue-50 text-blue-700 font-medium">
                              {rankings.overallRank.get(store.id)}
                            </span>
                          ) : (
                            <span className="text-gray-300" title="No sales figure, so this store is not ranked">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {rankings.repRank.has(store.id) ? (
                            <span className="inline-flex items-center justify-center w-7 h-5 rounded bg-green-50 text-green-700 font-medium">
                              {rankings.repRank.get(store.id)}
                            </span>
                          ) : (
                            <span className="text-gray-300" title="No sales figure, so this store is not ranked">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {rankings.channelRank.has(store.id) ? (
                            <span className="inline-flex items-center justify-center w-7 h-5 rounded bg-purple-50 text-purple-700 font-medium">
                              {rankings.channelRank.get(store.id)}
                            </span>
                          ) : (
                            <span className="text-gray-300" title="No sales figure, so this store is not ranked">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{getFrequencyLabel(store.frequency)}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{store.duration}m</td>
                        <td className="px-3 py-2 text-gray-500">{store.dayOfWeek || "\u2014"}</td>
                        <td className="px-3 py-2 text-gray-500">{store.weekNumber || "\u2014"}</td>
                        <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                          {mappable ? (
                            <a
                              href={googleMapsUrl(coords.lat, coords.lng)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`Open ${coords.lat}, ${coords.lng} in Google Maps`}
                              className="text-blue-600 hover:text-blue-800 font-medium"
                            >
                              Check on Map
                            </a>
                          ) : (
                            <span className="text-gray-300" title={coords.problem}>Check on Map</span>
                          )}
                          <button onClick={() => startEdit(store)} className="text-clippa-red hover:text-red-800 font-medium">
                            Edit
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
              {showGhosts &&
                visibleGhosts.map((g) => (
                  <GhostRow key={"ghost-" + g.placeId} row={g} repName={repNameForCode} />
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * useSearchParams needs a Suspense boundary in the app router, the same shape
 * the Map page uses.
 */
export default function StoresPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin w-8 h-8 border-2 border-clippa-red border-t-transparent rounded-full" />
        </div>
      }
    >
      <StoresPageInner />
    </Suspense>
  );
}
