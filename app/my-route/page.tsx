"use client";

/**
 * A rep's own four-week call cycle, one day at a time.
 *
 * Read-only by design. Reps cannot plan or regenerate routes, and they are
 * kept out of /routes and /map because the data behind those pages is the
 * whole business. Everything here comes from /api/my-route, which only ever
 * returns the signed-in rep's own plan.
 */

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { dayTotals } from "@/lib/dayTotals";
import type { RouteDayPlan } from "@/lib/types";

const MyRouteMap = dynamic(() => import("@/components/MyRouteMap"), { ssr: false });

const WEEKS = ["Wk1", "Wk2", "Wk3", "Wk4"] as const;
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;

interface MyRouteResponse {
  rep: { code: string; name: string; hasHome: boolean } | null;
  generatedAt: string | null;
  plan: {
    homeLatLng: { lat: number; lng: number } | null;
    workingHoursPerDay: number;
    days: RouteDayPlan[];
  } | null;
  error?: string;
}

function fmtMinutes(m: number): string {
  const total = Math.round(m);
  const h = Math.floor(total / 60);
  const min = total % 60;
  if (h === 0) return `${min} min`;
  return min === 0 ? `${h} h` : `${h} h ${min} min`;
}

const at = (p: { lat: number; lng: number }) => `${p.lat},${p.lng}`;

/** Directions to one shop from wherever the rep is standing. Always works on a phone. */
function directionsTo(p: { lat: number; lng: number }) {
  return `https://www.google.com/maps/dir/?api=1&destination=${at(p)}&travelmode=driving`;
}

/**
 * The whole day in Google Maps, home to home. Google caps the waypoints a link
 * can carry, so a day longer than that opens with the first calls only and the
 * per-stop links below cover the rest.
 */
