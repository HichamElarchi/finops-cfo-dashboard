"use client";

import { ModelBadge } from "@/components/ModelBadge";
import { formatUsd, formatWhen, shortModel, toNumber } from "@/lib/format";
import { isCacheHit, type UsageRow } from "@/lib/usage";

type UsageTableProps = {
  rows: UsageRow[];
  workspaceName: string;
  loading: boolean;
  onRefresh?: () => void;
};

export function UsageTable({ rows, workspaceName, loading, onRefresh }: UsageTableProps) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold">Recent API logs</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Latest calls from this workspace, including requested vs routed model.
          </p>
        </div>
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            className="h-9 rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Refresh
          </button>
        ) : null}
      </div>
      {loading ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">Loading usage…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Workspace</th>
                <th className="px-5 py-3 font-medium">Requested model</th>
                <th className="px-5 py-3 font-medium">Actual model</th>
                <th className="px-5 py-3 font-medium">Tokens</th>
                <th className="px-5 py-3 font-medium">Without proxy</th>
                <th className="px-5 py-3 font-medium">With proxy</th>
                <th className="px-5 py-3 font-medium">Savings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-sm text-muted-foreground">
                    No requests in this workspace yet.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const requested = row.requested_model || row.model;
                  const prompt = toNumber(row.prompt_tokens);
                  const completion = toNumber(row.completion_tokens);
                  const without = toNumber(row.cost_without_proxy);
                  const withProxy = toNumber(row.cost_with_proxy ?? row.cost_usd);
                  const savings = toNumber(row.savings_usd);
                  return (
                    <tr key={row.id} className="hover:bg-accent/70">
                      <td className="whitespace-nowrap px-5 py-3.5 font-medium">
                        {formatWhen(row.created_at)}
                      </td>
                      <td className="px-5 py-3.5 text-muted-foreground">{workspaceName}</td>
                      <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">
                        {shortModel(requested)}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex flex-col gap-1">
                          <ModelBadge model={isCacheHit(row) ? "semantic-cache" : row.model} />
                          {isCacheHit(row) ? (
                            <span className="text-[11px] text-violet-600 dark:text-violet-300">
                              cache · no LLM
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 font-mono text-xs">
                        <span className="text-foreground">{prompt.toLocaleString()}</span>
                        <span className="text-muted-foreground"> + </span>
                        <span className="text-foreground">{completion.toLocaleString()}</span>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-danger">{formatUsd(without)}</td>
                      <td className="px-5 py-3.5 font-mono text-xs text-success">{formatUsd(withProxy)}</td>
                      <td className="px-5 py-3.5 font-mono text-xs text-warning">{formatUsd(savings)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
