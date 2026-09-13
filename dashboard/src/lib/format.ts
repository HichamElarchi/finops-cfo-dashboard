export function toNumber(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatUsd(value: number, digits = 5) {
  return `$${value.toFixed(digits)}`;
}

export function formatWhen(value: string | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function shortModel(model: string | null | undefined) {
  if (!model) return "—";
  if (model === "semantic-cache") return "semantic-cache";
  return model.replace(/^[^/]+\//, "");
}