const MAX_WAYPOINTS = 9;
function directionsForDay(home: { lat: number; lng: number } | null, day: RouteDayPlan) {
  const stops = day.stops;
  if (stops.length === 0) return null;
  const params = new URLSearchParams({ api: "1", travelmode: "driving" });
  if (home) {
    params.set("origin", at(home));
    params.set("destination", at(home));
    const wp = stops.slice(0, MAX_WAYPOINTS).map(at);
    params.set("waypoints", wp.join("|"));
  } else {
    // No home: start from where they are, end at the last call.
    const last = stops[Math.min(stops.length, MAX_WAYPOINTS + 1) - 1];
    params.set("destination", at(last));
    const wp = stops.slice(0, Math.min(stops.length, MAX_WAYPOINTS + 1) - 1).map(at);
    if (wp.length) params.set("waypoints", wp.join("|"));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function todayWeekday(): (typeof DAYS)[number] {
  const i = new Date().getDay(); // 0 Sunday
  return i >= 1 && i <= 5 ? DAYS[i - 1] : "Monday";
}

export default function MyRoutePage() {
  const [data, setData] = useState<MyRouteResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [week, setWeek] = useState<(typeof WEEKS)[number]>("Wk1");
  const [day, setDay] = useState<(typeof DAYS)[number]>(todayWeekday());

  useEffect(() => {
    fetch("/api/my-route")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not load your route");
        setData(d);
      })
      .catch((e) => setLoadError(String(e.message || e)));
  }, []);

  const plan = data?.plan ?? null;
  const home = plan?.homeLatLng ?? null;

  const byKey = useMemo(() => {
    const m = new Map<string, RouteDayPlan>();
    for (const d of plan?.days ?? []) m.set(`${d.week}|${d.day}`, d);
    return m;
  }, [plan]);

  const current = byKey.get(`${week}|${day}`) ?? null;
  const totals = current ? dayTotals(current, home, plan?.workingHoursPerDay) : null;
  const dayLink = current ? directionsForDay(home, current) : null;

  if (loadError) {
    return <div className="p-6 text-sm text-red-600">{loadError}</div>;
  }
  if (!data) {
    return <div className="p-6 text-sm text-gray-500">Loading your route...</div>;
  }
  if (!data.rep) {
    return (
      <div className="p-6 text-sm text-gray-600">
        This login isn&apos;t linked to a rep, so there is no route to show.
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">My Route</h1>
        <p className="text-xs text-gray-500">
          Your four-week call cycle.
          {data.generatedAt &&
            ` Planned ${new Date(data.generatedAt).toLocaleDateString("en-ZA", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}.`}
        </p>
      </div>

      {!data.rep.hasHome && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <strong className="font-semibold">Your day isn&apos;t starting from home yet.</strong> We don&apos;t
          have your home pinned, so this route starts from the middle of your stores.{" "}
          <Link href="/account" className="font-semibold underline">
            Set your home
          </Link>
          .
        </div>
      )}

      {!plan ? (
        <div className="rounded-xl border border-gray-100 bg-white p-6 text-sm text-gray-600">
          No route has been planned for you yet. Your manager builds the routes; once they do, your
          calls will show here.
        </div>
      ) : (
        <>
          {/* Week, then day. Counts on each day so an empty day is obvious before tapping it. */}
          <div className="space-y-2">
            <div className="flex gap-1 overflow-x-auto">
              {WEEKS.map((w, i) => (
                <button
                  key={w}
                  onClick={() => setWeek(w)}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
                    week === w ? "bg-gray-900 text-white" : "bg-white text-gray-700 border border-gray-200"
                  }`}
                >
                  Week {i + 1}
                </button>
              ))}
            </div>
            <div className="flex gap-1 overflow-x-auto">
              {DAYS.map((d) => {
                const n = byKey.get(`${week}|${d}`)?.stops.length ?? 0;
                return (
                  <button
                    key={d}
                    onClick={() => setDay(d)}
                    className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${
                      day === d
                        ? "bg-clippa-red text-white font-medium"
                        : "bg-white text-gray-700 border border-gray-200"
                    }`}
                  >
                    {d.slice(0, 3)} <span className="opacity-75">({n})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {!current || current.stops.length === 0 ? (
            <div className="rounded-xl border border-gray-100 bg-white p-6 text-sm text-gray-600">
              No calls planned for {day}, week {WEEKS.indexOf(week) + 1}.
            </div>
          ) : (
            <>
              {totals && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Stat label="Calls" value={String(totals.stops)} />
                  <Stat
                    label="Day"
                    value={
                      totals.leaveHome && totals.arriveHome
                        ? `${totals.leaveHome} to ${totals.arriveHome}`
                        : totals.leaveHome
                          ? `From ${totals.leaveHome}`
                          : "-"
                    }
                  />
                  <Stat label="Driving" value={`${Math.round(totals.distanceKm)} km`} />
                  <Stat label="Time on the road" value={fmtMinutes(totals.travelMinutes)} />
                </div>
              )}

              {dayLink && (
                <a
                  href={dayLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-clippa-red px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                >
                  Open the day in Google Maps
                </a>
              )}
              {current.stops.length > MAX_WAYPOINTS && (
                <p className="text-xs text-gray-500">
                  Google Maps takes {MAX_WAYPOINTS} stops at a time, so use the Directions link on each call
                  after that.
                </p>
              )}

              <div className="h-[320px] sm:h-[420px] overflow-hidden rounded-xl border border-gray-100">
                <MyRouteMap
                  home={home}
                  stops={current.stops}
                  polyline={current.polyline}
                  fitKey={`${week}|${day}`}
                />
              </div>

              <div className="rounded-xl border border-gray-100 bg-white divide-y divide-gray-100">
                {home && totals?.leaveHome && (
                  <Row title="Leave home" sub={totals.leaveHome} />
                )}
                {current.stops.map((s, i) => (
                  <div key={`${s.storeId}-${i}`} className="flex items-center gap-3 p-3">
                    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-clippa-red text-xs font-bold text-white">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-gray-900">{s.storeName}</div>
                      <div className="text-xs text-gray-500">
                        {s.arrivalTime} to {s.departureTime} · {Math.round(s.distanceFromPrev)} km,{" "}
                        {fmtMinutes(s.travelTimeFromPrev)} drive
                      </div>
                    </div>
                    <a
                      href={directionsTo(s)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0 rounded border border-gray-200 px-2 py-1 text-xs font-medium text-clippa-red hover:bg-gray-50"
                    >
                      Directions
                    </a>
                  </div>
                ))}
                {home && totals?.returnKm != null && (
                  <Row
                    title="Back home"
                    sub={`${totals.arriveHome ?? ""} · ${Math.round(totals.returnKm)} km, ${fmtMinutes(
                      totals.returnMinutes ?? 0
                    )} drive`}
                  />
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-white p-3">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="text-sm font-semibold text-gray-900 tabular-nums">{value}</div>
    </div>
  );
}

function Row({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 p-3 bg-gray-50">
      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gray-900">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinejoin="round" aria-hidden="true">
          <path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z" />
        </svg>
      </span>
      <div>
        <div className="text-sm font-medium text-gray-900">{title}</div>
        <div className="text-xs text-gray-500">{sub}</div>
      </div>
    </div>
  );
}
