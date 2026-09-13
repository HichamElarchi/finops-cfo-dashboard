import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  cacheHitCosts,
  lastUserQuestion,
  resolveSemanticLookup,
  storeSemanticEntry,
} from "@/lib/semantic-cache";
import {
  openrouterHeaders,
  smartBalanceRoute,
  workspaceCosts,
} from "@/lib/smart-balance";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(request: Request) {
  const admin = createAdminSupabase();
  if (!admin) {
    return json({ error: "Proxy is not configured on the server." }, 500);
  }

  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!bearer.startsWith("pk_live_")) {
    return json({ error: "Missing proxy API key. Use Authorization: Bearer pk_live_..." }, 401);
  }

  const keyHash = createHash("sha256").update(bearer).digest("hex");
  const { data: keyRow } = await admin
    .from("proxy_api_keys")
    .select("workspace_id")
    .eq("key_hash", keyHash)
    .maybeSingle();
  if (!keyRow?.workspace_id) {
    return json({ error: "Invalid proxy API key." }, 401);
  }

  const { data: credentials } = await admin
    .from("workspace_credentials")
    .select("openrouter_api_key")
    .eq("workspace_id", keyRow.workspace_id)
    .maybeSingle();
  const openrouterKey = (credentials?.openrouter_api_key || "").trim();
  if (!openrouterKey) {
    return json({ error: "No OpenRouter key saved for this workspace." }, 400);
  }

  const payload = (await request.json()) as {
    model?: string;
    messages?: { role?: string; content?: string }[];
    max_tokens?: number;
  };
  const requestedModel = payload.model || "openai/gpt-4o";
  const messages = payload.messages ?? [];
  const question = lastUserQuestion(messages);
  let cacheHit = null;
  let cacheEmbedding = null;
  try {
    const resolved = await resolveSemanticLookup(
      admin,
      keyRow.workspace_id,
      openrouterKey,
      question,
    );
    cacheHit = resolved.hit;
    cacheEmbedding = resolved.embedding;
  } catch (error) {
    console.error("semantic_cache lookup skipped", error);
  }
  if (cacheHit?.answer) {
    const promptTokens = Number(cacheHit.prompt_tokens || 0);
    const completionTokens = Number(cacheHit.completion_tokens || 0);
    const costs = cacheHitCosts(requestedModel, promptTokens, completionTokens);
    const { error: logError } = await admin.from("ai_requests").insert({
      workspace_id: keyRow.workspace_id,
      client_id: keyRow.workspace_id,
      project_id: "workspace",
      model: "semantic-cache",
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cost_usd: 0,
      requested_model: requestedModel,
      mode_applied: "semantic_cache",
      routed: true,
      routing_reason: "semantic_cache: reused stored answer, no LLM call",
      complexity: "CACHE",
      cost_without_proxy: costs.costWithoutProxy,
      cost_with_proxy: 0,
      savings_usd: costs.savingsUsd,
    });
    if (logError) {
      console.error("ai_requests insert failed", logError);
    }
    return json({
      id: `finops-cache-${cacheHit.id}`,
      object: "chat.completion",
      model: "semantic-cache",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: cacheHit.answer },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      finops: {
        mode_applied: "semantic_cache",
        cache_hit: true,
        requested_model: requestedModel,
        cost_without_proxy: costs.costWithoutProxy,
        cost_with_proxy: 0,
        savings_usd: costs.savingsUsd,
      },
    });
  }

  const routed = await smartBalanceRoute(openrouterKey, messages, requestedModel);

  const upstream = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: openrouterHeaders(openrouterKey),
    body: JSON.stringify({
      model: routed.model,
      messages,
      max_tokens: payload.max_tokens ?? 256,
      usage: { include: true },
    }),
  });
  const data = (await upstream.json()) as {
    error?: { message?: string };
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number };
  };
  if (!upstream.ok) {
    return json({ error: data.error?.message || "OpenRouter request failed." }, upstream.status);
  }

  const usage = data.usage ?? {};
  const promptTokens = Number(usage.prompt_tokens || 0);
  const completionTokens = Number(usage.completion_tokens || 0);
  const costs = workspaceCosts(
    routed.model,
    promptTokens,
    completionTokens,
    typeof usage.cost === "number" ? usage.cost : null,
    requestedModel,
  );

  const { error: logError } = await admin.from("ai_requests").insert({
    workspace_id: keyRow.workspace_id,
    client_id: keyRow.workspace_id,
    project_id: "workspace",
    model: routed.model,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    cost_usd: costs.costWithProxy,
    requested_model: requestedModel,
    mode_applied: "smart_balance",
    routed: routed.model !== requestedModel,
    routing_reason: routed.reason,
    complexity: routed.complexity,
    cost_without_proxy: costs.costWithoutProxy,
    cost_with_proxy: costs.costWithProxy,
    savings_usd: costs.savingsUsd,
  });
  if (logError) {
    console.error("ai_requests insert failed", logError);
  }

  const answer = data.choices?.[0]?.message?.content || "";
  try {
    await storeSemanticEntry(admin, {
      workspaceId: keyRow.workspace_id,
      question,
      answer,
      embedding: cacheEmbedding,
      requestedModel,
      servedModel: routed.model,
      promptTokens,
      completionTokens,
    });
  } catch (error) {
    console.error("semantic_cache store skipped", error);
  }

  return json({
    id: `finops-${keyRow.workspace_id}`,
    object: "chat.completion",
    model: routed.model,
    choices: data.choices ?? [],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: Number(usage.total_tokens || promptTokens + completionTokens),
    },
    finops: {
      mode_applied: "smart_balance",
      complexity: routed.complexity,
      requested_model: requestedModel,
      cost_without_proxy: costs.costWithoutProxy,
      cost_with_proxy: costs.costWithProxy,
      savings_usd: costs.savingsUsd,
    },
  });
}
