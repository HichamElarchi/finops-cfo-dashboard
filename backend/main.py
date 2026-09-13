import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
import httpx
from supabase import Client, create_client

from backend.semantic_cache import (
    cache_hit_costs,
    last_user_question,
    resolve_semantic_lookup,
    store_semantic_entry,
)
from backend.smart_balance import smart_balance_route
from backend.usage import persist_workspace_usage, workspace_costs
from backend.workspace import authenticate_workspace

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def env(name: str) -> str:
    return (os.getenv(name) or "").strip().strip('"').strip("'")


app = FastAPI(title="Proxy FinOps AI")

SUPABASE_URL = env("SUPABASE_URL")
SUPABASE_KEY = env("SUPABASE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL and SUPABASE_KEY else None


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    auth_header = request.headers.get("Authorization")
    try:
        workspace = authenticate_workspace(supabase, auth_header)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Auth/Supabase error: {exc}") from exc

    if not workspace:
        raise HTTPException(status_code=401, detail="Invalid proxy API key.")

    body = await request.json()
    requested_model = body.get("model", "openai/gpt-4o")
    messages = body.get("messages", [])

    openrouter_key = workspace.get("openrouter_api_key")
    if not openrouter_key:
        raise HTTPException(status_code=500, detail="Missing OpenRouter API key.")

    question = last_user_question(messages)
    cache_hit, cache_embedding = await resolve_semantic_lookup(
        supabase,
        workspace_id=workspace.get("workspace_id"),
        api_key=openrouter_key,
        question=question,
    )
    if cache_hit and cache_hit.get("answer"):
        prompt_tokens = int(cache_hit.get("prompt_tokens") or 0)
        completion_tokens = int(cache_hit.get("completion_tokens") or 0)
        costs = cache_hit_costs(requested_model, prompt_tokens, completion_tokens)
        served = "semantic-cache"
        reason = "semantic_cache: reused stored answer, no LLM call"
        if not workspace.get("skip_persist"):
            persist_workspace_usage(
                supabase,
                workspace_id=workspace.get("workspace_id"),
                requested_model=requested_model,
                model=served,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                cost_with_proxy=costs["cost_with_proxy"],
                cost_without_proxy=costs["cost_without_proxy"],
                savings_usd=costs["savings_usd"],
                routed=True,
                routing_reason=reason,
                complexity="CACHE",
                mode_applied="semantic_cache",
            )
        return {
            "id": f"finops-cache-{cache_hit.get('id')}",
            "object": "chat.completion",
            "model": served,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": cache_hit["answer"]},
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
            },
            "finops": {
                "mode_applied": "semantic_cache",
                "cache_hit": True,
                "requested_model": requested_model,
                "cost_without_proxy": costs["cost_without_proxy"],
                "cost_with_proxy": 0,
                "savings_usd": costs["savings_usd"],
            },
        }

    chosen_model, complexity, reason = await smart_balance_route(
        openrouter_key,
        messages,
        requested_model,
    )
    print(reason)
    body["model"] = chosen_model
    body["usage"] = {**(body.get("usage") or {}), "include": True}

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {openrouter_key}",
                    "HTTP-Referer": "http://localhost:8001",
                    "X-Title": "Proxy FinOps AI",
                },
                json=body,
            )
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"OpenRouter unreachable: {exc}") from exc

    if response.status_code != 200:
        try:
            content = response.json()
        except ValueError:
            content = {"error": response.text}
        return JSONResponse(status_code=response.status_code, content=content)

    data = response.json()
    data["model"] = chosen_model
    usage = data.get("usage") or {}
    prompt_tokens = int(usage.get("prompt_tokens") or 0)
    completion_tokens = int(usage.get("completion_tokens") or 0)
    raw_cost = usage.get("cost")
    costs = workspace_costs(
        chosen_model,
        prompt_tokens,
        completion_tokens,
        float(raw_cost) if isinstance(raw_cost, (int, float)) else None,
        requested_model,
    )
    if not workspace.get("skip_persist"):
        persist_workspace_usage(
            supabase,
            workspace_id=workspace.get("workspace_id"),
            requested_model=requested_model,
            model=chosen_model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost_with_proxy=costs["cost_with_proxy"],
            cost_without_proxy=costs["cost_without_proxy"],
            savings_usd=costs["savings_usd"],
            routed=chosen_model != requested_model,
            routing_reason=reason,
            complexity=complexity,
        )
    answer = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    store_semantic_entry(
        supabase,
        workspace_id=workspace.get("workspace_id"),
        question=question,
        answer=str(answer),
        embedding=cache_embedding,
        requested_model=requested_model,
        served_model=chosen_model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
    )
    return data
