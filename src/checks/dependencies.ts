import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Finding, StackInfo } from "../types.js";

interface NpmAuditOutput {
  metadata?: {
    vulnerabilities?: Record<string, number>;
  };
}

export async function checkDependencies(stack: StackInfo): Promise<Finding[]> {
  if (!existsSync(join(stack.root, "package-lock.json"))) return [];

  let raw: string;
  try {
    // npm audit exits non-zero when vulnerabilities are found; stdout still has the JSON.
    raw = execFileSync("npm", ["audit", "--json"], {
      cwd: stack.root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (err: unknown) {
    const e = err as { stdout?: string };
    raw = e.stdout ?? "";
  }

  if (!raw) return [];

  let parsed: NpmAuditOutput;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const counts = parsed.metadata?.vulnerabilities;
  if (!counts) return [];

  const findings: Finding[] = [];
  const critical = counts.critical ?? 0;
  const high = counts.high ?? 0;

  if (critical > 0) {
    findings.push({
      id: "deps-critical-vulns",
      phase: "0-data-exposure",
      severity: "critical",
      title: `${critical} critical dependency vulnerabilit${critical === 1 ? "y" : "ies"}`,
      detail: 'Run "npm audit" for details and "npm audit fix" to attempt automatic fixes.',
    });
  }
  if (high > 0) {
    findings.push({
      id: "deps-high-vulns",
      phase: "0-data-exposure",
      severity: "high",
      title: `${high} high-severity dependency vulnerabilit${high === 1 ? "y" : "ies"}`,
      detail: 'Run "npm audit" for details and "npm audit fix" to attempt automatic fixes.',
    });
  }

  return findings;
}
