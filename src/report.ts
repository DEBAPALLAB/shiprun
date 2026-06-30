import type { Finding, Phase, Severity, StackInfo } from "./types.js";

const PHASE_TITLES: Record<Phase, string> = {
  "0-data-exposure": "Phase 0 — Doesn't leak data",
  "1-auth-validation": "Phase 1 — Has the auth/validation a real app needs",
  "2-deployability": "Phase 2 — Deployable",
  "3-observability": "Phase 3 — Monitorable",
};

const PHASE_ORDER: Phase[] = ["0-data-exposure", "1-auth-validation", "2-deployability", "3-observability"];

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

const SEVERITY_BADGE: Record<Severity, string> = {
  critical: "🔴 CRITICAL",
  high: "🟠 HIGH",
  medium: "🟡 MEDIUM",
  low: "⚪ LOW",
};

export interface ReportMeta {
  newCount: number;
  resolvedCount: number;
  dismissedCount: number;
}

export function renderMarkdown(stack: StackInfo, findings: Finding[], meta?: ReportMeta): string {
  const lines: string[] = [];
  lines.push("# shiprun report", "");
  lines.push(`Stack detected: ${stack.isNextJs ? "Next.js" : "unknown framework"}${stack.usesSupabase ? " + Supabase" : ""}`, "");

  if (meta && (meta.newCount > 0 || meta.resolvedCount > 0 || meta.dismissedCount > 0)) {
    const parts: string[] = [];
    if (meta.newCount > 0) parts.push(`${meta.newCount} new`);
    if (meta.resolvedCount > 0) parts.push(`${meta.resolvedCount} resolved since last scan`);
    if (meta.dismissedCount > 0) parts.push(`${meta.dismissedCount} dismissed (hidden — \`shiprun list --all\` to see)`);
    lines.push(`_${parts.join(", ")}_`, "");
  }

  if (findings.length === 0) {
    lines.push("No open findings. This does not mean the app is fully production-ready — only that the deterministic checks shiprun runs today found nothing open.");
    return lines.join("\n");
  }

  const total = findings.length;
  const critical = findings.filter((f) => f.severity === "critical").length;
  lines.push(`**${total} open finding${total === 1 ? "" : "s"}** (${critical} critical)`, "");

  for (const phase of PHASE_ORDER) {
    const phaseFindings = findings
      .filter((f) => f.phase === phase)
      .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

    if (phaseFindings.length === 0) continue;

    lines.push(`## ${PHASE_TITLES[phase]}`, "");
    for (const f of phaseFindings) {
      const location = f.file ? ` \`${f.file}${f.line ? `:${f.line}` : ""}\`` : "";
      lines.push(`- [ ] **${SEVERITY_BADGE[f.severity]}** ${f.title}${location}`);
      lines.push(`      ${f.detail}`);
      lines.push(`      id: \`${f.id}\``);
    }
    lines.push("");
  }

  return lines.join("\n");
}
