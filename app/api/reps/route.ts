import { NextRequest, NextResponse } from "next/server";
import { getReps, saveReps } from "@/lib/data";
import { Rep } from "@/lib/types";

export async function GET() {
  try {
    const reps = await getReps();
    return NextResponse.json(reps);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body as Partial<Rep> & { id: string };

    const reps = await getReps();
    const idx = reps.findIndex((r) => r.id === id);
    if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });

    Object.assign(reps[idx], updates);
    await saveReps(reps);
    return NextResponse.json(reps[idx]);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const reps = await getReps();
    const newRep: Rep = {
      id: crypto.randomUUID(),
      code: body.code || "",
      name: body.name || "",
      email: body.email || "",
      cell: body.cell || "",
      homeAddress: body.homeAddress || "",
      homeGpsLat: body.homeGpsLat || "",
      homeGpsLng: body.homeGpsLng || "",
      teamId: body.teamId || "",
      workingHoursPerDay: body.workingHoursPerDay ?? 8.5,
    };
    reps.push(newRep);
    await saveReps(reps);
    return NextResponse.json(newRep, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    let reps = await getReps();
    reps = reps.filter((r) => r.id !== id);
    await saveReps(reps);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
