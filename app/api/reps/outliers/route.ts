import { NextRequest, NextResponse } from "next/server";
import { getReps, getStores, getChannels, getSettings } from "@/lib/data";
import { computeOutliers } from "@/lib/outliers";
import { requireSession } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    await requireSession();

    const param = request.nextUrl.searchParams.get("radiusKm");
    const [reps, stores, channels, settings] = await Promise.all([
      getReps(),
      getStores(),
      getChannels(),
      getSettings(),
    ]);

    const parsed = param != null ? Number(param) : NaN;
    const radiusKm = !isNaN(parsed) && parsed > 0 ? Math.round(parsed) : settings.outlierRadiusKm;

    const result = computeOutliers(reps, stores, radiusKm);
    const channelName = new Map(channels.map((c) => [c.id, c.name]));
    const withChannel = result.stores.map((s) => ({
      ...s,
      channel: channelName.get(s.channelId) || s.channelId || "",
    }));

    return NextResponse.json({ ...result, stores: withChannel });
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Outliers error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
