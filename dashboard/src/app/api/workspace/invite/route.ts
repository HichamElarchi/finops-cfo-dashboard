import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/profile";
import { findInvitedAuthUser, registerInvitedDeveloper } from "@/lib/invite-email";

export async function POST(request: Request) {
  const auth = await requireRole("cfo");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await request.json()) as { email?: string };
  const email = (body.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Invalid developer email" }, { status: 400 });
  }

  const admin = createAdminSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Invite is not configured on the server." }, { status: 500 });
  }

  const payload = {
    workspace_id: auth.profile.workspaceId,
    email,
    role: "developer" as const,
    invited_by: auth.profile.userId,
    status: "pending" as const,
  };

  const { data: existing } = await admin
    .from("workspace_invites")
    .select("id")
    .eq("workspace_id", auth.profile.workspaceId)
    .ilike("email", email)
    .maybeSingle();

  let error = existing
    ? (
        await admin
          .from("workspace_invites")
          .update({ status: "pending", email, invited_by: auth.profile.userId })
          .eq("id", existing.id)
      ).error
    : (await admin.from("workspace_invites").insert(payload)).error;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const registered = await registerInvitedDeveloper({
    developerEmail: email,
    cfoEmail: auth.profile.email || "a CFO",
  });

  if (!registered.ok) {
    return NextResponse.json({
      ok: true,
      email,
      auth_registered: false,
      message: `Invite saved for ${email}, but they were not added to Auth. ${registered.error ?? ""}`.trim(),
    });
  }

  const { user } = await findInvitedAuthUser(email);
  if (user) {
    await admin.rpc("upsert_workspace_member", {
      p_workspace_id: auth.profile.workspaceId,
      p_user_id: user.id,
      p_email: email,
      p_role: "developer",
    });
    await admin
      .from("workspace_invites")
      .update({ status: "accepted" })
      .eq("workspace_id", auth.profile.workspaceId)
      .ilike("email", email);
  }

  return NextResponse.json({
    ok: true,
    email,
    auth_registered: true,
    message: `${email} is now linked to this CFO account. They can sign in on the Developer space.`,
  });
}

export async function DELETE(request: Request) {
  const auth = await requireRole("cfo");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await request.json()) as { email?: string };
  const email = (body.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Invalid developer email" }, { status: 400 });
  }

  const admin = createAdminSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Invite is not configured on the server." }, { status: 500 });
  }

  await admin
    .from("workspace_invites")
    .update({ status: "revoked" })
    .eq("workspace_id", auth.profile.workspaceId)
    .ilike("email", email);

  await admin
    .from("workspace_members")
    .delete()
    .eq("workspace_id", auth.profile.workspaceId)
    .eq("role", "developer")
    .eq("email", email);

  return NextResponse.json({ ok: true });
}
