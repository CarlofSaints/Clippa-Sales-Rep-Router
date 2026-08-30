/**
 * Assertions for what a store upload is allowed to overwrite.
 *
 * Run: npx tsx scripts/check-upload-scope.ts
 *
 * This bug has bitten three times in the same file — sales, then channel, then
 * GPS — and every time it was silent: a column quietly emptied and nobody
 * noticed until a report came back wrong. Most of these assert that a field is
 * NOT writable, because that is the direction that loses data.
 */

import { uploadScope } from "../lib/uploadScope";

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`PASS  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

// A full export: everything is in scope.
{
  const s = uploadScope([
    "PLACE ID", "PLACE NAME", "CHANNEL", "PROVINCE", "REGION",
    "GPS LATITUDE", "GPS LONGITUDE", "REPRESENTATIVE ID", "MONTHLY AVERAGE",
  ]);
  ok("a full export may write sales", s.hasSales);
  ok("a full export may write channel", s.hasChannel);
  ok("a full export may write GPS", s.hasGps);
  ok("a full export may write the rep", s.hasRep);
}

// The sheet that caused the damage: names and reps only.
{
  const s = uploadScope(["PLACE ID", "PLACE NAME", "REPRESENTATIVE ID"]);
  ok("a thin sheet may NOT write sales", !s.hasSales);
  ok("a thin sheet may NOT write channel", !s.hasChannel,
    "this is what blanked every CPT store's channel");
  ok("a thin sheet may NOT write GPS", !s.hasGps,
    "this is what blanked their coordinates");
  ok("a thin sheet WITH a rep column may write the rep", s.hasRep,
    "the whole point of this sheet is the allocation");
}

// GPS needs BOTH halves.
{
  ok("latitude alone does not authorise a GPS write",
    !uploadScope(["PLACE ID", "GPS LATITUDE"]).hasGps,
    "a latitude without its longitude is a broken store, not a half-updated one");
  ok("longitude alone does not either",
    !uploadScope(["PLACE ID", "GPS LONGITUDE"]).hasGps);
  ok("both together do", uploadScope(["GPS LATITUDE", "GPS LONGITUDE"]).hasGps);
}

// Header spellings actually seen in the wild.
{
  ok("the Repsly export's coordinate headers are recognised",
    uploadScope(["ID", "Name", "Gps latitude", "Gps longitude"]).hasGps);
  ok("the Repsly Tags column counts as a channel column",
    uploadScope(["ID", "Name", "Tags"]).hasChannel,
    "Repsly carries the channel in the first tag");
  ok("underscored headers are recognised",
    uploadScope(["GPS_LATITUDE", "GPS_LONGITUDE"]).hasGps);
  ok("bare Latitude/Longitude are recognised",
    uploadScope(["Latitude", "Longitude"]).hasGps);
  ok("the app's own export header set round-trips",
    uploadScope(["PLACE ID", "PLACE NAME", "CHANNEL", "GPS LATITUDE", "GPS LONGITUDE"]).hasChannel);
}

// Case and whitespace must not decide whether data survives.
{
  ok("casing does not matter", uploadScope(["channel"]).hasChannel);
  ok("padding does not matter", uploadScope(["  CHANNEL  "]).hasChannel);
  ok("mixed case coordinates are recognised",
    uploadScope([" gps latitude ", "GPS Longitude"]).hasGps);
}

// Nothing at all.
{
  const s = uploadScope([]);
  ok("an empty header list authorises nothing",
    !s.hasSales && !s.hasChannel && !s.hasGps && !s.hasRep,
    "an unreadable file must not be treated as an instruction to clear everything");
}

// The rep code: the fourth sibling in the same write block, guarded last.
{
  ok("a sheet with no rep column may NOT write the rep",
    !uploadScope(["PLACE ID", "PLACE NAME", "CHANNEL"]).hasRep,
    "unguarded, this set every store it touched to an empty rep code, which reads as belonging to nobody");
  ok("a GPS-only correction sheet may NOT write the rep",
    !uploadScope(["PLACE ID", "GPS LATITUDE", "GPS LONGITUDE"]).hasRep,
    "the round trip for the 1 901 bad coordinates must not un-assign every store it fixes");
  ok("REP CODE is recognised", uploadScope(["REP CODE"]).hasRep);
  ok("the Repsly spelling is recognised", uploadScope(["Representative ID"]).hasRep);
  ok("case and padding do not matter", uploadScope(["  rep code  "]).hasRep);
  ok("'Rep Name' alone is not a rep-code column", !uploadScope(["Rep Name"]).hasRep,
    "a name cannot address a rep, and substring matching here would re-create the bug");
}

// A near-miss header must not be mistaken for the real one.
{
  ok("'Channel Manager' is not a channel column", !uploadScope(["Channel Manager"]).hasChannel);
  ok("'Latitude Notes' is not a coordinate column", !uploadScope(["Latitude Notes", "Longitude Notes"]).hasGps);
  ok("'Sales Rep' is not a sales column", !uploadScope(["Sales Rep"]).hasSales,
    "substring matching here would re-create the original bug");
}

// 🔴 No Repsly export carries a closed column, so an upload must never be able
// to reopen a shop IMS said was shut and put it back into the call cycles.
{
  const repsly = ["ID", "Name", "Active", "Tags", "Representative ID", "Gps latitude", "Gps longitude", "Status"];
  ok("a Places export cannot write the closed flag", uploadScope(repsly).hasClosed === false);
  const schedule = ["Schedule ID", "Place ID", "Representative ID", "Place name"];
  ok("a Schedule export cannot write the closed flag", uploadScope(schedule).hasClosed === false);
  ok("only an explicit Closed column would enable it",
    uploadScope([...repsly, "Closed"]).hasClosed === true);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
