import { toNumber } from "@/lib/format";

export type UsageRow = {
  id: string;
  created_at: string;
  client_id: string;
  department?: string | null;
  project_id: string;
  model: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_usd: number | string | null;
  cost_without_proxy?: number | string | null;
  cost_with_proxy?: number | string | null;
  savings_usd?: number | string | null;
  requested_model?: string | null;
  mode_applied?: string | null;
  routed?: boolean | null;
  stop_loss_triggered?: boolean | null;
  routing_reason?: string | null;
  complexity?: string | null;
};

export function isCacheHit(row: UsageRow) {
  return row.mode_applied === "semantic_cache" || row.model === "semantic-cache";
}

export function summarizeUsage(rows: UsageRow[]) {
  return rows.reduce(
    (acc, row) => {
      acc.requests += 1;
      acc.promptTokens += toNumber(row.prompt_tokens);
      acc.completionTokens += toNumber(row.completion_tokens);
      acc.spent += toNumber(row.cost_with_proxy ?? row.cost_usd);
      acc.withoutProxy += toNumber(row.cost_without_proxy);
      acc.savings += toNumber(row.savings_usd);
      if (isCacheHit(row)) {
        acc.cacheHits += 1;
        acc.cacheSavings += toNumber(row.savings_usd);
        acc.cacheTokens += toNumber(row.prompt_tokens) + toNumber(row.completion_tokens);
      }
      return acc;
    },
    {
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      spent: 0,
      withoutProxy: 0,
      savings: 0,
      cacheHits: 0,
      cacheSavings: 0,
      cacheTokens: 0,
    },
  );
}
