export type Severity = "critical" | "high" | "medium" | "low";

export type Phase =
  | "0-data-exposure"
  | "1-auth-validation"
  | "2-deployability"
  | "3-observability";

export interface Finding {
  id: string;
  phase: Phase;
  severity: Severity;
  title: string;
  detail: string;
  file?: string;
  line?: number;
}

export interface StackInfo {
  isNextJs: boolean;
  usesSupabase: boolean;
  root: string;
}
