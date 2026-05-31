import { Store, Rep, Team, Channel, Visit, AdherenceMetrics, UserAdherence, AdherenceData, FrequencyType } from "./types";

// ---------- Constants ----------

const DAY_MAP: Record<string, number> = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sunday: 0,
};

// ---------- Date Helpers ----------

/**
 * Parse "Wk1", "Wk2" etc. to week numbers [1], [2], etc.
 * Also handles "Wk1&3" → [1, 3] or "Week 1&3" → [1, 3] for future flexibility.
 */
export function parseCycleWeeks(weekStr: string): number[] {
  if (!weekStr) return [];
  // Extract all digits after "Wk" or "Week" patterns, split by & or ,
  const cleaned = weekStr.replace(/[Ww](?:ee)?k\s*/g, "");
  const parts = cleaned.split(/[&,]/);
  const weeks: number[] = [];
  for (const p of parts) {
    const n = parseInt(p.trim(), 10);
    if (n >= 1 && n <= 5) weeks.push(n);
  }
  return weeks;
}

/**
 * Find the Nth occurrence of a weekday in a given month.
 * n is 1-based (1st Monday, 2nd Tuesday, etc.)
 * Returns null if the month doesn't have that many occurrences.
 */
export function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date | null {
  // month is 0-based (0 = January)
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0).getDate();

  // Find the first occurrence of the weekday
  let dayOfMonth = 1 + ((weekday - firstDay.getDay() + 7) % 7);

  // Advance to the Nth occurrence
  dayOfMonth += (n - 1) * 7;

  if (dayOfMonth > lastDay) return null;
  return new Date(year, month, dayOfMonth);
}

/**
 * Generate all expected visit dates for a store within a date range.
 * Based on frequency, dayOfWeek, and weekNumber.
 */
export function generateExpectedDates(
  frequency: FrequencyType,
  dayOfWeek: string,
  weekNumber: string,
  dateFrom: Date,
  dateTo: Date
): string[] {
  if (!dayOfWeek || !DAY_MAP.hasOwnProperty(dayOfWeek)) return [];

  const weekday = DAY_MAP[dayOfWeek];
  const weeks = parseCycleWeeks(weekNumber);
  const dates: string[] = [];

  // Cap dateTo at today to avoid penalizing for future visits
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const effectiveTo = dateTo > today ? today : dateTo;

  if (frequency === "weekly") {
    // Visit every week on the assigned day
    const current = new Date(dateFrom);
    // Move to first occurrence of the weekday
    const diff = (weekday - current.getDay() + 7) % 7;
    current.setDate(current.getDate() + diff);

    while (current <= effectiveTo) {
      dates.push(formatDate(current));
      current.setDate(current.getDate() + 7);
    }
  } else if (frequency === "3x_monthly") {
    // Weeks 1, 2, 3 of each month
    iterateMonths(dateFrom, effectiveTo, (year, month) => {
      for (const wk of [1, 2, 3]) {
        const d = nthWeekdayOfMonth(year, month, weekday, wk);
        if (d && d >= dateFrom && d <= effectiveTo) dates.push(formatDate(d));
      }
    });
  } else if (frequency === "2x_monthly") {
    // Weeks 1 and 3 (or use specified week + week+2)
    const targetWeeks = weeks.length >= 2 ? weeks.slice(0, 2) : weeks.length === 1 ? [weeks[0], Math.min(weeks[0] + 2, 5)] : [1, 3];
    iterateMonths(dateFrom, effectiveTo, (year, month) => {
      for (const wk of targetWeeks) {
        const d = nthWeekdayOfMonth(year, month, weekday, wk);
        if (d && d >= dateFrom && d <= effectiveTo) dates.push(formatDate(d));
      }
    });
  } else if (frequency === "monthly") {
    // Once per month in the specified week (or week 1 if not specified)
    const targetWeek = weeks.length > 0 ? weeks[0] : 1;
    iterateMonths(dateFrom, effectiveTo, (year, month) => {
      const d = nthWeekdayOfMonth(year, month, weekday, targetWeek);
      if (d && d >= dateFrom && d <= effectiveTo) dates.push(formatDate(d));
    });
  } else if (frequency === "bimonthly") {
    // Every 2nd month
    const targetWeek = weeks.length > 0 ? weeks[0] : 1;
    iterateMonths(dateFrom, effectiveTo, (year, month, idx) => {
      if (idx % 2 !== 0) return;
      const d = nthWeekdayOfMonth(year, month, weekday, targetWeek);
      if (d && d >= dateFrom && d <= effectiveTo) dates.push(formatDate(d));
    });
  } else if (frequency === "quarterly") {
    // Every 3 months
    const targetWeek = weeks.length > 0 ? weeks[0] : 1;
    iterateMonths(dateFrom, effectiveTo, (year, month, idx) => {
      if (idx % 3 !== 0) return;
      const d = nthWeekdayOfMonth(year, month, weekday, targetWeek);
      if (d && d >= dateFrom && d <= effectiveTo) dates.push(formatDate(d));
    });
  }

  return dates;
}

