import { NextRequest, NextResponse } from "next/server";
import { getUsers, saveUsers } from "@/lib/data";
import { requirePermission } from "@/lib/auth";
import { sendWelcomeEmail } from "@/lib/welcomeEmail";
import { generateTempPassword } from "@/lib/tempPassword";
import { logActivity } from "@/lib/activityLog";
import bcrypt from "bcryptjs";

/**
 * 🔴 This route MINTS a new password for a user and overwrites the old one, then
 * returns the new password in the response body — and it was gated only by "are
 * you signed in". Any account, a viewer included, could reset an administrator's
 * password and read it straight back. It now needs `manage_users`.
 *
 * It stays deliberately different from POST /api/users, which mails the password
 * the admin typed and resets nothing. This one rotates, which is why it must
 * never be fired at a live account casually.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requirePermission("manage_users");
    const { userId } = await request.json();
    const users = await getUsers();
    const user = users.find((u) => u.id === userId);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // A CSPRNG, not Math.random(): predictable across a batch is not survivable
    // once this is used for more than one account at a time.
    const tempPassword = generateTempPassword();
    const idx = users.findIndex((u) => u.id === userId);
    users[idx].password = await bcrypt.hash(tempPassword, 10);
    users[idx].forcePasswordChange = true;
    await saveUsers(users);

    // A rep gets the rep-flavoured mail wherever the resend is fired from, so a
    // rep who lost their password is not sent instructions for an app they
    // cannot reach.
    const result = await sendWelcomeEmail({
      name: user.name,
      email: user.email,
      password: tempPassword,
      forcePasswordChange: true,
      audience: user.role === "rep" ? "rep" : "admin",
    });

    logActivity({
      action: "Reset password and resent welcome",
      actor: session?.email || "unknown",
      actorName: session?.name || "Unknown",
      summary: `Reset ${user.name} (${user.email}) and ${result.sent ? "emailed" : "failed to email"} new credentials`,
    });

    if (result.sent) return NextResponse.json({ ok: true, sent: true });

    // The password only comes back when the mail did NOT go, so it can be
    // shared by hand. On success it is in the recipient's inbox and a copy on an
    // admin's screen is one nobody needs.
    return NextResponse.json({
      ok: true,
      sent: false,
      tempPassword,
      email: user.email,
      message: result.reason,
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg.includes("Forbidden")) {
      return NextResponse.json({ error: "You do not have permission to manage users." }, { status: 403 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
