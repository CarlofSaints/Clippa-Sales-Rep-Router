import { NextRequest, NextResponse } from "next/server";
import { verifyToken, sessionSecret } from "@/lib/sessionToken";

// /api/seed and /api/debug used to be listed here. /api/seed calls saveUsers()
// with a single-element array, so any anonymous POST wiped the user table and
// reset the admin to a password held in the repo; /api/debug returned
// users.json. Both are now behind the session check.
const PUBLIC_PATHS = ["/login", "/api/auth"];

// Bootstrapping a brand-new deploy is a chicken-and-egg problem: /api/seed
// creates the first admin, so there is no session cookie to present yet.
// Rather than make the route blanket-public, a CRON_SECRET bearer gets it past
// the middleware. The route should verify the same bearer itself, so this is a
// second gate rather than the only one.
const BEARER_PATHS = ["/api/seed"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths and static assets
  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.match(/\.(jpg|png|svg|ico|css|js)$/)
  ) {
    return NextResponse.next();
  }

  const cronSecret = process.env.CRON_SECRET;
  if (
    BEARER_PATHS.some((p) => pathname.startsWith(p)) &&
    !!cronSecret &&
    request.headers.get("authorization") === `Bearer ${cronSecret}`
  ) {
    return NextResponse.next();
  }

  // Verify the SIGNATURE, not just that a cookie is present. Plenty of read
  // routes (GET /api/stores, /api/reps, /api/teams…) never call getSession(),
  // so this is the only thing standing in front of them — a presence check
  // would let a hand-written cookie read the whole database.
  const token = request.cookies.get("clippa_session")?.value;
  const session = token ? await verifyToken(token, sessionSecret()) : null;
  if (!session) {
    // API callers get a 401 they can actually read; page loads get the login
    // screen. Redirecting an API POST to /login returns HTML with a 200 and
    // reads like success to anything parsing the response.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
