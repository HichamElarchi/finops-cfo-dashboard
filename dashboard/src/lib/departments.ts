export const DEPARTMENT_MODES = ["max_power", "eco", "smart_balance"] as const;

export type DepartmentMode = (typeof DEPARTMENT_MODES)[number];

export const DEPARTMENTS = [
  { id: "marketing", label: "Marketing" },
  { id: "rd", label: "R&D" },
  { id: "support", label: "Support" },
] as const;

export type DepartmentId = (typeof DEPARTMENTS)[number]["id"];

export const DEFAULT_DEPARTMENT_MODES: Record<DepartmentId, DepartmentMode> = {
  marketing: "eco",
  rd: "max_power",
  support: "smart_balance",
};

export const MODE_LABELS: Record<DepartmentMode, string> = {
  max_power: "Max Power",
  eco: "Eco",
  smart_balance: "Smart Balance",
};

const STORAGE_KEY = "finops-department-modes";

export function loadDepartmentModes(): Record<DepartmentId, DepartmentMode> {
  if (typeof window === "undefined") {
    return { ...DEFAULT_DEPARTMENT_MODES };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_DEPARTMENT_MODES };
    }
    const parsed = JSON.parse(raw) as Partial<Record<DepartmentId, DepartmentMode>>;
    return {
      marketing: parsed.marketing ?? DEFAULT_DEPARTMENT_MODES.marketing,
      rd: parsed.rd ?? DEFAULT_DEPARTMENT_MODES.rd,
      support: parsed.support ?? DEFAULT_DEPARTMENT_MODES.support,
    };
  } catch {
    return { ...DEFAULT_DEPARTMENT_MODES };
  }
}

export function saveDepartmentModes(modes: Record<DepartmentId, DepartmentMode>) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(modes));
}
