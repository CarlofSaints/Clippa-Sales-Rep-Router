import { NextResponse } from "next/server";
import { getReps, getStores, getRoutes, getChannels, getStoreOverrides } from "@/lib/data";
import { computeCapacity } from "@/lib/capacity";
import { requireSession } from "@/lib/auth";

export async function GET() {
  try {
    await requireSession();

    const [reps, stores, doc, channels, overrides] = await Promise.all([
      getReps(),
      getStores(),
      getRoutes(),
      getChannels(),
      getStoreOverrides(),
    ]);

    return NextResponse.json(computeCapacity(reps, stores, doc, channels, overrides));
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Rep capacity error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
