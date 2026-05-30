import { NextRequest, NextResponse } from "next/server";
import { getZones, saveZones } from "@/lib/data";
import { Zone } from "@/lib/types";

export async function GET() {
  try {
    const zones = await getZones();
    return NextResponse.json(zones);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description } = body as { name: string; description?: string };
    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const zones = await getZones();
    const newZone: Zone = {
      id: crypto.randomUUID(),
      name: name.trim(),
      description: description?.trim() || "",
    };
    zones.push(newZone);
    await saveZones(zones);
    return NextResponse.json(newZone, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, description } = body as Partial<Zone> & { id: string };

    const zones = await getZones();
    const idx = zones.findIndex((z) => z.id === id);
    if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (name !== undefined) zones[idx].name = name.trim();
    if (description !== undefined) zones[idx].description = description.trim();

    await saveZones(zones);
    return NextResponse.json(zones[idx]);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    let zones = await getZones();
    zones = zones.filter((z) => z.id !== id);
    await saveZones(zones);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
