import hashlib
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import HTTPException
from supabase import Client

TEST_PROXY_KEY = os.getenv("PROXY_TEST_KEY", "pk_live_test123")


def hash_proxy_key(plaintext: str) -> str:
    return hashlib.sha256(plaintext.strip().encode("utf-8")).hexdigest()


def extract_proxy_key(authorization: Optional[str]) -> str:
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        if token.startswith("pk_live_"):
            return token
    raise HTTPException(
        status_code=401,
        detail="Missing proxy API key. Use Authorization: Bearer pk_live_...",
    )


def authenticate_workspace(
    supabase: Optional[Client],
    authorization: Optional[str],
) -> Dict[str, Any]:
    proxy_key = extract_proxy_key(authorization)

    if proxy_key == TEST_PROXY_KEY:
        openrouter_key = (os.getenv("OPENROUTER_API_KEY") or "").strip().strip('"').strip("'")
        if not openrouter_key:
            raise HTTPException(
                status_code=500,
                detail="Set OPENROUTER_API_KEY in .env to use the local test key.",
            )
        workspace_id = None
        if supabase:
            try:
                members = (
                    supabase.table("workspace_members")
                    .select("workspace_id")
                    .eq("role", "cfo")
                    .limit(1)
                    .execute()
                )
                if members.data:
                    workspace_id = members.data[0]["workspace_id"]
                else:
                    existing = supabase.table("workspaces").select("id").limit(1).execute()
                    if existing.data:
                        workspace_id = existing.data[0]["id"]
            except Exception as exc:
                print(f"Supabase lookup skipped for test key: {exc}")
                workspace_id = None
        return {
            "workspace_id": workspace_id,
            "openrouter_api_key": openrouter_key,
            "skip_persist": supabase is None,
        }

    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase is not configured.")

    try:
        keys = (
            supabase.table("proxy_api_keys")
            .select("id, workspace_id, key_prefix")
            .eq("key_hash", hash_proxy_key(proxy_key))
            .limit(1)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Supabase unreachable: {exc}") from exc
    if not keys.data:
        raise HTTPException(status_code=401, detail="Invalid proxy API key.")

    key_row = keys.data[0]
    workspace_id = key_row["workspace_id"]
    workspace = (
        supabase.table("workspaces")
        .select("id, trial_ends_at, subscription_status")
        .eq("id", workspace_id)
        .limit(1)
        .execute()
    )
    if not workspace.data:
        raise HTTPException(status_code=401, detail="Workspace not found.")

    ws = workspace.data[0]
    status = ws.get("subscription_status") or "trialing"
    if status not in {"active", "trialing"}:
        raise HTTPException(status_code=402, detail="Subscription inactive.")

    trial_ends = ws.get("trial_ends_at")
    if trial_ends and status == "trialing":
        ends = datetime.fromisoformat(str(trial_ends).replace("Z", "+00:00"))
        if ends.tzinfo is None:
            ends = ends.replace(tzinfo=timezone.utc)
        if ends < datetime.now(timezone.utc):
            raise HTTPException(
                status_code=402,
                detail="3-day trial ended. Subscribe to continue.",
            )

    creds = (
        supabase.table("workspace_credentials")
        .select("openrouter_api_key")
        .eq("workspace_id", workspace_id)
        .limit(1)
        .execute()
    )
    openrouter_key = ""
    if creds.data:
        openrouter_key = (creds.data[0].get("openrouter_api_key") or "").strip()
    if not openrouter_key:
        raise HTTPException(
            status_code=400,
            detail="No OpenRouter key saved for this workspace.",
        )

    return {
        "workspace_id": workspace_id,
        "openrouter_api_key": openrouter_key,
        "skip_persist": False,
    }
