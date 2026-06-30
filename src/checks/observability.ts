import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Finding, StackInfo } from "../types.js";

const ERROR_TRACKING_DEPS = ["@sentry/nextjs", "@sentry/node", "@sentry/browser", "@highlight-run/node", "bugsnag"];

export async function checkObservability(stack: StackInfo): Promise<Finding[]> {
  const findings: Finding[] = [];
  const pkgPath = join(stack.root, "package.json");
  let deps: Record<string, string> = {};

  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      deps = { ...pkg.dependencies, ...pkg.devDependencies };
    } catch {
      // unreadable, skip
    }
  }

  const hasErrorTracking = ERROR_TRACKING_DEPS.some((dep) => dep in deps);
  if (!hasErrorTracking) {
    findings.push({
      id: "observability-no-error-tracking",
      phase: "3-observability",
      severity: "low",
      title: "No error tracking SDK detected",
      detail: "No Sentry/Bugsnag/Highlight dependency found. Without error tracking, production failures only surface when a user reports them.",
    });
  }

  return findings;
}
