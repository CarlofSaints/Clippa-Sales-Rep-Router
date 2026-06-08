import { NextRequest, NextResponse } from "next/server";
import { getChannels, saveChannels } from "@/lib/data";
import { Channel, FrequencyType } from "@/lib/types";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";

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

    const session = await getSession();
    logActivity({ action: "Updated channel", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Updated channel ${channels[idx].name}` });

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

    const session = await getSession();
    logActivity({ action: "Created channel", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Created channel ${newChannel.name}` });

    return NextResponse.json(newChannel, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    const channels = await getChannels();
    const target = channels.find((c) => c.id === id);
    const filtered = channels.filter((c) => c.id !== id);
    await saveChannels(filtered);

    const session = await getSession();
    logActivity({ action: "Deleted channel", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: `Deleted channel ${target?.name || id}` });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
