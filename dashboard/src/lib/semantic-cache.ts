import { estimateCost, openrouterHeaders } from "@/lib/smart-balance";

const EMBED_URL = "https://openrouter.ai/api/v1/embeddings";
const EMBED_MODEL = "openai/text-embedding-3-small";
const SIMILARITY_THRESHOLD = 0.92;
const TTL_DAYS = 30;

export type SemanticHit = {
  id: string;
  question: string;
  answer: string;
  requested_model?: string | null;
  served_model?: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  similarity?: number;
  embedding?: number[];
};

type AdminClient = {
  from: (table: string) => any;
  rpc: (name: string, args: Record<string, unknown>) => any;
};

export function lastUserQuestion(messages: { role?: string; content?: string }[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return (messages[index].content || "").trim();
    }
  }
  return "";
}

export function normalizeQuestion(question: string) {
  return question.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 4000);
}

function embeddingToVector(values: number[]) {
  return `[${values.map((value) => value.toFixed(8)).join(",")}]`;
}

export async function embedQuestion(apiKey: string, question: string): Promise<number[] | null> {
  const text = question.trim();
  if (!text || !apiKey) return null;
  try {
    const response = await fetch(EMBED_URL, {
      method: "POST",
      headers: openrouterHeaders(apiKey),
      body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 8000) }),
    });
    if (!response.ok) {
      console.error("semantic_cache embed HTTP", response.status, (await response.text()).slice(0, 180));
      return null;
    }
    const data = (await response.json()) as { data?: { embedding?: number[] }[] };
    const vector = data.data?.[0]?.embedding;
    return Array.isArray(vector) && vector.length ? vector : null;
  } catch (error) {
    console.error("semantic_cache embed failed", error);
    return null;
  }
}

export async function lookupExactCache(
  admin: AdminClient,
  workspaceId: string,
  question: string,
): Promise<SemanticHit | null> {
  const norm = normalizeQuestion(question);
  if (!norm) return null;
  const { data, error } = await admin
    .from("semantic_cache")
    .select("id, question, answer, requested_model, served_model, prompt_tokens, completion_tokens, hit_count")
    .eq("workspace_id", workspaceId)
    .eq("question_norm", norm)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as SemanticHit;
}

export async function lookupSimilarCache(
  admin: AdminClient,
  workspaceId: string,
  embedding: number[],
): Promise<SemanticHit | null> {
  const { data, error } = await admin.rpc("match_semantic_cache", {
    p_workspace_id: workspaceId,
    p_embedding: embeddingToVector(embedding),
    p_threshold: SIMILARITY_THRESHOLD,
    p_limit: 1,
  });
  if (error || !data?.[0]) return null;
  return data[0] as SemanticHit;
}

export async function resolveSemanticLookup(
  admin: AdminClient,
  workspaceId: string,
  apiKey: string,
  question: string,
): Promise<{ hit: SemanticHit | null; embedding: number[] | null }> {
  if (!question) return { hit: null, embedding: null };
  const exact = await lookupExactCache(admin, workspaceId, question);
  if (exact) {
    await admin
      .from("semantic_cache")
      .update({ hit_count: Number((exact as SemanticHit & { hit_count?: number }).hit_count || 0) + 1 })
      .eq("id", exact.id);
    return { hit: exact, embedding: null };
  }
  const embedding = await embedQuestion(apiKey, question);
  if (!embedding) return { hit: null, embedding: null };
  const similar = await lookupSimilarCache(admin, workspaceId, embedding);
  if (similar) {
    await admin
      .from("semantic_cache")
      .update({ hit_count: Number((similar as SemanticHit & { hit_count?: number }).hit_count || 0) + 1 })
      .eq("id", similar.id);
    return { hit: similar, embedding };
  }
  return { hit: null, embedding };
}

export async function storeSemanticEntry(
  admin: AdminClient,
  options: {
    workspaceId: string;
    question: string;
    answer: string;
    embedding?: number[] | null;
    requestedModel: string;
    servedModel: string;
    promptTokens: number;
    completionTokens: number;
  },
) {
  const norm = normalizeQuestion(options.question);
  if (!norm || !options.answer.trim()) return;
  const expires = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await admin.rpc("cleanup_semantic_cache", {});
  const { error } = await admin.from("semantic_cache").insert({
    workspace_id: options.workspaceId,
    question: options.question.slice(0, 8000),
    question_norm: norm,
    answer: options.answer,
    embedding: options.embedding ? embeddingToVector(options.embedding) : null,
    requested_model: options.requestedModel,
    served_model: options.servedModel,
    prompt_tokens: options.promptTokens,
    completion_tokens: options.completionTokens,
    expires_at: expires,
  });
  if (error) {
    console.error("semantic_cache store failed", error);
  }
}

export function cacheHitCosts(requestedModel: string, promptTokens: number, completionTokens: number) {
  const costWithoutProxy = estimateCost(requestedModel, promptTokens, completionTokens);
  return {
    costWithProxy: 0,
    costWithoutProxy,
    savingsUsd: costWithoutProxy,
  };
}
