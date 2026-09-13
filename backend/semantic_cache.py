from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx
from supabase import Client

from backend.usage import estimate_cost

EMBED_URL = "https://openrouter.ai/api/v1/embeddings"
EMBED_MODEL = "openai/text-embedding-3-small"
SIMILARITY_THRESHOLD = 0.92
TTL_DAYS = 30
TABLE = "semantic_cache"


def last_user_question(messages: List[Dict[str, Any]]) -> str:
    for item in reversed(messages or []):
        if item.get("role") == "user":
            return str(item.get("content") or "").strip()
    return ""


def normalize_question(question: str) -> str:
    return " ".join((question or "").lower().split())[:4000]


def embedding_to_vector(values: List[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in values) + "]"


async def embed_question(api_key: str, question: str) -> Optional[List[float]]:
    text = (question or "").strip()
    if not text or not api_key:
        return None
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                EMBED_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "http://localhost:8001",
                    "X-Title": "Proxy FinOps AI",
                },
                json={"model": EMBED_MODEL, "input": text[:8000]},
            )
        if response.status_code != 200:
            print(f"semantic_cache embed HTTP {response.status_code}: {response.text[:180]}")
            return None
        data = response.json()
        vector = (data.get("data") or [{}])[0].get("embedding")
        if isinstance(vector, list) and vector:
            return [float(item) for item in vector]
    except Exception as exc:
        print(f"semantic_cache embed failed: {exc}")
    return None


def lookup_exact(supabase: Optional[Client], workspace_id: Optional[str], question: str) -> Optional[Dict[str, Any]]:
    if not supabase or not workspace_id:
        return None
    norm = normalize_question(question)
    if not norm:
        return None
    try:
        result = (
            supabase.table(TABLE)
            .select("id, question, answer, requested_model, served_model, prompt_tokens, completion_tokens, hit_count")
            .eq("workspace_id", workspace_id)
            .eq("question_norm", norm)
            .gt("expires_at", datetime.now(timezone.utc).isoformat())
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if result.data:
            return result.data[0]
    except Exception as exc:
        print(f"semantic_cache exact lookup skipped: {exc}")
    return None


def lookup_similar(
    supabase: Optional[Client],
    workspace_id: Optional[str],
    embedding: List[float],
) -> Optional[Dict[str, Any]]:
    if not supabase or not workspace_id or not embedding:
        return None
    try:
        result = supabase.rpc(
            "match_semantic_cache",
            {
                "p_workspace_id": workspace_id,
                "p_embedding": embedding_to_vector(embedding),
                "p_threshold": SIMILARITY_THRESHOLD,
                "p_limit": 1,
            },
        ).execute()
        if result.data:
            return result.data[0]
    except Exception as exc:
        print(f"semantic_cache similar lookup skipped: {exc}")
    return None


def mark_cache_hit(supabase: Optional[Client], row: Dict[str, Any]) -> None:
    if not supabase or not row.get("id"):
        return
    try:
        supabase.table(TABLE).update({"hit_count": int(row.get("hit_count") or 0) + 1}).eq("id", row["id"]).execute()
    except Exception as exc:
        print(f"semantic_cache hit_count skipped: {exc}")


def store_semantic_entry(
    supabase: Optional[Client],
    *,
    workspace_id: Optional[str],
    question: str,
    answer: str,
    embedding: Optional[List[float]],
    requested_model: str,
    served_model: str,
    prompt_tokens: int,
    completion_tokens: int,
) -> None:
    if not supabase or not workspace_id:
        return
    norm = normalize_question(question)
    if not norm or not (answer or "").strip():
        return
    expires = datetime.now(timezone.utc) + timedelta(days=TTL_DAYS)
    row: Dict[str, Any] = {
        "workspace_id": workspace_id,
        "question": question[:8000],
        "question_norm": norm,
        "answer": answer,
        "requested_model": requested_model,
        "served_model": served_model,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "expires_at": expires.isoformat(),
    }
    if embedding:
        row["embedding"] = embedding_to_vector(embedding)
    try:
        supabase.rpc("cleanup_semantic_cache").execute()
    except Exception:
        pass
    try:
        supabase.table(TABLE).insert(row).execute()
    except Exception as exc:
        print(f"semantic_cache store skipped: {exc}")


def cache_hit_costs(requested_model: str, prompt_tokens: int, completion_tokens: int) -> Dict[str, float]:
    without = estimate_cost(requested_model, prompt_tokens, completion_tokens)
    return {
        "cost_with_proxy": 0.0,
        "cost_without_proxy": without,
        "savings_usd": without,
    }


async def resolve_semantic_lookup(
    supabase: Optional[Client],
    *,
    workspace_id: Optional[str],
    api_key: str,
    question: str,
) -> tuple[Optional[Dict[str, Any]], Optional[List[float]]]:
    if not question:
        return None, None
    hit = lookup_exact(supabase, workspace_id, question)
    if hit:
        mark_cache_hit(supabase, hit)
        return hit, None
    embedding = await embed_question(api_key, question)
    similar = lookup_similar(supabase, workspace_id, embedding or [])
    if similar:
        mark_cache_hit(supabase, similar)
        return similar, embedding
    return None, embedding
