export interface Channel {
  id: string;
  name: string;
  frequency: FrequencyType;
  duration: number; // minutes per visit
}

export type FrequencyType =
  | "weekly"
  | "3x_monthly"
  | "2x_monthly"
  | "monthly"
  | "bimonthly"
  | "quarterly";

export const FREQUENCY_OPTIONS: { value: FrequencyType; label: string; monthlyRate: number }[] = [
  { value: "weekly", label: "Weekly (4x/month)", monthlyRate: 4 },
  { value: "3x_monthly", label: "3x per Month", monthlyRate: 3 },
  { value: "2x_monthly", label: "2x per Month", monthlyRate: 2 },
  { value: "monthly", label: "Once a Month", monthlyRate: 1 },
  { value: "bimonthly", label: "Every 2nd Month", monthlyRate: 0.5 },
  { value: "quarterly", label: "Once a Quarter", monthlyRate: 0.333 },
];

export function getFrequencyLabel(freq: FrequencyType): string {
  return FREQUENCY_OPTIONS.find((f) => f.value === freq)?.label ?? freq;
}

export function getMonthlyRate(freq: FrequencyType): number {
  return FREQUENCY_OPTIONS.find((f) => f.value === freq)?.monthlyRate ?? 1;
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
  assignedChannels?: string[]; // channel IDs for channel_dedicated/hybrid strategies
  assignedZones?: string[]; // zone IDs for geography/hybrid strategies
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
  monthlySales: number;
  frequency: FrequencyType;
  duration: number; // minutes
  dayOfWeek: string;
  weekNumber: string;
  zoneId?: string; // for geography/hybrid strategies
  region?: string; // user-defined region
  province?: string; // auto-populated from GPS via Google Geocoding
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

export interface Zone {
  id: string;
  name: string;
  description: string;
}

export interface Region {
  id: string;
  name: string;
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
    permissions: ["manage_super_admins", "manage_users", "manage_roles", "manage_teams", "manage_reps", "manage_stores", "manage_channels", "manage_routes", "manage_call_cycles", "manage_channel_map", "manage_zones", "manage_regions", "manage_repsly", "view_dashboard", "view_map", "view_routes", "upload_data", "export_data"],
  },
  {
    role: "admin",
    label: "Admin",
    description: "Manage reps, stores, channels, and view reports",
    permissions: ["manage_teams", "manage_reps", "manage_stores", "manage_channels", "manage_routes", "manage_call_cycles", "manage_channel_map", "manage_zones", "manage_regions", "manage_repsly", "view_dashboard", "view_map", "view_routes", "upload_data", "export_data"],
  },
  {
    role: "teamManager",
    label: "Team Manager",
    description: "View and manage assigned team and reps",
    permissions: ["manage_reps", "manage_stores", "view_dashboard", "view_map", "view_routes"],
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
  { key: "manage_stores", label: "Manage Stores" },
  { key: "manage_channels", label: "Manage Channels" },
  { key: "manage_routes", label: "Manage Routes" },
  { key: "manage_call_cycles", label: "Manage Call Cycles" },
  { key: "manage_channel_map", label: "Manage Channel Map" },
  { key: "manage_zones", label: "Manage Zones" },
  { key: "manage_regions", label: "Manage Regions" },
  { key: "manage_repsly", label: "Manage Repsly API" },
  { key: "view_dashboard", label: "View Dashboard" },
  { key: "view_map", label: "View Map" },
  { key: "view_routes", label: "View Routes" },
  { key: "upload_data", label: "Upload Data" },
  { key: "export_data", label: "Export Data" },
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

export type CallCycleStrategy = "channel_dedicated" | "geography" | "hybrid" | "dynamic";

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
  {
    id: "cct-hybrid",
    name: "Hybrid",
    strategy: "hybrid",
    description: "Combination of channel and geography — reps have channel preferences but are clustered by area.",
    active: false,
  },
  {
    id: "cct-dynamic",
    name: "Dynamic",
    strategy: "dynamic",
    description: "System optimises store assignments based on rep capacity, proximity, and channel coverage targets.",
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

export interface RepslySyncConfig {
  apiKey: string;
  apiPasscode: string;
  enabled: boolean;
  lastClientSync: string | null; // ISO datetime
  lastVisitSync: string | null;
  lastWorkingTimeSync: string | null;
  lastRepSync: string | null;
}

export interface RepslySyncLogEntry {
  timestamp: string; // ISO datetime
  type: "clients" | "visits" | "working_time" | "reps";
  recordsImported: number;
  recordsSkipped: number;
  error?: string;
}
