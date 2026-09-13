import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/profile";

export async function POST() {
  const auth = await requireRole("developer");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const admin = createAdminSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured to save keys." }, { status: 500 });
  }

  const plaintext = `pk_live_${randomBytes(24).toString("hex")}`;
  const keyHash = createHash("sha256").update(plaintext).digest("hex");
  const keyPrefix = `${plaintext.slice(0, 12)}…`;

  await admin.from("proxy_api_keys").delete().eq("workspace_id", auth.profile.workspaceId);

  const { error } = await admin.from("proxy_api_keys").insert({
    workspace_id: auth.profile.workspaceId,
    key_hash: keyHash,
    key_prefix: keyPrefix,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ proxy_api_key: plaintext, key_prefix: keyPrefix });
}

export async function GET() {
  const auth = await requireRole("developer");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const admin = createAdminSupabase();
  const client = admin;
  if (!client) {
    return NextResponse.json({ key_prefix: null });
  }
  const { data } = await client
    .from("proxy_api_keys")
    .select("key_prefix")
    .eq("workspace_id", auth.profile.workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ key_prefix: data?.key_prefix ?? null });
}
