import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireProfile, type WorkspaceRole } from "@/lib/profile";
import { publicProxyBaseUrl } from "@/lib/proxy-url";

export async function GET(request: Request) {
  const space = new URL(request.url).searchParams.get("space") as WorkspaceRole | null;
  const auth = await requireProfile(space ? { role: space } : undefined);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  }

  const supabase = await createServerSupabase();
  const { profile } = auth;

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name, trial_ends_at, subscription_status")
    .eq("id", profile.workspaceId)
    .maybeSingle();

  const { data: credentials } = await supabase
    .from("workspace_credentials")
    .select("openrouter_api_key")
    .eq("workspace_id", profile.workspaceId)
    .maybeSingle();

  const { data: proxyKey } = await supabase
    .from("proxy_api_keys")
    .select("key_prefix")
    .eq("workspace_id", profile.workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const hasOpenRouterKey = Boolean(credentials?.openrouter_api_key);
  const invites =
    profile.role === "cfo"
      ? (
          await supabase
            .from("workspace_invites")
            .select("id, email, role, status, created_at")
            .eq("workspace_id", profile.workspaceId)
            .in("status", ["pending", "accepted"])
            .order("created_at", { ascending: false })
        ).data ?? []
      : [];

  const selected = profile.memberships.find((item) => item.workspaceId === profile.workspaceId);
  const developerQuery = await supabase
    .from("workspace_members")
    .select("email, role, user_id")
    .eq("workspace_id", profile.workspaceId)
    .eq("role", "developer")
    .order("created_at", { ascending: false });
  const developers = profile.role === "cfo" && !developerQuery.error ? developerQuery.data ?? [] : [];

  return NextResponse.json({
    email: profile.email,
    role: profile.role,
    workspace_id: profile.workspaceId,
    workspace_name: workspace?.name ?? selected?.workspaceName ?? null,
    cfo_email: selected?.cfoEmail ?? (profile.role === "cfo" ? profile.email : null),
    trial_ends_at: workspace?.trial_ends_at ?? null,
    subscription_status: workspace?.subscription_status ?? "trialing",
    has_openrouter_key: hasOpenRouterKey,
    openrouter_key_masked: hasOpenRouterKey ? "sk-or-••••••••" : null,
    proxy_key_prefix: proxyKey?.key_prefix ?? null,
    proxy_base_url: publicProxyBaseUrl(),
    invites,
    developers,
    memberships: profile.memberships,
  });
}
