type KpiCardProps = {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "success" | "warning";
};

const valueClass = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
};

export function KpiCard({ label, value, hint, tone = "default" }: KpiCardProps) {
  return (
    <article className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tracking-tight ${valueClass[tone]}`}>{value}</p>
      {hint ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </article>
  );
}
