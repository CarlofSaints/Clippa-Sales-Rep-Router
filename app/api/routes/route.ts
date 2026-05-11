import { NextRequest, NextResponse } from "next/server";
import { getRoutes, saveRoutes } from "@/lib/data";
import { RoutePlanDocument } from "@/lib/types";

export async function GET() {
  try {
    const routes = await getRoutes();
    return NextResponse.json(routes);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as RoutePlanDocument;
    await saveRoutes(body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await saveRoutes(null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
