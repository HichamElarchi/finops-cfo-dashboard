import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireRole } from "@/lib/profile";

const FULL_SELECT =
  "id, created_at, client_id, department, project_id, model, prompt_tokens, completion_tokens, cost_usd, requested_model, mode_applied, routed, stop_loss_triggered, routing_reason, cost_without_proxy, cost_with_proxy, savings_usd, complexity";
const BASE_SELECT =
  "id, created_at, client_id, project_id, model, prompt_tokens, completion_tokens, cost_usd";

export async function GET() {
  const auth = await requireRole("cfo");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  }

  const client = createAdminSupabase() ?? (await createServerSupabase());
  const workspaceIds = [
    ...new Set(
      [auth.profile.workspaceId, ...auth.profile.memberships.map((item) => item.workspaceId)].filter(Boolean),
    ),
  ];

  const { data: workspace } = await client
    .from("workspaces")
    .select("name")
    .eq("id", auth.profile.workspaceId)
    .maybeSingle();

  const primary = await client
    .from("ai_requests")
    .select(FULL_SELECT)
    .in("workspace_id", workspaceIds)
    .order("created_at", { ascending: false })
    .limit(100);

  const result = primary.error
    ? await client
        .from("ai_requests")
        .select(BASE_SELECT)
        .in("workspace_id", workspaceIds)
        .order("created_at", { ascending: false })
        .limit(100)
    : primary;

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 400 });
  }

  return NextResponse.json({
    rows: result.data ?? [],
    workspace_name: workspace?.name ?? null,
  });
}
