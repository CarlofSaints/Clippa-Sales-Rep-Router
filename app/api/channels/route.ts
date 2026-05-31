import { NextRequest, NextResponse } from "next/server";
import { getChannels, saveChannels } from "@/lib/data";
import { Channel, FrequencyType } from "@/lib/types";

export async function GET() {
  try {
    const channels = await getChannels();
    return NextResponse.json(channels);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, frequency, duration } = body as Partial<Channel> & { id: string };

    const channels = await getChannels();
    const idx = channels.findIndex((c) => c.id === id);
    if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (name) channels[idx].name = name;
    if (frequency) channels[idx].frequency = frequency as FrequencyType;
    if (duration !== undefined) channels[idx].duration = duration;

    await saveChannels(channels);
    return NextResponse.json(channels[idx]);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const channels = await getChannels();
    const newChannel: Channel = {
      id: body.name.toLowerCase().replace(/[^a-z0-9]/g, "_"),
      name: body.name,
      frequency: body.frequency || "monthly",
      duration: body.duration || 30,
    };
    channels.push(newChannel);
    await saveChannels(channels);
    return NextResponse.json(newChannel, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    let channels = await getChannels();
    channels = channels.filter((c) => c.id !== id);
    await saveChannels(channels);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
