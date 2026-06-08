import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, getSession } from "@/lib/auth";
import { getRepslyConfig, saveRepslyConfig } from "@/lib/repslyData";
import { testConnection } from "@/lib/repslyApi";
import { logActivity } from "@/lib/activityLog";

// GET — return config (mask API key)
export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await getRepslyConfig();
  return NextResponse.json({
    ...config,
    apiKey: config.apiKey ? `${config.apiKey.substring(0, 4)}${"*".repeat(Math.max(0, config.apiKey.length - 4))}` : "",
    apiPasscode: config.apiPasscode ? "********" : "",
  });
}

// PUT — save config + optional connection test
export async function PUT(request: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { apiKey, apiPasscode, enabled, test } = body;

  const config = await getRepslyConfig();

  // Only update fields that were provided
  if (apiKey !== undefined) config.apiKey = apiKey;
  if (apiPasscode !== undefined) config.apiPasscode = apiPasscode;
  if (enabled !== undefined) config.enabled = enabled;

  // Test connection if requested
  if (test) {
    const result = await testConnection(config.apiKey, config.apiPasscode);
    if (!result.ok) {
      return NextResponse.json({ error: result.error, tested: true, connected: false }, { status: 200 });
    }
    // Save only on successful test
    await saveRepslyConfig(config);
    return NextResponse.json({ tested: true, connected: true });
  }

  await saveRepslyConfig(config);

  const session = await getSession();
  logActivity({ action: "Updated Repsly config", actor: session?.email || "unknown", actorName: session?.name || "Unknown", summary: "Updated Repsly API configuration" });

  return NextResponse.json({ ok: true });
}