function iterateMonths(from: Date, to: Date, cb: (year: number, month: number, idx: number) => void) {
  let year = from.getFullYear();
  let month = from.getMonth();
  let idx = 0;
  while (year < to.getFullYear() || (year === to.getFullYear() && month <= to.getMonth())) {
    cb(year, month, idx);
    month++;
    if (month > 11) { month = 0; year++; }
    idx++;
  }
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ---------- Main Computation ----------

interface ScheduleEntry {
  storeId: string;
  repCode: string;
  channelId: string;
  teamId: string;
  frequency: FrequencyType;
  dayOfWeek: string;
  weekNumber: string;
}

function emptyMetrics(): AdherenceMetrics {
  return {
    expectedVisits: 0,
    accurateHits: 0,
    accurateHitRate: 0,
    scheduledStores: 0,
    visitedStores: 0,
    storesVisitedPct: 0,
    missedStores: 0,
    missedPct: 0,
    totalVisits: 0,
    unscheduledVisits: 0,
    unscheduledPct: 0,
  };
}

function calcRates(m: AdherenceMetrics): void {
  m.accurateHitRate = m.expectedVisits > 0 ? Math.round((m.accurateHits / m.expectedVisits) * 100) : 0;
  m.storesVisitedPct = m.scheduledStores > 0 ? Math.round((m.visitedStores / m.scheduledStores) * 100) : 0;
  m.missedPct = m.scheduledStores > 0 ? Math.round((m.missedStores / m.scheduledStores) * 100) : 0;
  m.unscheduledPct = m.totalVisits > 0 ? Math.round((m.unscheduledVisits / m.totalVisits) * 100) : 0;
}

export function computeAdherence(
  stores: Store[],
  reps: Rep[],
  teams: Team[],
  channels: Channel[],
  visits: Visit[],
  dateFrom: Date,
  dateTo: Date
): AdherenceData {
  // Build lookup maps
  const repMap = new Map(reps.map(r => [r.code, r]));
  const teamMap = new Map(teams.map(t => [t.id, t]));

  // Build schedule entries from stores that have day/rep assigned
  const schedule: ScheduleEntry[] = stores
    .filter(s => s.repCode && s.dayOfWeek)
    .map(s => ({
      storeId: s.placeId || s.id,
      repCode: s.repCode,
      channelId: s.channelId,
      teamId: repMap.get(s.repCode)?.teamId || "",
      frequency: s.frequency,
      dayOfWeek: s.dayOfWeek,
      weekNumber: s.weekNumber,
    }));

  // Filter visits to date range
  const fromStr = formatDate(dateFrom);
  const toStr = formatDate(dateTo);
  const rangeVisits = visits.filter(v => v.date >= fromStr && v.date <= toStr);

  // Build visit lookup: repCode|storeId|date → boolean (for accurate hit detection)
  const visitKey = (repCode: string, storeId: string, date: string) =>
    `${repCode.toUpperCase()}|${storeId.toUpperCase()}|${date}`;
  const visitSet = new Set(rangeVisits.map(v => visitKey(v.repCode, v.storeId, v.date)));

  // Build visit-by-store lookup: repCode|storeId → boolean (for stores visited detection)
  const storeVisitKey = (repCode: string, storeId: string) =>
    `${repCode.toUpperCase()}|${storeId.toUpperCase()}`;
  const storeVisitSet = new Set(rangeVisits.map(v => storeVisitKey(v.repCode, v.storeId)));

  // Build set of scheduled store keys for unscheduled detection
  const scheduledStoreKeys = new Set(schedule.map(s => storeVisitKey(s.repCode, s.storeId)));

  // Initialize per-rep, per-team, per-channel accumulators
  const byRep: Record<string, UserAdherence> = {};
  const byTeam: Record<string, AdherenceMetrics> = {};
  const byChannel: Record<string, AdherenceMetrics> = {};
  const totals = emptyMetrics();

  // Process schedule entries
  for (const entry of schedule) {
    const expectedDates = generateExpectedDates(
      entry.frequency,
      entry.dayOfWeek,
      entry.weekNumber,
      dateFrom,
      dateTo
    );

    // Initialize rep accumulator
    if (!byRep[entry.repCode]) {
      const rep = repMap.get(entry.repCode);
      byRep[entry.repCode] = {
        ...emptyMetrics(),
        repCode: entry.repCode,
        repName: rep?.name || entry.repCode,
        teamId: entry.teamId,
      };
    }

    // Initialize team accumulator
    const teamName = entry.teamId ? (teamMap.get(entry.teamId)?.name || "Unassigned") : "Unassigned";
    if (!byTeam[teamName]) byTeam[teamName] = emptyMetrics();

    // Initialize channel accumulator
    const channel = channels.find(c => c.id === entry.channelId);
    const channelName = channel?.name || "Unassigned";
    if (!byChannel[channelName]) byChannel[channelName] = emptyMetrics();

    // Count expected visits (accurate hits)
    let hits = 0;
    for (const date of expectedDates) {
      if (visitSet.has(visitKey(entry.repCode, entry.storeId, date))) {
        hits++;
      }
    }

    // Count if store was visited at all
    const wasVisited = storeVisitSet.has(storeVisitKey(entry.repCode, entry.storeId));

    // Accumulate for rep
    byRep[entry.repCode].expectedVisits += expectedDates.length;
    byRep[entry.repCode].accurateHits += hits;
    byRep[entry.repCode].scheduledStores += 1;
    byRep[entry.repCode].visitedStores += wasVisited ? 1 : 0;
    byRep[entry.repCode].missedStores += wasVisited ? 0 : 1;

    // Accumulate for team
    byTeam[teamName].expectedVisits += expectedDates.length;
    byTeam[teamName].accurateHits += hits;
    byTeam[teamName].scheduledStores += 1;
    byTeam[teamName].visitedStores += wasVisited ? 1 : 0;
    byTeam[teamName].missedStores += wasVisited ? 0 : 1;

    // Accumulate for channel
    byChannel[channelName].expectedVisits += expectedDates.length;
    byChannel[channelName].accurateHits += hits;
    byChannel[channelName].scheduledStores += 1;
    byChannel[channelName].visitedStores += wasVisited ? 1 : 0;
    byChannel[channelName].missedStores += wasVisited ? 0 : 1;

    // Accumulate totals
    totals.expectedVisits += expectedDates.length;
    totals.accurateHits += hits;
    totals.scheduledStores += 1;
    totals.visitedStores += wasVisited ? 1 : 0;
    totals.missedStores += wasVisited ? 0 : 1;
  }

  // Count total visits and unscheduled visits
  totals.totalVisits = rangeVisits.length;
  totals.unscheduledVisits = rangeVisits.filter(
    v => !scheduledStoreKeys.has(storeVisitKey(v.repCode, v.storeId))
  ).length;

  // Per-rep total visits and unscheduled
  for (const v of rangeVisits) {
    if (byRep[v.repCode]) {
      byRep[v.repCode].totalVisits++;
      if (!scheduledStoreKeys.has(storeVisitKey(v.repCode, v.storeId))) {
        byRep[v.repCode].unscheduledVisits++;
      }
    }
  }

  // Per-team and per-channel total visits
  for (const v of rangeVisits) {
    const rep = repMap.get(v.repCode);
    const teamId = rep?.teamId || "";
    const teamName2 = teamId ? (teamMap.get(teamId)?.name || "Unassigned") : "Unassigned";
    if (byTeam[teamName2]) {
      byTeam[teamName2].totalVisits++;
      if (!scheduledStoreKeys.has(storeVisitKey(v.repCode, v.storeId))) {
        byTeam[teamName2].unscheduledVisits++;
      }
    }

    // Find channel from the store that was visited
    const store = stores.find(s => (s.placeId || s.id).toUpperCase() === v.storeId.toUpperCase());
    const chName = store ? (channels.find(c => c.id === store.channelId)?.name || "Unassigned") : "Unassigned";
    if (byChannel[chName]) {
      byChannel[chName].totalVisits++;
      if (!scheduledStoreKeys.has(storeVisitKey(v.repCode, v.storeId))) {
        byChannel[chName].unscheduledVisits++;
      }
    }
  }

  // Calculate rates
  calcRates(totals);
  for (const r of Object.values(byRep)) calcRates(r);
  for (const t of Object.values(byTeam)) calcRates(t);
  for (const c of Object.values(byChannel)) calcRates(c);

  return { totals, byRep, byTeam, byChannel };
}
