export interface Channel {
  id: string;
  name: string;
  frequency: FrequencyType;
  duration: number; // minutes per visit
}

export type FrequencyType =
  | "daily"
  | "3x_weekly"
  | "2x_weekly"
  | "weekly"
  | "3x_monthly"
  | "2x_monthly"
  | "monthly"
  | "bimonthly"
  | "quarterly";

/**
 * monthlyRate is visits per month on the planner's own calendar, which is a
 * 4-week cycle of 5 working days. So daily = 5 × 4 = 20, not 21.7. Keeping it
 * consistent with the cycle the route engine actually builds is what stops a
 * rep's capacity line disagreeing with the route they were given.
 *
 * visitsPerWeek is only meaningful for the sub-weekly frequencies: it is how
 * many separate days in a week the store is called on. Everything weekly or
 * slower is visited at most once in any given week, so it is 1.
 */
export const FREQUENCY_OPTIONS: {
  value: FrequencyType;
  label: string;
  monthlyRate: number;
  visitsPerWeek: number;
}[] = [
  { value: "daily", label: "Daily (every working day)", monthlyRate: 20, visitsPerWeek: 5 },
  { value: "3x_weekly", label: "3x per Week", monthlyRate: 12, visitsPerWeek: 3 },
  { value: "2x_weekly", label: "2x per Week", monthlyRate: 8, visitsPerWeek: 2 },
  { value: "weekly", label: "Weekly (4x/month)", monthlyRate: 4, visitsPerWeek: 1 },
  { value: "3x_monthly", label: "3x per Month", monthlyRate: 3, visitsPerWeek: 1 },
  { value: "2x_monthly", label: "2x per Month", monthlyRate: 2, visitsPerWeek: 1 },
  { value: "monthly", label: "Once a Month", monthlyRate: 1, visitsPerWeek: 1 },
  { value: "bimonthly", label: "Every 2nd Month", monthlyRate: 0.5, visitsPerWeek: 1 },
  { value: "quarterly", label: "Once a Quarter", monthlyRate: 0.333, visitsPerWeek: 1 },
];

export function getFrequencyLabel(freq: FrequencyType): string {
  return FREQUENCY_OPTIONS.find((f) => f.value === freq)?.label ?? freq;
}

export function getMonthlyRate(freq: FrequencyType): number {
  return FREQUENCY_OPTIONS.find((f) => f.value === freq)?.monthlyRate ?? 1;
}

/** How many separate days in a week this frequency is visited on. */
export function getVisitsPerWeek(freq: FrequencyType): number {
  return FREQUENCY_OPTIONS.find((f) => f.value === freq)?.visitsPerWeek ?? 1;
}

/**
 * Spreadsheet-tolerant frequency parser.
 *
 * Uploads come from people typing into Excel, so "Weekly", "3x _weekly" and
 * "Every 2nd month" all have to land on the right value. Matching used to be
 * exact and case-sensitive against the stored value, which rejected 21 rows of
 * a real channel import purely on capitalisation and a stray space.
 *
 * Returns null only when the text genuinely isn't a frequency we know.
 */
export function parseFrequency(raw: string): FrequencyType | null {
  if (!raw) return null;

  // Collapse case, punctuation and spacing: "3x _weekly" → "3xweekly"
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const key = norm(raw);
  if (!key) return null;

  // Exact stored values and display labels first
  for (const opt of FREQUENCY_OPTIONS) {
    if (norm(opt.value) === key || norm(opt.label) === key) return opt.value;
  }

  const SYNONYMS: Record<string, FrequencyType> = {
    // daily
    daily: "daily", everyday: "daily", eachday: "daily", "5xweekly": "daily",
    "5xweek": "daily", "5aweek": "daily", "5perweek": "daily", everyworkingday: "daily",
    // 3x weekly
    "3xweek": "3x_weekly", "3aweek": "3x_weekly", "3perweek": "3x_weekly",
    "3timesaweek": "3x_weekly", "3timesweekly": "3x_weekly", threeweekly: "3x_weekly",
    // 2x weekly
    "2xweek": "2x_weekly", "2aweek": "2x_weekly", "2perweek": "2x_weekly",
    "2timesaweek": "2x_weekly", "2timesweekly": "2x_weekly", twiceaweek: "2x_weekly",
    twiceweekly: "2x_weekly", biweekly: "2x_weekly",
    // weekly
    "1xweekly": "weekly", "1xweek": "weekly", onceaweek: "weekly", everyweek: "weekly",
    weekly4xmonth: "weekly",
    // 3x monthly
    "3xmonth": "3x_monthly", "3permonth": "3x_monthly", "3timesamonth": "3x_monthly",
    "3timesmonthly": "3x_monthly",
    // 2x monthly
    "2xmonth": "2x_monthly", "2permonth": "2x_monthly", "2timesamonth": "2x_monthly",
    "2timesmonthly": "2x_monthly", twiceamonth: "2x_monthly", twicemonthly: "2x_monthly",
    fortnightly: "2x_monthly", everyfortnight: "2x_monthly", every2weeks: "2x_monthly",
    // monthly
    "1xmonthly": "monthly", "1xmonth": "monthly", onceamonth: "monthly",
    everymonth: "monthly", permonth: "monthly",
    // bimonthly
    bimonthly: "bimonthly", every2ndmonth: "bimonthly", every2months: "bimonthly",
    everysecondmonth: "bimonthly", everyothermonth: "bimonthly", "2monthly": "bimonthly",
    // quarterly
    quarterly: "quarterly", onceaquarter: "quarterly", perquarter: "quarterly",
    every3months: "quarterly", every3rdmonth: "quarterly", "3monthly": "quarterly",
  };

  return SYNONYMS[key] ?? null;
}

