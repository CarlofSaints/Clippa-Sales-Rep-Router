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
}

export type UserRole = "superAdmin" | "admin" | "teamManager" | "rep" | "viewer";

export interface User {
  id: string;
  name: string;
  email: string;
  password: string; // hashed
  role: UserRole;
}

export interface SessionPayload {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
}
