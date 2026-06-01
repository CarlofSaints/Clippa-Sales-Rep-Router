import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getRepslySyncLog } from "@/lib/repslyData";

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const log = await getRepslySyncLog();
  return NextResponse.json(log);
}