export interface Rep {
  id: string;
  code: string;
  name: string;
  email: string;
  cell: string;
  homeAddress: string;
  homeGpsLat: string;
  homeGpsLng: string;
  teamId: string;
  workingHoursPerDay?: number; // default 8.5
  assignedChannels?: string[]; // channel IDs for channel_dedicated strategy
}

export interface Team {
  id: string;
  name: string;
  managerId: string; // User ID of the area/team manager
  managerName: string;
  managerEmail: string;
  managerCell: string;
  area: string; // geographic area this team covers
}

export interface Store {
  id: string;
  placeId: string;
  name: string;
  channelId: string;
  repCode: string;
  gpsLat: string;
  gpsLng: string;
  /**
   * AVERAGE monthly sales: `sixMonthSales / 6`.
   *
   * The stored key keeps its old name on purpose. Seventeen places read it, and
   * renaming a persisted field means a migration that silently drops the value
   * on every record written before it. What changed is the LABEL and where the
   * number comes from, not the key.
   */
  monthlySales: number;
  /**
   * Rolling six months of in-market sales for this store, as supplied by the
   * client's IMS database.
   *
   * IMS, not sell-out: most of this store base is independents, forecourts and
   * liquor stores, and no retailer scan data exists for them. What the outlet
   * bought is only known to the invoicing system.
   *
   * Absent means "we have never been given a figure", which is a different
   * thing from zero, so it is optional rather than defaulted.
   */
  sixMonthSales?: number;
  frequency: FrequencyType;
  duration: number; // minutes
  dayOfWeek: string;
  weekNumber: string;
  rangeConfirmed?: boolean; // manager confirmed this store is in the rep's cycle despite being far from their area
  region?: string; // user-defined region
  province?: string; // auto-populated from GPS via Google Geocoding
  /**
   * Shut. Excluded from route generation and capacity, because a rep must not
   * be sent to a shop that no longer exists.
   *
   * Optional and absent by default: the field arrived long after these records
   * did, and absent means "nobody has said", which reads as open.
   */
  closed?: boolean;
  /** Why, so an automatic pass never silently undoes a human decision. */
  closedReason?: "ims_accc" | "ims_flag" | "manual";
  closedAt?: string;
  /**
   * A person set this store's status by hand, in EITHER direction.
   *
   * 🔴 Both directions is the point. The closure pass already refused to
   * auto-reopen a store somebody had closed by hand, but nothing stopped it
   * re-closing a store somebody had deliberately REOPENED: IMS still carries
   * the flag, so the next "close the IMS ones" press would quietly undo the
   * decision, and the person who made it would never be told.
   *
   * A store this is set on is skipped by the automatic pass entirely. A person
   * who has looked at a shop outranks a spreadsheet that has not.
   */
  statusDecidedByHand?: boolean;
}

export const SA_PROVINCES = [
  "Eastern Cape",
  "Free State",
  "Gauteng",
  "KwaZulu-Natal",
  "Limpopo",
  "Mpumalanga",
  "North West",
  "Northern Cape",
  "Western Cape",
] as const;

export interface Region {
  id: string;
  name: string;
}

// ---------- Store Call Frequency/Duration Overrides ----------

export type OverrideApprovalStatus = "pending" | "approved";

