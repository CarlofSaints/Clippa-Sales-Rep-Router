import { NextRequest, NextResponse } from "next/server";
import { validateCredentials, encodeSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    const session = await validateCredentials(email, password);
    if (!session) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const token = encodeSession(session);
    const response = NextResponse.json({ ok: true, user: session });
    response.cookies.set("clippa_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
    return response;
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("clippa_session", "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  return response;
}
