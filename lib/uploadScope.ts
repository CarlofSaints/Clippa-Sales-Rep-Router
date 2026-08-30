/**
 * Which fields a store upload is allowed to touch.
 *
 * The rule is one line and this app has got it wrong three times: **presence of
 * the COLUMN decides scope**. A file that does not carry a column must leave that
 * field alone, not overwrite it with the empty string.
 *
 * 🔴 Getting it wrong is silent and unrecoverable. `existing.monthlySales = sales`
 * zeroed the sales figure on every row of any sheet without the column. The same
 * shape sat on `channelId`, `gpsLat` and `gpsLng` for months after the sales half
 * was fixed — which is the real lesson: when one field in a write block has this
 * bug, every sibling in the same block has it too. Fix them together.
 *
 * Lives here rather than inline in the route so it can be asserted directly,
 * because the failure it prevents is invisible until somebody notices a column
 * has quietly emptied.
 */

export interface UploadScope {
  /** The file carries a sales column, so sales may be written. */
  hasSales: boolean;
  /** The file carries a channel column, so channel may be written. */
  hasChannel: boolean;
  /** The file carries BOTH coordinate columns, so GPS may be written. */
  hasGps: boolean;
  /**
   * The file carries a rep column, so the store's rep may be written.
   *
   * The fourth sibling in the same write block, and the one left behind when the
   * other three were fixed. Unguarded, a sheet with no rep column set every
   * store it touched to `repCode: ""`, which does not look like damage anywhere:
   * the store keeps its name, channel, sales and coordinates, and simply stops
   * belonging to anybody. It then disappears from that rep's map, their routes
   * and every capacity figure, and Data Health reports it under a heading about
   * rep codes rather than about the upload.
   */
  hasRep: boolean;
  /**
   * Whether the file can say a store is closed.
   *
   * 🔴 Always FALSE today, and that is the point. No Repsly export carries a
   * closed column, so an upload must never touch the flag — otherwise the next
   * Places load quietly reopens every shop IMS said was shut and puts them all
   * back in the call cycles. This is the fifth sibling in that write block; the
   * previous four each shipped unguarded first.
   */
  hasClosed: boolean;
}

const SALES_HEADERS = [
  "MONTHLY AVERAGE", "VALUE", "Value", "Monthly Average", "Sales",
  "SIX MONTH SALES", "6 MONTH SALES",
];

const CHANNEL_HEADERS = ["CHANNEL", "Channel", "CHANNEL NAME", "Channel Name", "Tags"];

/** Every spelling the route already accepts when it reads the rep off a row. */
const REP_HEADERS = ["REPRESENTATIVE ID", "REP CODE", "Rep Code", "Representative ID"];

/** Nothing Repsly exports matches these. Named so the intent is searchable. */
const CLOSED_HEADERS = ["CLOSED", "Closed", "CLOSED STATUS", "Closed Status"];

const LAT_HEADERS = ["GPS LATITUDE", "Gps latitude", "Gps Latitude", "GPS_LATITUDE", "Latitude"];
const LNG_HEADERS = ["GPS LONGITUDE", "Gps longitude", "Gps Longitude", "GPS_LONGITUDE", "Longitude"];

/** Case and whitespace insensitive: exported headers vary between Repsly and Excel. */
function present(headers: string[], candidates: string[]): boolean {
  const norm = (h: string) => h.trim().toLowerCase();
  const set = new Set(headers.map(norm));
  return candidates.some((c) => set.has(norm(c)));
}

export function uploadScope(fileHeaders: string[]): UploadScope {
  return {
    hasSales: present(fileHeaders, SALES_HEADERS),
    hasChannel: present(fileHeaders, CHANNEL_HEADERS),
    // ⚠️ BOTH, deliberately. A latitude written without its longitude is not a
    // half-updated store, it is a broken one, and coordinates move as a pair
    // everywhere else in this app.
    hasGps: present(fileHeaders, LAT_HEADERS) && present(fileHeaders, LNG_HEADERS),
    hasRep: present(fileHeaders, REP_HEADERS),
    hasClosed: present(fileHeaders, CLOSED_HEADERS),
  };
}
