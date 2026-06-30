import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Finding, StackInfo } from "../types.js";

export async function checkDeployability(stack: StackInfo): Promise<Finding[]> {
  const findings: Finding[] = [];

  const hasCi =
    existsSync(join(stack.root, ".github", "workflows")) ||
    existsSync(join(stack.root, ".gitlab-ci.yml")) ||
    existsSync(join(stack.root, "vercel.json"));

  if (!hasCi) {
    findings.push({
      id: "deploy-no-ci",
      phase: "2-deployability",
      severity: "medium",
      title: "No CI pipeline or deploy config found",
      detail: "No .github/workflows, .gitlab-ci.yml, or vercel.json detected. Without CI, builds/tests/lints aren't checked before merge or deploy.",
    });
  }

  const pkgPath = join(stack.root, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const scripts = pkg.scripts ?? {};
      if (!scripts.build) {
        findings.push({
          id: "deploy-no-build-script",
          phase: "2-deployability",
          severity: "medium",
          title: 'No "build" script in package.json',
          detail: 'A "build" script is required by most hosting platforms (Vercel, Netlify, etc.) to produce a production build.',
        });
      }
    } catch {
      // unreadable, skip
    }
  }

  return findings;
}
