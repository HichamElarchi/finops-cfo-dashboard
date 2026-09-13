import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/profile";

export async function POST(request: Request) {
  const auth = await requireRole("developer");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await request.json()) as { openrouter_api_key?: string };
  const key = (body.openrouter_api_key || "").trim();
  if (!key) {
    return NextResponse.json({ error: "OpenRouter key required" }, { status: 400 });
  }

  const admin = createAdminSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server is not configured to save keys." }, { status: 500 });
  }

  const { error } = await admin.from("workspace_credentials").upsert({
    workspace_id: auth.profile.workspaceId,
    openrouter_api_key: key,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