export interface StoreOverride {
  id: string;
  storeId: string;
  storeName: string; // denormalized for display/history
  placeId: string;
  channelId: string;
  repCode: string;
  // channel defaults captured at time of override (audit/reference)
  defaultFrequency: FrequencyType;
  defaultDuration: number;
  // override values that were applied to the store
  frequency: FrequencyType;
  duration: number;
  approvalStatus: OverrideApprovalStatus;
  requestedBy?: string;
  requestedAt?: string;
  decidedBy?: string;
  decidedAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type UserRole = "superAdmin" | "admin" | "teamManager" | "rep" | "viewer";

export interface User {
  id: string;
  name: string;
  email: string;
  password: string; // hashed
  role: UserRole;
  forcePasswordChange: boolean;
  cell?: string;
  profilePicUrl?: string;
  /**
   * The rep record this login belongs to, stored when the account is created
   * from the Reps page. Matching on email alone detaches silently the moment
   * anyone edits the rep's email, so the link is kept rather than inferred.
   */
  repId?: string;
}

export interface RolePermission {
  role: UserRole;
  label: string;
  description: string;
  permissions: string[];
}

export const ROLE_DEFINITIONS: RolePermission[] = [
  {
    role: "superAdmin",
    label: "Super Admin",
    description: "Full unrestricted access",
    permissions: ["manage_super_admins", "manage_users", "manage_roles", "manage_teams", "manage_reps", "create_rep_accounts", "manage_stores", "manage_store_overrides", "manage_channels", "manage_routes", "generate_routes", "manage_call_cycles", "manage_channel_map", "manage_regions", "manage_repsly", "view_dashboard", "view_map", "view_routes", "upload_stores", "upload_data", "export_data"],
  },
  {
    role: "admin",
    label: "Admin",
    description: "Manage reps, stores, channels, and view reports",
    permissions: ["manage_teams", "manage_reps", "create_rep_accounts", "manage_stores", "manage_store_overrides", "manage_channels", "manage_routes", "generate_routes", "manage_call_cycles", "manage_channel_map", "manage_regions", "manage_repsly", "view_dashboard", "view_map", "view_routes", "upload_stores", "upload_data", "export_data"],
  },
  {
    role: "teamManager",
    label: "Team Manager",
    description: "View and manage assigned team and reps",
    permissions: ["manage_reps", "manage_stores", "manage_store_overrides", "view_dashboard", "view_map", "view_routes"],
  },
  {
    role: "rep",
    label: "Rep",
    description: "View own routes and store assignments",
    permissions: ["view_dashboard", "view_map", "view_routes"],
  },
  {
    role: "viewer",
    label: "Viewer",
    description: "Read-only access to dashboards and reports",
    permissions: ["view_dashboard", "view_map", "view_routes"],
  },
];

export const ALL_PERMISSIONS = [
  { key: "manage_super_admins", label: "Manage Super Admins" },
  { key: "manage_users", label: "Manage Users" },
  { key: "manage_roles", label: "Manage Roles" },
  { key: "manage_teams", label: "Manage Teams" },
  { key: "manage_reps", label: "Manage Reps" },
  { key: "create_rep_accounts", label: "Create Rep Logins" },
  { key: "manage_stores", label: "Manage Stores" },
  { key: "manage_store_overrides", label: "Manage Store Call Overrides" },
  { key: "manage_channels", label: "Manage Channels" },
  { key: "manage_routes", label: "Manage Routes" },
  { key: "generate_routes", label: "Generate Routes" },
  { key: "manage_call_cycles", label: "Manage Call Cycles" },
  { key: "manage_channel_map", label: "Manage Channel Map" },
  { key: "manage_regions", label: "Manage Regions" },
  { key: "manage_repsly", label: "Manage Repsly API" },
  { key: "view_dashboard", label: "View Dashboard" },
  { key: "view_map", label: "View Map" },
  { key: "view_routes", label: "View Routes" },
  { key: "upload_stores", label: "Upload Stores" },
  { key: "upload_data", label: "Upload Data" },
  { key: "export_data", label: "Export Data" },
  // Deliberately granted to NOBODY except superAdmin. getRolePermissions forces
  // superAdmin to the full ALL_PERMISSIONS list while every other role keeps its
  // saved explicit list, so adding a key here and nowhere else gives it to the
  // super admin alone. No user id is hardcoded anywhere.
  { key: "view_sql_direct", label: "SQL Direct (reconnaissance)" },
];

export interface SessionPayload {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  forcePasswordChange?: boolean;
  repCode?: string;  // for rep users — matched by email at login
  teamId?: string;   // for teamManager users — matched by managerEmail at login
  cell?: string;
  profilePicUrl?: string;
}

// ---------- Call Cycle Types ----------

export type CallCycleStrategy = "channel_dedicated" | "geography";

export interface CallCycleType {
  id: string;
  name: string;
  strategy: CallCycleStrategy;
  description: string;
  active: boolean; // only one can be active at a time
}

export const DEFAULT_CALL_CYCLE_TYPES: CallCycleType[] = [
  {
    id: "cct-channel",
    name: "Channel Dedicated",
    strategy: "channel_dedicated",
    description: "Reps are assigned specific channels and only call on stores within those channels in their region.",
    active: false,
  },
  {
    id: "cct-geography",
    name: "Geography",
    strategy: "geography",
    description: "Reps are assigned geographic areas and call on any channel within their area, limited by daily store capacity.",
    active: false,
  },
];

// ---------- Route Plan Types ----------

export interface RouteStop {
  storeId: string;
  storeName: string;
  lat: number;
  lng: number;
  visitDuration: number; // minutes
  travelTimeFromPrev: number; // minutes
  distanceFromPrev: number; // km
  arrivalTime: string; // "HH:mm"
  departureTime: string; // "HH:mm"
  sequence: number;
}

export type WeekLabel = "Wk1" | "Wk2" | "Wk3" | "Wk4";
export type DayLabel = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday";

export interface RouteDayPlan {
  day: DayLabel;
  week: WeekLabel;
  stops: RouteStop[];
  totalTravelTime: number; // minutes
  totalVisitTime: number; // minutes
  totalTime: number; // minutes (travel + visits)
  totalDistance: number; // km
  overCapacity: boolean;
  /**
   * How far past the rep's working day this one runs, in minutes.
   *
   * Only ever positive, and only present when a calls-per-day target pushed the
   * day past its hours. Present BECAUSE the target wins: the manager asked for
   * eight calls, so eight calls are scheduled, and this is how the plan admits
   * the day is longer than the rep's hours instead of quietly dropping a store.
   */
  overrunMinutes?: number;
  polyline?: string; // encoded Google polyline
}

export interface RepRoutePlan {
  repCode: string;
  repName: string;
  homeLatLng: { lat: number; lng: number } | null;
  workingHoursPerDay: number;
  generatedAt: string; // ISO datetime
  days: RouteDayPlan[];
  stats: {
    totalStores: number;
    unassignedStores: { storeId: string; storeName: string; reason: string }[];
  };
}

export interface RoutePlanDocument {
  id: string;
  generatedAt: string; // ISO datetime
  generatedBy: string;
  callCycleTypeId?: string;   // which call cycle type generated this
  callCycleTypeName?: string; // human-readable name for display
  repPlans: RepRoutePlan[];
  config: {
    useGoogleMaps: boolean;
    defaultStartTime: string; // "HH:mm"
    /**
     * The calls-per-day target this plan was built with, or absent for a plan
     * built before the setting existed (or with no target at all).
     *
     * Recorded ON THE PLAN, not read from settings when the page renders. The
     * setting can be changed without regenerating, and a page that showed the
     * CURRENT setting beside an OLD plan would describe a week nobody has.
     */
    callsPerDay?: number;
  };
}

// ---------- Repsly Integration Types ----------

export interface RepslyVisit {
  visitId: string;
  date: string; // YYYY-MM-DD
  repCode: string;
  repName: string;
  clientCode: string;
  clientName: string;
  dateTimeStart: string; // ISO datetime
  dateTimeEnd: string; // ISO datetime
  scheduledVsUnscheduled: "Scheduled" | "Unscheduled" | string;
  latStart: number;
  lngStart: number;
}

export interface RepslyWorkingTime {
  id: string;
  date: string; // YYYY-MM-DD
  repCode: string;
  repName: string;
  dayStart: string; // ISO datetime
  dayEnd: string; // ISO datetime
  lengthMinutes: number;
  mileageTotal: number;
  noOfVisits: number;
  timeAtClient: number; // minutes
  timeAtTravel: number; // minutes
}

/**
 * A visit Repsly has SCHEDULED — the call cycle as the field app holds it.
 *
 * Not the same thing as a RepslyVisit, which is a call that actually happened,
 * and not the same thing as this app's own route plan. Three separate views of
 * the same intention, and the reason for pulling this one is to see where they
 * disagree.
 *
 * Read-only. Nothing in this app writes a schedule back to Repsly.
 */
export interface RepslyVisitSchedule {
  /** Repsly's own id where it gives one; otherwise a composite of rep+client+date. */
  scheduleId: string;
  date: string; // YYYY-MM-DD
  repCode: string;
  repName: string;
  clientCode: string;
  clientName: string;
  /** Local time as Repsly returns it, "" when the schedule is a whole-day one. */
  dateTimeStart: string;
  dateTimeEnd: string;
  note: string;
}

export interface RepslySyncConfig {
  apiKey: string;
  apiPasscode: string;
  enabled: boolean;
  lastClientSync: string | null; // ISO datetime
  lastVisitSync: string | null;
  lastWorkingTimeSync: string | null;
  lastRepSync: string | null;
  lastCallCycleSync: string | null;
}

export interface RepslySyncLogEntry {
  timestamp: string; // ISO datetime
  type: "clients" | "visits" | "working_time" | "reps" | "call_cycles";
  recordsImported: number;
  recordsSkipped: number;
  error?: string;
}
