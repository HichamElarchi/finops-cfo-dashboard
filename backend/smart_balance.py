from typing import List, Tuple

import httpx
from fastapi import HTTPException

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
ASSESS_MODELS = ["deepseek/deepseek-chat", "openai/gpt-4o-mini"]
ASSESS_MODEL = ASSESS_MODELS[0]
ECO_MODEL = "deepseek/deepseek-chat"
PREMIUM_MODEL = "openai/gpt-4o"

COMPLEX_MARKERS = (
    "code",
    "function",
    "class ",
    "algorithm",
    "algo",
    "architecture",
    "debug",
    "implement",
    "arbre",
    "binary",
    "sql",
    "regex",
    "api",
    "programmation",
    "programming",
    "analyse",
    "analyze",
    "expliqu",
    "explain",
    "how does",
    "comment fonctionne",
    "multi-step",
    "refactor",
    "compile",
)

ASSESS_SYSTEM = (
    "You classify software LLM tasks. "
    "Reply with exactly one word: SIMPLE or COMPLEX. "
    "SIMPLE = greeting, translation, summary, formatting, grammar, short rewrite. "
    "COMPLEX = reasoning, coding, architecture, analysis, multi-step plans."
)


def openrouter_headers(api_key: str) -> dict:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://finops-cfo-dashboard.vercel.app",
        "X-Title": "FinOps Proxy",
    }


def last_user_prompt(messages: List[dict]) -> str:
    parts = []
    for item in messages:
        if item.get("role") != "user":
            continue
        content = item.get("content") or ""
        if isinstance(content, list):
            content = " ".join(str(part.get("text") or part) for part in content)
        parts.append(str(content))
    return " ".join(parts).strip()


def heuristic_complexity(prompt: str) -> str:
    text = (prompt or "").strip()
    lowered = text.lower()
    if not text:
        return "SIMPLE"
    if any(marker in lowered for marker in COMPLEX_MARKERS):
        return "COMPLEX"
    if len(text) > 220:
        return "COMPLEX"
    if "\n" in text and len(text) > 80:
        return "COMPLEX"
    return "SIMPLE"


async def assess_complexity(api_key: str, prompt: str) -> Tuple[str, str]:
    fallback = heuristic_complexity(prompt)
    body = {
        "model": ASSESS_MODEL,
        "models": ASSESS_MODELS,
        "messages": [
            {"role": "system", "content": ASSESS_SYSTEM},
            {"role": "user", "content": (prompt or "empty")[:4000]},
        ],
        "max_tokens": 24,
        "temperature": 0,
    }
    last_error = "assessment unavailable"
    for attempt in range(2):
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.post(
                    OPENROUTER_URL,
                    json=body,
                    headers=openrouter_headers(api_key),
                )
        except httpx.RequestError as exc:
            last_error = f"assessment unreachable ({exc})"
            continue

        if response.status_code != 200:
            last_error = f"assessment HTTP {response.status_code}: {response.text[:180]}"
            if response.status_code in {408, 409, 429, 500, 502, 503, 504} and attempt == 0:
                continue
            print(last_error)
            return fallback, f"{last_error}, using heuristic {fallback}"

        data = response.json()
        label = ""
        choices = data.get("choices") or []
        if choices:
            message = choices[0].get("message") or {}
            label = (message.get("content") or "").upper()
        if "SIMPLE" in label:
            return "SIMPLE", f"classified SIMPLE via {ASSESS_MODEL}"
        if "COMPLEX" in label:
            return "COMPLEX", f"classified COMPLEX via {ASSESS_MODEL}"
        last_error = f"assessment empty label {label!r}"
        print(last_error)
        return fallback, f"{last_error}, using heuristic {fallback}"

    print(last_error)
    return fallback, f"{last_error}, using heuristic {fallback}"


def model_for_complexity(complexity: str, requested_model: str) -> str:
    if complexity == "SIMPLE":
        return ECO_MODEL
    if requested_model and requested_model != ECO_MODEL:
        return requested_model
    return PREMIUM_MODEL


async def smart_balance_route(
    api_key: str,
    messages: List[dict],
    requested_model: str,
) -> Tuple[str, str, str]:
    prompt = last_user_prompt(messages)
    complexity, assess_reason = await assess_complexity(api_key, prompt)
    routed_model = model_for_complexity(complexity, requested_model)
    reason = f"smart_balance: {assess_reason} → {routed_model}"
    return routed_model, complexity, reason


async def openrouter_chat(api_key: str, body: dict) -> dict:
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                OPENROUTER_URL,
                json=body,
                headers=openrouter_headers(api_key),
            )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"OpenRouter unreachable: {exc}") from exc

    try:
        data = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Invalid OpenRouter response") from exc
    if response.status_code != 200:
        raise HTTPException(status_code=response.status_code, detail=data)
    return data
