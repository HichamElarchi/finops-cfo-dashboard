from datetime import datetime, timezone
from typing import Dict, Optional, Tuple

from supabase import Client

from backend.smart_balance import PREMIUM_MODEL

MODEL_RATES: Dict[str, Tuple[float, float]] = {
    "openai/gpt-4o": (2.50, 10.00),
    "openai/gpt-4o-mini": (0.15, 0.60),
    "openai/gpt-4.1": (2.00, 8.00),
    "openai/gpt-4.1-mini": (0.40, 1.60),
    "anthropic/claude-3.5-sonnet": (3.00, 15.00),
    "anthropic/claude-3.5-haiku": (0.80, 4.00),
    "deepseek/deepseek-chat": (0.14, 0.28),
}
DEFAULT_RATES = (0.50, 1.50)
AI_REQUESTS_TABLE = "ai_requests"


def estimate_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    prompt_rate, completion_rate = MODEL_RATES.get(model, DEFAULT_RATES)
    return round(
        (prompt_tokens * prompt_rate / 1_000_000)
        + (completion_tokens * completion_rate / 1_000_000),
        8,
    )


def workspace_costs(
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    raw_cost: Optional[float],
    requested_model: Optional[str] = None,
) -> Dict[str, float]:
    cost_with_proxy = round(float(raw_cost), 8) if raw_cost is not None else estimate_cost(
        model, prompt_tokens, completion_tokens
    )
    baseline = (requested_model or "").strip() or PREMIUM_MODEL
    cost_without_proxy = estimate_cost(baseline, prompt_tokens, completion_tokens)
    savings_usd = round(max(0.0, cost_without_proxy - cost_with_proxy), 8)
    return {
        "cost_with_proxy": cost_with_proxy,
        "cost_without_proxy": cost_without_proxy,
        "savings_usd": savings_usd,
    }


def persist_workspace_usage(
    supabase: Optional[Client],
    *,
    workspace_id: Optional[str],
    requested_model: str,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    cost_with_proxy: float,
    cost_without_proxy: float,
    savings_usd: float,
    routed: bool,
    routing_reason: str,
    complexity: str,
    mode_applied: str = "smart_balance",
) -> bool:
    if not supabase:
        print("Supabase is not configured: ai_requests log skipped")
        return False

    row = {
        "client_id": str(workspace_id or "proxy-test"),
        "project_id": "workspace",
        "model": model,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "cost_usd": cost_with_proxy,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "requested_model": requested_model,
        "mode_applied": mode_applied,
        "routed": routed,
        "stop_loss_triggered": False,
        "routing_reason": routing_reason,
        "cost_without_proxy": cost_without_proxy,
        "cost_with_proxy": cost_with_proxy,
        "savings_usd": savings_usd,
        "complexity": complexity,
    }
    if workspace_id:
        row["workspace_id"] = workspace_id

    try:
        result = supabase.table(AI_REQUESTS_TABLE).insert(row).execute()
        if result.data:
            print(f"Logged usage to {AI_REQUESTS_TABLE}: {result.data[0].get('id')}")
            return True
    except Exception as exc:
        print(f"Failed to insert {AI_REQUESTS_TABLE}: {exc}")

    try:
        fallback = {
            "client_id": str(workspace_id or "proxy-test"),
            "project_id": "workspace",
            "model": model,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "cost_usd": cost_with_proxy,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        result = supabase.table(AI_REQUESTS_TABLE).insert(fallback).execute()
        if result.data:
            print(f"Logged usage (fallback) to {AI_REQUESTS_TABLE}: {result.data[0].get('id')}")
            return True
    except Exception as fallback_exc:
        print(f"Fallback insert failed: {fallback_exc}")
    return False
