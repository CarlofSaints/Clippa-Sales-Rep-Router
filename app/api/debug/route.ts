import { NextResponse } from "next/server";
import { getUsers } from "@/lib/data";
import bcrypt from "bcryptjs";

export async function GET() {
  try {
    const users = await getUsers();
    const testPassword = "clippa2026";

    const results = await Promise.all(
      users.map(async (u) => {
        const match = await bcrypt.compare(testPassword, u.password);
        return {
          name: u.name,
          email: u.email,
          role: u.role,
          passwordHashLength: u.password?.length ?? 0,
          passwordStartsWith: u.password?.substring(0, 7) ?? "EMPTY",
          matchesClippa2026: match,
        };
      })
    );

    return NextResponse.json({
      userCount: users.length,
      users: results,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
