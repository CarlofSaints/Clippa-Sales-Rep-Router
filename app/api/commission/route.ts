import { NextRequest, NextResponse } from "next/server";
import { getCommissionSettings, saveCommissionSettings } from "@/lib/data";
import { commissionProblem, DEFAULT_COMMISSION, type CommissionSettings } from "@/lib/commission";
import { requireAdmin, getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await getCommissionSettings());
}

export async function PUT(request: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const next: CommissionSettings = {
    ...DEFAULT_COMMISSION,
    ...(await getCommissionSettings()),
    ratePercent: Number(body.ratePercent),
    thresholdMonthly: Number(body.thresholdMonthly),
    basis: body.basis,
    note: String(body.note ?? "").slice(0, 500),
  };

  // Validated server side as well as in the form, because this decides pay and
  // the form is not the only way to reach this route.
  const problem = commissionProblem(next);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const previous = await getCommissionSettings();
  const session = await getSession();
  next.updatedAt = new Date().toISOString();
  next.updatedBy = session?.name || session?.email || "Unknown";

  await saveCommissionSettings(next);

  // Logged with the OLD values as well as the new. "Someone changed the rate"
  // is not an answer anybody can act on six weeks later.
  logActivity({
    action: "Changed commission settings",
    actor: session?.email || "unknown",
    actorName: session?.name || "Unknown",
    summary: `Commission: ${previous.ratePercent}% over R${previous.thresholdMonthly.toLocaleString("en-ZA")} (${previous.basis}) changed to ${next.ratePercent}% over R${next.thresholdMonthly.toLocaleString("en-ZA")} (${next.basis})`,
    details: next.note || undefined,
  });

  return NextResponse.json(next);
}
