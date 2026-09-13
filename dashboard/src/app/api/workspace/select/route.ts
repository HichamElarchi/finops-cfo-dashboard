import { NextResponse } from "next/server";
import { requireRole } from "@/lib/profile";

export async function POST(request: Request) {
  const body = (await request.json()) as { workspace_id?: string };
  const workspaceId = (body.workspace_id || "").trim();
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 400 });
  }

  const auth = await requireRole("developer", workspaceId);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  }

  return NextResponse.json({
    ok: true,
    workspace_id: auth.profile.workspaceId,
    workspace_name: auth.profile.memberships.find((item) => item.workspaceId === auth.profile.workspaceId)
      ?.workspaceName,
    cfo_email: auth.profile.memberships.find((item) => item.workspaceId === auth.profile.workspaceId)?.cfoEmail,
  });
}
