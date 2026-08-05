# Clippa Sales Rep Router — Current State (Jun 1, 2026)

## Project Location
`C:\Users\CarlDosSantos-(OUTER\Projects\Clippa-Sales-Rep-Router`
GitHub: [Clippa-Sales-Rep-Router](https://github.com/CarlofSaints/Clippa-Sales-Rep-Router)

## Tech Stack
- Next.js 15.5.18, React 19, TypeScript, Tailwind CSS
- Vercel Blob storage (JSON files via `lib/data.ts`), bcryptjs for auth
- Leaflet for maps, xlsx for Excel parsing, Google Maps Directions API (optional)
- Vercel Pro deployment

## Session Work (May 31, 2026) — DEPLOYED

### 1. Sidebar Restructure — Collapsible Control Centre
**File:** `app/layout.tsx`
- Split 12 flat nav items into 3 groups:
  - **Top:** Dashboard, Reps, Stores, Map, Routes
  - **Control Centre** (collapsible with chevron): Channels, Teams, Call Cycles, Channel Map, Zones, Regions
  - **Bottom:** Admin, Account
- Auto-expands when pathname matches a child route
- Chevron rotates on toggle

### 2. User Profile Fields
**Files:** `lib/types.ts`, `lib/auth.ts`
- Added `cell?: string` and `profilePicUrl?: string` to `User` interface
- Added same to `SessionPayload` interface
- `validateCredentials()` includes new fields in returned session
- Change-password route re-issues session with new fields
- PUT `/api/users` accepts `cell` field

### 3. Manager Resolution
**New file:** `lib/manager.ts`
- `resolveManager(session)` returns `{ name, email, cell, title }` or null
- Rep → finds their team via rep.teamId → returns team manager info (title: "Team Manager")
- TeamManager → finds the superAdmin user (title: "National Manager")
- Admin/SuperAdmin/Viewer → null

### 4. Account Page
**New file:** `app/account/page.tsx`
- Profile header: circular avatar with camera overlay (click to upload), name, email, role badge
- Personal details form: Name (editable), Email (read-only), Cell (editable), Save button
- Manager section: shows resolved manager with initials avatar, name, title, email/cell
- Change password section: current pw, new pw, confirm, validation

### 5. Avatar Upload
**New file:** `app/api/account/avatar/route.ts`
- POST accepts FormData with image file (JPEG/PNG/WebP, max 2MB)
- Stores in Vercel Blob as `avatars/{userId}.ext` with public access
- Deletes old avatar(s) before upload
- Re-issues session cookie with updated profilePicUrl

### 6. Account Profile API
**New file:** `app/api/account/route.ts`
- GET: returns own user (sans password) + resolved manager info
- PUT: updates name, cell; optional password change (validates current pw first); re-issues session

### 7. Channel Management
**File:** `app/channels/page.tsx`
- Added "+ Add Channel" button with toggle form card (name, frequency dropdown, duration)
- Added delete button per channel row (with confirmation dialog)
**File:** `app/api/channels/route.ts`
- Added DELETE handler

### 8. Permissions Matrix Expansion
**File:** `lib/types.ts`
- `ALL_PERMISSIONS` expanded from 10 → 16 items
- New: `manage_routes`, `manage_call_cycles`, `manage_channel_map`, `manage_zones`, `manage_regions`, `view_routes`
- `ROLE_DEFINITIONS` updated: superAdmin/admin get all new perms, teamManager/rep/viewer get `view_routes`

### 9. Frozen Headers on Permissions Grid
**File:** `app/admin/page.tsx`
- Sticky `<thead>` stays visible on vertical scroll (max-h 520px container)
- First column (Permission label) sticky on horizontal scroll

## Git Commits (this session)
```
930c91f Freeze header row and permission column on permissions grid
f1b389e Add missing feature permissions to role matrix
181c840 Add Control Centre sidebar grouping, Account page, and channel management
```

## Key Files
- `lib/types.ts` — All interfaces (User, Rep, Store, Team, etc.), 18 permissions, 5 role definitions
- `lib/auth.ts` — Session encode/decode, validateCredentials, requireAdmin/requireSession
- `lib/data.ts` — Blob storage CRUD (dual-mode: Vercel Blob or local `/data/` dir)
- `lib/manager.ts` — resolveManager() helper
- `lib/repslyApi.ts` — Repsly v3 API client (Basic auth, paginated fetches)
- `lib/repslyData.ts` — Blob storage for Repsly config, visits, working time, sync logs
- `app/layout.tsx` — Root layout with collapsible sidebar
- `app/admin/page.tsx` — Users table + permissions matrix (frozen headers)
- `app/account/page.tsx` — User profile page
- `app/channels/page.tsx` — Channel list with add/edit/delete
- `app/repsly/page.tsx` — Repsly integration page (credentials, sync controls, sync log)
- `components/SessionProvider.tsx` — Client-side session context from cookie

## Session Work (Jun 1, 2026) — DEPLOYED

### 1. Repsly API Integration (Phase 1)
Full Repsly v3 API integration for pulling actual visit data.

**New files:**
- **`lib/repslyApi.ts`** — API client with Basic auth (`btoa(key:passcode)`), paginated fetch for visits (timestamp-based), clients (offset-based), daily working time (ID-based), reps (single call). `testConnection()` validates credentials.
- **`lib/repslyData.ts`** — Blob storage helpers: `getRepslyConfig()`/`saveRepslyConfig()` (blob: `config/repsly-api.json`), `getRepslyVisits()`/`saveRepslyVisits()` (blob: `repsly-visits.json`), `getRepslyWorkingTime()`/`saveRepslyWorkingTime()` (blob: `repsly-working-time.json`), `getRepslySyncLog()`/`appendSyncLog()` (blob: `logs/repsly-sync.json`, keeps last 100)
- **`app/api/repsly/config/route.ts`** — GET (masked credentials), PUT (save + optional test connection)
- **`app/api/repsly/sync/route.ts`** — POST `{ type, mode: "test"|"import" }`. Visits: incremental by timestamp, dedupes by visitId. Clients: matches by clientCode→store.placeId, updates blank GPS. Working time: incremental by last ID. Reps: matches by code, updates name/email/phone. `maxDuration=60`.
- **`app/api/repsly/logs/route.ts`** — GET sync log history
- **`app/api/repsly/visits/route.ts`** — GET visits with `?from=&to=` date range filter (for dashboard)
- **`app/repsly/page.tsx`** — Integration page: API Connection (key/passcode with show/hide, test/save), Sync Controls (test/import buttons per data type with last sync timestamps), Sync Log table

**Modified files:**
- **`lib/types.ts`** — Added `RepslyVisit`, `RepslyWorkingTime`, `RepslySyncConfig`, `RepslySyncLogEntry` interfaces
- **`app/page.tsx`** — Dashboard fetches MTD visits; new visit KPI row (Visits, Scheduled, Unscheduled, Stores Visited); Team table has Visits column (total + scheduled/unscheduled breakdown); Rep table has Visits + Stores Hit columns
- **`app/layout.tsx`** — Repsly nav item inside Control Centre (after Regions). Admin renamed to "User Admin".

### 2. Permissions Updates
- **`manage_super_admins`** permission added — superAdmin-only by default
- **`manage_repsly`** permission added — superAdmin + admin by default
- **`app/api/users/route.ts`** — Server-side enforcement: non-superAdmins blocked from creating/editing/deleting superAdmin users, or promoting any user to superAdmin role
- Total permissions: 18 (was 16)

### 3. Sidebar Changes
- Repsly moved from top nav into Control Centre group
- "Admin" renamed to "User Admin"

## Git Commits (Jun 1 session)
```
fb59c22 Add manage_super_admins permission with server-side enforcement
f6c860a Move Repsly into Control Centre, rename Admin to User Admin, add manage_repsly permission
86161f0 Add Repsly API integration with visit data on dashboard
```

## Repsly — Awaiting Client API Credentials
Email sent to Clippa requesting Repsly API Key + API Passcode with export/read access to: Visits, Representatives, Clients, Daily Working Time. No write access needed. Once received, configure at /repsly page (inside Control Centre).

## Next: Repsly Phase 2 (After Credentials Received)
1. Planned vs actual reporting — compare call cycle schedule to actual Repsly visits
2. Adherence metrics on dashboard (hit rate %, stores visited %, unscheduled %, missed %)
3. Automated polling via cron route (like Bravo's `app/api/cron/poll-visits/route.ts`)
4. Working time analytics on dashboard (hours in field, mileage, time at client vs travel)

## Session Work (Jun 9, 2026) — PARTIALLY DEPLOYED

### 1. Call Cycle Type Filter on Routes & Map Pages (DEPLOYED)
**Commits:** `b8faf31`, `67f3977`

**`app/api/routes/generate/route.ts`** — Accepts optional `body.typeId` to target a specific call cycle type instead of always using the globally active one. Falls back to active type if no typeId provided.

**`app/routes/page.tsx`** — Dropdown always visible when types exist (removed `hasRoutes` filter). Shows all types with checkmark for types that have routes, "(no routes)" for those without. "Latest Routes" as default option (loads generic `routes.json`). Passes `selectedTypeId` to generate endpoint. Auto-selects most recently generated type (only those with routes).

**`app/map/page.tsx`** — Same dropdown and auto-select changes as routes page.

**Bug fixed in `67f3977`:** Auto-selecting a type without routes caused the useEffect to fetch per-type routes (null), wiping the generic routes loaded on initial page load. Fix: only auto-select types with routes; "Latest Routes" fallback reloads generic routes.

### 2. Stat Cards on Zones Page (DEPLOYED)
**Commit:** `b8faf31`

**`app/admin/zones/page.tsx`** — 5 filter-reactive stat cards above the table: Stores, Regions, Provinces, Assigned Zones, Unassigned. Values computed from `applyFilters(stores)`.

### 3. Stat Cards on Stores Page (DEPLOYED)
**Commit:** `fb20d55`

**`app/stores/page.tsx`** — Same 5 stat cards (Stores, Regions, Provinces, Assigned Zones, Unassigned) between filters and table. Computed from the `filtered` array.

### 4. Channel Export/Import Excel (DEPLOYED)
**Commit:** `7b5c3bb`

**`app/api/channels/export/route.ts`** — NEW. Exports channels to Excel with "Channels" sheet (name, frequency code, duration) and "Frequency Reference" sheet.

**`app/api/channels/import/route.ts`** — NEW. Imports channels from Excel. Matches by name (case-insensitive). Updates frequency/duration on existing, creates new. Accepts frequency codes or labels.

**`app/channels/page.tsx`** — Export Excel link, Import Excel file input with status messages.

### 5. Auto-Generate Zones from Rep Assignments (DEPLOYED but BUG FOUND)
**Commit:** `a187ab7`

**`app/api/zones/auto-generate/route.ts`** — NEW. Groups stores by `repCode`, creates numbered zones (Zone 1, Zone 2, etc.) for each rep's unzoned stores, assigns stores to zones and zones to reps. `maxDuration = 60`.

**`app/admin/zones/page.tsx`** — "Auto-Generate Zones from Reps" button added.

**BUG:** Zones were created but stores not allocated. Root cause: parallel `Promise.all([saveStores, saveReps, saveZones])` — with 6000+ stores, the large stores blob write races/fails. **FIX CODED but NOT committed:** Changed to sequential saves (stores → reps → zones). File `app/api/zones/auto-generate/route.ts` has unstaged changes.

### UNCOMMITTED CHANGE (pick up here)
**`app/api/zones/auto-generate/route.ts`** — Sequential saves fix. `git diff` shows `Promise.all` replaced with sequential `await` calls. **Must commit and push.**

### PENDING: Remove Hybrid and Dynamic Call Cycle Types
User explicitly requested removing `hybrid` and `dynamic` strategies — they are too similar and not useful. Files to modify:
1. **`lib/types.ts`** — Remove `"hybrid" | "dynamic"` from `CallCycleStrategy` type union. Remove hybrid/dynamic entries from `DEFAULT_CALL_CYCLE_TYPES` array.
2. **`app/api/routes/generate/route.ts`** — Remove hybrid/dynamic cases from strategy switch.
3. **`app/admin/call-cycle-types/page.tsx`** — Remove hybrid/dynamic from `STRATEGY_LABELS`, `STRATEGY_COLORS`, `STRATEGY_ICONS`, `STRATEGY_CONFIG_LINKS`. Remove from info section descriptions.

## Git Commits (Jun 9 session)
```
a187ab7 Add auto-generate zones from rep store assignments
fb20d55 Add filter-reactive stat cards to Stores page
7b5c3bb Add Excel export and import to Channels page
67f3977 Fix routes wiped when selecting call cycle type with no generated routes
b8faf31 Add call cycle type filter to Routes/Map and stat cards to Zones page
```

---


---

# Clippa Sales Rep Router — Repsly API Integration (Phase 1 DEPLOYED Jun 1, 2026)

## Project Location
`C:\Users\CarlDosSantos-(OUTER\Projects\Clippa-Sales-Rep-Router`
GitHub: [Clippa-Sales-Rep-Router](https://github.com/CarlofSaints/Clippa-Sales-Rep-Router)

## Tech Stack
- Next.js 15.3.2, React 19, TypeScript, Tailwind CSS 4
- Vercel Blob storage (JSON files via `lib/data.ts`)
- bcryptjs for auth, Leaflet for maps, xlsx for Excel parsing
- Google Maps Directions API (optional)

## What The App Does
Sales rep route planning tool for Clippa. Manages channels, teams, reps, stores. Generates optimized daily route plans (K-means clustering + nearest-neighbor + Google Maps). Role-based access (superAdmin, admin, teamManager, rep, viewer).

## Existing Architecture (Key for Integration)

### Blob Storage (`lib/data.ts`)
- `readJSON<T>(key, fallback)` — reads from Vercel Blob with Bearer token, falls back to local `/data/` dir
- `writeJSON<T>(key, data)` — deletes old blob then puts new one, `addRandomSuffix: false`
- `useBlob = !!process.env.BLOB_READ_WRITE_TOKEN`
- Existing stores: channels, reps, stores, users, teams, routes, rolePermissions

### Nav Items (`app/layout.tsx`)
Current order: Dashboard, Channels, Teams, Reps, Stores, Map, Routes, Admin
**Repsly nav item goes between Routes and Admin**

### Existing Types (`lib/types.ts`)
- Store has: `id, placeId, name, channelId, repCode, gpsLat, gpsLng, monthlySales, frequency, duration, dayOfWeek, weekNumber`
- Rep has: `id, code, name, email, cell, homeAddress, homeGpsLat, homeGpsLng, teamId, workingHoursPerDay`
- FrequencyType: `"weekly" | "3x_monthly" | "2x_monthly" | "monthly" | "bimonthly" | "quarterly"`

### Auth Pattern
- `requireAdmin(req)` middleware on protected routes
- Session in httpOnly cookie, base64-encoded

## Repsly Integration Plan — IMPLEMENT THIS

### Purpose
Clippa reps use Repsly in the field. The Router builds call cycles (planned visits). Repsly records actual visits. This integration pulls Repsly data to compare **planned vs actual** — reporting missed calls, unscheduled calls, adherence %.

### Pattern to Follow
Same pattern as Bravo Team Tracker's Perigee API integration. Key reference files in Bravo:
- `app/settings/page.tsx` — API connection UI, test/import, poll schedule, cron log
- `app/api/visits/poll/route.ts` — Manual test/import endpoint
- `app/api/cron/poll-visits/route.ts` — Automated polling
- `app/api/config/perigee/route.ts` — Config CRUD with masked API key
- `lib/blob.ts` — `readJson()`/`writeJson()` helpers

### New Files to Create

#### 1. `lib/repslyApi.ts` — API client
- Basic auth: `Authorization: Basic ${btoa(key + ':' + passcode)}`
- Paginated fetch: loop GET until `MetaCollectionResult.TotalCount === 0`
- Functions: `fetchAllClients()`, `fetchAllVisits(since)`, `fetchAllDailyWorkingTime(since)`, `fetchAllReps()`, `testConnection()`
- Base URL: `https://api.repsly.com/v3`

#### 2. `lib/repslyData.ts` — Blob storage
- `getRepslyConfig()` / `saveRepslyConfig()` — blob key: `config/repsly-api.json`
- `getRepslyVisits()` / `saveRepslyVisits()` — blob key: `repsly-visits.json`
- `getRepslyWorkingTime()` / `saveRepslyWorkingTime()` — blob key: `repsly-working-time.json`
- `getRepslySyncLog()` / `appendSyncLog()` — blob key: `logs/repsly-sync.json` (keep last 100)

#### 3. `lib/types.ts` — Append new types
```
RepslyVisit { visitId, date, repCode, repName, clientCode, clientName,
  dateTimeStart, dateTimeEnd, scheduledVsUnscheduled, latStart, lngStart }
RepslyWorkingTime { id, date, repCode, repName, dayStart, dayEnd,
  lengthMinutes, mileageTotal, noOfVisits, timeAtClient, timeAtTravel }
RepslySyncConfig { apiKey, apiPasscode, enabled, lastClientSync, lastVisitSync,
  lastWorkingTimeSync }
RepslySyncLogEntry { timestamp, type, recordsImported, recordsSkipped, error? }
```

#### 4. `app/repsly/page.tsx` — Integration page
- **Section 1: API Connection** — Key + Passcode inputs (masked), Test Connection button, status badge
- **Section 2: Sync Controls** — Manual sync buttons: Clients, Visits, Working Time, Reps. Each shows last sync time + record count. Test mode before import.
- **Section 3: Sync Log** — Scrollable table (time, type, imported, skipped, status)

#### 5. API Routes
| Route | Method | Purpose |
|-------|--------|---------|
| `app/api/repsly/config/route.ts` | GET/PUT | Read/save API credentials (mask key on GET) |
| `app/api/repsly/sync/route.ts` | POST | Manual sync — body: `{ type, mode: "test"\|"import" }` |
| `app/api/repsly/logs/route.ts` | GET | Return sync log history |

#### 6. `app/layout.tsx` — Add "Repsly" nav item between Routes and Admin

### Sync Logic

**Clients:** GET `/v3/export/clients/0` (paginate). Match to stores by `clientCode === store.placeId`. Update GPS/address only if blank.

**Visits:** GET `/v3/export/visits/{lastTimestamp}` (incremental). Store in blob. Deduplicate by `visitId`. These are "actuals" vs planned call cycles.

**Working Time:** GET `/v3/export/dailyworkingtime/{lastId}` (incremental). Store in blob. Deduplicate by `dailyWorkingTimeId`.

**Reps:** GET `/v3/export/representatives` (all, no pagination). Match to existing reps by code, update names/contact.

### Implementation Order
1. Types + data layer (`lib/types.ts`, `lib/repslyData.ts`)
2. API client (`lib/repslyApi.ts`)
3. Config API route (`app/api/repsly/config/route.ts`)
4. Sync API route (`app/api/repsly/sync/route.ts`)
5. Logs API route (`app/api/repsly/logs/route.ts`)
6. Integration page (`app/repsly/page.tsx`)
7. Nav item in layout

### No Code Written Yet
The plan was approved and codebase exploration completed (existing Clippa patterns + Bravo Perigee reference pattern analyzed). No files have been created or modified yet. Start from step 1 above.

---


