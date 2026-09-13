import { cookies } from "next/headers";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type WorkspaceRole = "cfo" | "developer";

export interface WorkspaceMembership {
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
  cfoEmail: string | null;
}

export interface WorkspaceProfile {
  userId: string;
  email: string | null;
  workspaceId: string;
  role: WorkspaceRole;
  memberships: WorkspaceMembership[];
}

export type ProfileResult =
  | { ok: true; profile: WorkspaceProfile }
  | { ok: false; status: number; error: string; code?: string };

const SPACE_COOKIE = "finops_space";
const WORKSPACE_COOKIE = "finops_workspace_id";

const cookieSettings = {
  path: "/",
  sameSite: "lax" as const,
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 365,
};

function profileQueryHasError(result: { error: { message: string } | null }) {
  return Boolean(result.error);
}

function isMissingMembersTable(message: string | undefined) {
  return Boolean(message && /workspace_members|does not exist|schema cache/i.test(message));
}

async function rememberSelection(space: WorkspaceRole | undefined, workspaceId: string) {
  const jar = await cookies();
  if (space) {
    jar.set(SPACE_COOKIE, space, cookieSettings);
  }
  jar.set(WORKSPACE_COOKIE, workspaceId, cookieSettings);
}

async function loadMemberships(userId: string, email: string | null): Promise<WorkspaceMembership[] | "missing"> {
  const admin = createAdminSupabase();
  const client = admin ?? (await createServerSupabase());
  let rowsResult = await client
    .from("workspace_members")
    .select("workspace_id, role, email")
    .eq("user_id", userId);

  if (rowsResult.error && isMissingMembersTable(rowsResult.error.message)) return "missing";
  if ((rowsResult.error || !rowsResult.data?.length) && email) {
    const byEmail = await client
      .from("workspace_members")
      .select("workspace_id, role, email")
      .eq("email", email.toLowerCase());
    if (byEmail.error && isMissingMembersTable(byEmail.error.message)) return "missing";
    if (!byEmail.error) rowsResult = byEmail;
  }
  if (rowsResult.error) return [];

  const rows = rowsResult.data ?? [];
  const workspaceIds = [...new Set(rows.map((row) => row.workspace_id))];
  const names = new Map<string, string>();
  const cfoByWorkspace = new Map<string, string>();
  if (workspaceIds.length > 0) {
    const workspaces = await client.from("workspaces").select("id, name").in("id", workspaceIds);
    for (const row of workspaces.data ?? []) {
      names.set(row.id, row.name);
    }
    const cfos = await client
      .from("workspace_members")
      .select("workspace_id, email")
      .eq("role", "cfo")
      .in("workspace_id", workspaceIds);
    for (const row of cfos.data ?? []) {
      if (!cfoByWorkspace.has(row.workspace_id)) {
        cfoByWorkspace.set(row.workspace_id, row.email);
      }
    }
  }

  const seen = new Set<string>();
  const memberships: WorkspaceMembership[] = [];
  for (const row of rows) {
    const key = `${row.workspace_id}:${row.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    memberships.push({
      workspaceId: row.workspace_id,
      workspaceName: names.get(row.workspace_id) || cfoByWorkspace.get(row.workspace_id) || row.workspace_id,
      role: row.role === "developer" ? "developer" : "cfo",
      cfoEmail: cfoByWorkspace.get(row.workspace_id) ?? null,
    });
  }
  return memberships;
}

export async function requireProfile(options?: {
  role?: WorkspaceRole;
  workspaceId?: string;
}): Promise<ProfileResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, status: 401, error: "Not authenticated" };
  }

  try {
    await supabase.rpc("claim_developer_invite");
  } catch {
    // RPC is missing until SQL is applied.
  }

  const expectedRole = options?.role;
  const jar = await cookies();
  const cookieWorkspace = options?.workspaceId || jar.get(WORKSPACE_COOKIE)?.value || null;
  const email = user.email ?? null;

  const memberships = await loadMemberships(user.id, email);
  if (memberships !== "missing" && memberships.length > 0) {
    const inSpace = expectedRole
      ? memberships.filter((item) => item.role === expectedRole)
      : memberships;

    if (expectedRole && inSpace.length === 0) {
      const other = memberships.some((item) => item.role !== expectedRole);
      if (expectedRole === "developer") {
        const { data: accessState } = await supabase.rpc("developer_access_state");
        if (accessState === "revoked") {
          return {
            ok: false,
            status: 403,
            code: "revoked",
            error: "Invitation revoked. You no longer have access to this workspace.",
          };
        }
        return {
          ok: false,
          status: 403,
          code: "wrong_space",
          error: other
            ? "This email is a CFO account. Use the CFO space."
            : "This email has not been invited as a developer.",
        };
      }
      return {
        ok: false,
        status: 403,
        code: "wrong_space",
        error: "This email is a developer account. Use the Developer space.",
      };
    }

    const pool = inSpace.length > 0 ? inSpace : memberships;
    const selected =
      pool.find((item) => item.workspaceId === cookieWorkspace) ?? pool[0];

    await rememberSelection(expectedRole ?? selected.role, selected.workspaceId);

    return {
      ok: true,
      profile: {
        userId: user.id,
        email,
        workspaceId: selected.workspaceId,
        role: selected.role,
        memberships: pool,
      },
    };
  }

  const { data: accessState } = await supabase.rpc("developer_access_state");
  if (expectedRole === "developer" && accessState === "revoked") {
    return {
      ok: false,
      status: 403,
      code: "revoked",
      error: "Invitation revoked. You no longer have access to this workspace.",
    };
  }

  const withRole = await supabase
    .from("profiles")
    .select("workspace_id, email, role")
    .eq("id", user.id)
    .maybeSingle();

  const withoutRole = profileQueryHasError(withRole)
    ? await supabase.from("profiles").select("workspace_id, email").eq("id", user.id).maybeSingle()
    : withRole;

  let profile = withoutRole.data as { workspace_id: string; email: string | null; role?: string } | null;

  if (!profile) {
    const { data: ensuredId, error: rpcError } = await supabase.rpc("ensure_own_workspace");
    if (rpcError || !ensuredId) {
      const revoked = /developer_revoked/i.test(rpcError?.message || "");
      return {
        ok: false,
        status: revoked ? 403 : 400,
        code: revoked ? "revoked" : undefined,
        error: revoked
          ? "Invitation revoked. You no longer have access to this workspace."
          : rpcError?.message || "Workspace unavailable. Run supabase/members.sql",
      };
    }
    const reloaded = await supabase
      .from("profiles")
      .select("workspace_id, email, role")
      .eq("id", user.id)
      .maybeSingle();
    profile = reloaded.data as {
      workspace_id: string;
      email: string | null;
      role?: string;
    } | null;
  }

  if (!profile) {
    if (accessState === "invited") {
      return {
        ok: false,
        status: 403,
        error: "Invitation pending: sign in with the invited email.",
      };
    }
    return { ok: false, status: 400, error: "Profile not found" };
  }

  const role: WorkspaceRole = profile.role === "developer" ? "developer" : "cfo";
  if (expectedRole && role !== expectedRole) {
    return {
      ok: false,
      status: 403,
      code: "wrong_space",
      error:
        expectedRole === "cfo"
          ? "This email is a developer account. Use the Developer space."
          : "This email is a CFO account. Use the CFO space.",
    };
  }
  if (role === "developer" && accessState !== "invited") {
    return {
      ok: false,
      status: 403,
      code: "revoked",
      error: "Invitation revoked. You no longer have access to this workspace.",
    };
  }

  await rememberSelection(role, profile.workspace_id);

  return {
    ok: true,
    profile: {
      userId: user.id,
      email: user.email ?? profile.email,
      workspaceId: profile.workspace_id,
      role,
      memberships: [
        {
          workspaceId: profile.workspace_id,
          workspaceName: profile.email || "workspace",
          role,
          cfoEmail: role === "cfo" ? user.email ?? profile.email : null,
        },
      ],
    },
  };
}

export async function requireRole(role: WorkspaceRole, workspaceId?: string) {
  const result = await requireProfile({ role, workspaceId });
  if (!result.ok) return result;
  if (result.profile.role !== role) {
    return {
      ok: false as const,
      status: 403,
      code: "wrong_space",
      error: role === "cfo" ? "CFO only" : "Lead Developer only",
    };
  }
  return result;
}
