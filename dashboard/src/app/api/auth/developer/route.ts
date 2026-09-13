import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { findInvitedAuthUser } from "@/lib/invite-email";

export async function POST(request: Request) {
  const body = (await request.json()) as { email?: string; password?: string };
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  if (!email || !email.includes("@") || password.length < 6) {
    return NextResponse.json({ error: "Enter the invited email and a password (6+ characters)." }, { status: 400 });
  }

  const admin = createAdminSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Developer sign-up is not configured on the server." }, { status: 500 });
  }

  const { data: invite, error: inviteError } = await admin
    .from("workspace_invites")
    .select("id, status")
    .eq("role", "developer")
    .ilike("email", email)
    .in("status", ["pending", "accepted"])
    .limit(1)
    .maybeSingle();

  if (inviteError) {
    return NextResponse.json({ error: inviteError.message }, { status: 400 });
  }
  if (!invite) {
    return NextResponse.json(
      { error: "This email has not been invited. Ask your CFO to invite you first." },
      { status: 403 },
    );
  }

  const { user } = await findInvitedAuthUser(email);

  if (!user) {
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: "developer", password_set: true },
    });
    if (created.error || !created.data.user) {
      return NextResponse.json(
        { error: created.error?.message || "Could not create the developer account." },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true });
  }

  if (user.user_metadata?.password_set === true) {
    return NextResponse.json(
      { error: "This developer account already exists. Sign in instead." },
      { status: 409 },
    );
  }

  const updated = await admin.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
    user_metadata: { ...(user.user_metadata ?? {}), role: "developer", password_set: true },
  });
  if (updated.error) {
    return NextResponse.json({ error: updated.error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
