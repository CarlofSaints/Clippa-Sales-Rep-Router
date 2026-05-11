import { NextRequest, NextResponse } from "next/server";
import { getUsers, saveUsers } from "@/lib/data";
import { User, UserRole } from "@/lib/types";
import bcrypt from "bcryptjs";

export async function GET() {
  try {
    const users = await getUsers();
    const safe = users.map(({ password: _, ...u }) => u);
    return NextResponse.json(safe);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, password, role } = body;

    if (!name || !email || !password) {
      return NextResponse.json({ error: "Name, email and password required" }, { status: 400 });
    }

    const users = await getUsers();
    if (users.find((u) => u.email.toLowerCase() === email.toLowerCase())) {
      return NextResponse.json({ error: "Email already exists" }, { status: 409 });
    }

    const hashed = await bcrypt.hash(password, 10);
    const newUser: User = {
      id: crypto.randomUUID(),
      name,
      email,
      password: hashed,
      role: (role as UserRole) || "viewer",
      forcePasswordChange: body.forcePasswordChange ?? false,
    };
    users.push(newUser);
    await saveUsers(users);

    const { password: _, ...safe } = newUser;
    return NextResponse.json(safe, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, email, role, password, forcePasswordChange } = body;

    const users = await getUsers();
    const idx = users.findIndex((u) => u.id === id);
    if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (name) users[idx].name = name;
    if (email) users[idx].email = email;
    if (role) users[idx].role = role as UserRole;
    if (password) users[idx].password = await bcrypt.hash(password, 10);
    if (forcePasswordChange !== undefined) users[idx].forcePasswordChange = forcePasswordChange;

    await saveUsers(users);
    const { password: _, ...safe } = users[idx];
    return NextResponse.json(safe);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    let users = await getUsers();
    users = users.filter((u) => u.id !== id);
    await saveUsers(users);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
