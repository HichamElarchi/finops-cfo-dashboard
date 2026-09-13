import { shortModel } from "@/lib/format";

type ModelBadgeProps = {
  model: string | null | undefined;
};

function tone(model: string) {
  const value = model.toLowerCase();
  if (value.includes("semantic") || value.includes("cache")) {
    return "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300";
  }
  if (value.includes("deepseek")) {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (value.includes("gpt-4o")) {
    return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
  }
  return "border-border bg-muted text-muted-foreground";
}

export function ModelBadge({ model }: ModelBadgeProps) {
  if (!model) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-medium ${tone(model)}`}
      title={model}
    >
      <span className="truncate">{shortModel(model)}</span>
    </span>
  );
}
