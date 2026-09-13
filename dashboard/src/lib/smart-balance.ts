const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const ECO_MODEL = "deepseek/deepseek-chat";
export const PREMIUM_MODEL = "openai/gpt-4o";
const ASSESS_MODELS = ["deepseek/deepseek-chat", "openai/gpt-4o-mini"];
const ASSESS_MODEL = ASSESS_MODELS[0];

const MODEL_RATES: Record<string, [number, number]> = {
  "openai/gpt-4o": [2.5, 10],
  "openai/gpt-4o-mini": [0.15, 0.6],
  "openai/gpt-4.1": [2, 8],
  "anthropic/claude-3.5-sonnet": [3, 15],
  "anthropic/claude-3.5-haiku": [0.8, 4],
  "deepseek/deepseek-chat": [0.14, 0.28],
};

const COMPLEX_MARKERS = [
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
];

const ASSESS_SYSTEM =
  "You classify software LLM tasks. Reply with exactly one word: SIMPLE or COMPLEX. SIMPLE = greeting, translation, summary, formatting, grammar, short rewrite. COMPLEX = reasoning, coding, architecture, analysis, multi-step plans.";

export function openrouterHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://finops-cfo-dashboard.vercel.app",
    "X-Title": "FinOps Proxy",
  };
}

export function estimateCost(model: string, promptTokens: number, completionTokens: number) {
  const [promptRate, completionRate] = MODEL_RATES[model] ?? [0.5, 1.5];
  return Number(
    ((promptTokens * promptRate) / 1_000_000 + (completionTokens * completionRate) / 1_000_000).toFixed(8),
  );
}

export function workspaceCosts(
  model: string,
  promptTokens: number,
  completionTokens: number,
  rawCost: number | null,
  requestedModel?: string | null,
) {
  const costWithProxy =
    rawCost === null ? estimateCost(model, promptTokens, completionTokens) : Number(rawCost.toFixed(8));
  const baseline = (requestedModel || "").trim() || PREMIUM_MODEL;
  const costWithoutProxy = estimateCost(baseline, promptTokens, completionTokens);
  const savingsUsd = Number(Math.max(0, costWithoutProxy - costWithProxy).toFixed(8));
  return { costWithProxy, costWithoutProxy, savingsUsd };
}

export function heuristicComplexity(prompt: string) {
  const text = (prompt || "").trim();
  const lowered = text.toLowerCase();
  if (!text) return "SIMPLE";
  if (COMPLEX_MARKERS.some((marker) => lowered.includes(marker))) return "COMPLEX";
  if (text.length > 220) return "COMPLEX";
  if (text.includes("\n") && text.length > 80) return "COMPLEX";
  return "SIMPLE";
}

export async function smartBalanceRoute(
  apiKey: string,
  messages: { role?: string; content?: string }[],
  requestedModel: string,
) {
  const prompt = messages
    .filter((item) => item.role === "user")
    .map((item) => item.content || "")
    .join(" ");
  const fallback = heuristicComplexity(prompt);

  let complexity = fallback;
  let reason = `classified ${fallback} via heuristic`;
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: openrouterHeaders(apiKey),
      body: JSON.stringify({
        model: ASSESS_MODEL,
        models: ASSESS_MODELS,
        messages: [
          { role: "system", content: ASSESS_SYSTEM },
          { role: "user", content: (prompt || "empty").slice(0, 4000) },
        ],
        max_tokens: 24,
        temperature: 0,
      }),
    });
    if (response.ok) {
      const data = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const label = (data.choices?.[0]?.message?.content || "").toUpperCase();
      if (label.includes("SIMPLE")) {
        complexity = "SIMPLE";
        reason = `classified SIMPLE via ${ASSESS_MODEL}`;
      } else if (label.includes("COMPLEX")) {
        complexity = "COMPLEX";
        reason = `classified COMPLEX via ${ASSESS_MODEL}`;
      } else {
        complexity = fallback;
        reason = `assessment empty, using heuristic ${fallback}`;
      }
    } else {
      const detail = await response.text();
      complexity = fallback;
      reason = `assessment HTTP ${response.status}, using heuristic ${fallback}`;
      console.error("smart_balance assessment failed", response.status, detail.slice(0, 180));
    }
  } catch (error) {
    complexity = fallback;
    reason = `assessment unavailable, using heuristic ${fallback}`;
    console.error("smart_balance assessment error", error);
  }

  const model =
    complexity === "SIMPLE"
      ? ECO_MODEL
      : requestedModel && requestedModel !== ECO_MODEL
        ? requestedModel
        : PREMIUM_MODEL;
  return {
    model,
    complexity,
    reason: `smart_balance: ${reason} → ${model}`,
  };
}
