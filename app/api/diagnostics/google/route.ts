import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";

/**
 * Is Google actually answering us?
 *
 * This exists because the question "is the Maps key still working" could not be
 * answered from outside the running app: `GOOGLE_MAPS_API_KEY` is marked
 * Sensitive in Vercel, so `vercel env pull` returns it BLANK, and an empty value
 * is not proof the variable is unset. The only place that can test the key is a
 * process that already holds it.
 *
 * Both APIs the router depends on are exercised for real, with a known address
 * and a known pair of coordinates, so a green result means the calls the route
 * engine makes would succeed — not merely that a key exists.
 *
 * ⚠️ Nothing here echoes the key. It reports its length and last four characters
 * so two environments can be told apart, and nothing more.
 */

export const maxDuration = 30;
export const dynamic = "force-dynamic";

// A full street address, not a landmark. "Sandton City, Sandton, South Africa"
// came back APPROXIMATE on the first live run: Google matched the SUBURB, not
// the mall, because a place name is not an address. A numbered street address is
// what the rep home-address flow actually sends, so it is what this should test.
const TEST_ADDRESS = "5 Alice Lane, Sandton, 2196, South Africa";
// Sandton -> Pretoria. Far enough apart that a real road route is unmistakable.
const TEST_ORIGIN = "-26.1076,28.0567";
const TEST_DESTINATION = "-25.7479,28.2293";

interface CheckResult {
  name: string;
  ok: boolean;
  status: string;
  ms: number;
  detail: string;
  /** What to actually do about it, when it failed. */
  fix?: string;
}

/** Google's status strings say what went wrong; this says what to do about it. */
function explain(status: string, errorMessage?: string): string {
  switch (status) {
    case "REQUEST_DENIED":
      return errorMessage?.toLowerCase().includes("not authorized") ||
        errorMessage?.toLowerCase().includes("api")
        ? "This API is not enabled on the Google Cloud project, or the key is restricted away from it. Enable it under APIs & Services, and check the key's API restrictions."
        : "Google refused the key. Check it has not been deleted or regenerated, and that its application restrictions are set to None — server calls send no referrer and Vercel has no fixed IP.";
    case "OVER_QUERY_LIMIT":
      return "The key is valid but out of quota, or billing has lapsed on the Google Cloud project. Check the billing account first — a card that expired shows up here.";
    case "ZERO_RESULTS":
      return "The API answered normally but found nothing for the test input. The key is working.";
    case "INVALID_REQUEST":
      return "The key works; the test request was malformed. This is a bug in the check, not in your Google account.";
    case "UNKNOWN_ERROR":
      return "A transient fault on Google's side. Run the check again before doing anything.";
    default:
      return errorMessage || "Google returned a status this check does not recognise.";
  }
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T | null; ms: number; error?: string }> {
  const started = Date.now();
  try {
    const value = await fn();
    return { value, ms: Date.now() - started };
  } catch (err) {
    return { value: null, ms: Date.now() - started, error: String(err) };
  }
}

export async function GET() {
  try {
    await requirePermission("manage_reps");

    const key = process.env.GOOGLE_MAPS_API_KEY || "";
    const checks: CheckResult[] = [];

    if (!key) {
      return NextResponse.json({
        keyPresent: false,
        keyHint: null,
        healthy: false,
        headline: "No Google Maps key is set on this deployment.",
        detail:
          "Route generation still works — it falls back to straight-line distances instead of road routes — but addresses cannot be geocoded at all. Set GOOGLE_MAPS_API_KEY in Vercel and redeploy.",
        checks,
        checkedAt: new Date().toISOString(),
      });
    }

    // ── Geocoding: what turns a rep's home address into coordinates ────────
    const geo = await timed(async () => {
      const url =
        `https://maps.googleapis.com/maps/api/geocode/json` +
        `?address=${encodeURIComponent(TEST_ADDRESS)}&region=za&key=${key}`;
      const res = await fetch(url, { cache: "no-store" });
      return (await res.json()) as {
        status?: string;
        error_message?: string;
        results?: { formatted_address?: string; geometry?: { location_type?: string } }[];
      };
    });

    if (geo.error || !geo.value) {
      checks.push({
        name: "Geocoding API",
        ok: false,
        status: "NETWORK",
        ms: geo.ms,
        detail: geo.error || "No response from Google.",
        fix: "The request never reached Google. Check the deployment has outbound network access.",
      });
    } else {
      const status = geo.value.status || "UNKNOWN";
      const ok = status === "OK";
      const top = geo.value.results?.[0];
      // Precision is reported but does NOT fail the check. Google answering is
      // one question; how exactly it answered is another, and conflating them
      // would raise an alarm about a working key.
      const precision = top?.geometry?.location_type || "UNKNOWN";
      const precise = precision === "ROOFTOP" || precision === "RANGE_INTERPOLATED";
      checks.push({
        name: "Geocoding API",
        ok,
        status,
        ms: geo.ms,
        detail: ok
          ? `Resolved the test address to "${top?.formatted_address}" (${precision}).` +
            (precise
              ? " That is building-level precision, so typed home addresses can be saved automatically."
              : " ⚠️ That is only area-level precision. A typed home address this vague is deliberately NOT saved," +
                " because a suburb centroid looks identical to a real home once stored — the rep is asked to tap" +
                " \"Use my current location\" instead.")
          : geo.value.error_message || "Google did not return a result.",
        fix: ok ? undefined : explain(status, geo.value.error_message),
      });
    }

    // ── Directions: what orders each day's stops along real roads ─────────
    const dir = await timed(async () => {
      const url =
        `https://maps.googleapis.com/maps/api/directions/json` +
        `?origin=${TEST_ORIGIN}&destination=${TEST_DESTINATION}&key=${key}`;
      const res = await fetch(url, { cache: "no-store" });
      return (await res.json()) as {
        status?: string;
        error_message?: string;
        routes?: { legs?: { distance?: { text?: string }; duration?: { text?: string } }[] }[];
      };
    });

    if (dir.error || !dir.value) {
      checks.push({
        name: "Directions API",
        ok: false,
        status: "NETWORK",
        ms: dir.ms,
        detail: dir.error || "No response from Google.",
        fix: "The request never reached Google. Check the deployment has outbound network access.",
      });
    } else {
      const status = dir.value.status || "UNKNOWN";
      const ok = status === "OK";
      const leg = dir.value.routes?.[0]?.legs?.[0];
      checks.push({
        name: "Directions API",
        ok,
        status,
        ms: dir.ms,
        detail: ok
          ? `Routed Sandton to Pretoria: ${leg?.distance?.text} in ${leg?.duration?.text} by road.`
          : dir.value.error_message || "Google did not return a route.",
        fix: ok ? undefined : explain(status, dir.value.error_message),
      });
    }

    const healthy = checks.every((c) => c.ok);
    const failed = checks.filter((c) => !c.ok);

    return NextResponse.json({
      keyPresent: true,
      // Enough to tell two keys apart, not enough to use one.
      keyHint: `${key.length} characters, ending ${key.slice(-4)}`,
      healthy,
      headline: healthy
        ? "Google Maps is up and answering both APIs the router uses."
        : `${failed.length} of ${checks.length} Google checks failed.`,
      detail: healthy
        ? "Addresses can be geocoded and days can be ordered along real roads."
        : "Route generation falls back to straight-line distances while this is broken, so plans stay usable but stop reflecting real driving.",
      checks,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Forbidden")) {
      return NextResponse.json({ error: "You do not have permission to run diagnostics." }, { status: 403 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
