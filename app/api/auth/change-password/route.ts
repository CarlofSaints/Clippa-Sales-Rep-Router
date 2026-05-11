import { NextRequest, NextResponse } from "next/server";
import { getUsers, saveUsers } from "@/lib/data";
import { encodeSession } from "@/lib/auth";
import bcrypt from "bcryptjs";

export async function POST(request: NextRequest) {
  try {
    const { userId, newPassword } = await request.json();
    if (!userId || !newPassword || newPassword.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const users = await getUsers();
    const idx = users.findIndex((u) => u.id === userId);
    if (idx === -1) return NextResponse.json({ error: "User not found" }, { status: 404 });

    users[idx].password = await bcrypt.hash(newPassword, 10);
    users[idx].forcePasswordChange = false;
    await saveUsers(users);

    // Re-issue session cookie without forcePasswordChange
    const session = {
      userId: users[idx].id,
      email: users[idx].email,
      name: users[idx].name,
      role: users[idx].role,
      forcePasswordChange: false,
    };
    const token = encodeSession(session);
    const response = NextResponse.json({ ok: true });
    response.cookies.set("clippa_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
