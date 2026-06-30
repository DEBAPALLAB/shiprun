import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { listFiles } from "../walk.js";
import type { Finding, StackInfo } from "../types.js";

const WILDCARD_CORS_RE = /Access-Control-Allow-Origin['"]?\s*[,:]\s*['"]\*['"]/i;

export async function checkCors(stack: StackInfo): Promise<Finding[]> {
  if (!stack.isNextJs) return [];

  const findings: Finding[] = [];
  const files = await listFiles(stack.root, [
    "app/**/route.ts",
    "app/**/route.js",
    "src/app/**/route.ts",
    "src/app/**/route.js",
    "pages/api/**/*.ts",
    "pages/api/**/*.js",
    "src/pages/api/**/*.ts",
    "src/pages/api/**/*.js",
    "middleware.ts",
    "middleware.js",
    "next.config.js",
    "next.config.ts",
    "next.config.mjs",
  ]);

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!WILDCARD_CORS_RE.test(content)) continue;

    const relPath = relative(stack.root, file);
    const lineIdx = content.split("\n").findIndex((l) => WILDCARD_CORS_RE.test(l));
    findings.push({
      id: `cors-wildcard-${relPath}`,
      phase: "1-auth-validation",
      severity: "high",
      title: "Wildcard CORS (Access-Control-Allow-Origin: *) found",
      detail: "A wildcard origin lets any website make authenticated-looking requests against this endpoint from a browser. If this route returns user-specific or sensitive data, restrict the origin to your known frontend domain(s).",
      file: relPath,
      line: lineIdx >= 0 ? lineIdx + 1 : undefined,
    });
  }

  return findings;
}
