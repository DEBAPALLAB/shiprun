import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { listFiles } from "../walk.js";
import type { Finding, StackInfo } from "../types.js";

const AUTH_ROUTE_PATH_RE = /(login|signin|sign-in|signup|sign-up|register|reset-password|forgot-password|magic-link|otp)/i;
const RATE_LIMIT_HINT_RE = /ratelimit|rate-limit|@upstash\/ratelimit|express-rate-limit|rate_limit/i;

export async function checkRateLimiting(stack: StackInfo): Promise<Finding[]> {
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
  ]);

  for (const file of files) {
    const relPath = relative(stack.root, file).replace(/\\/g, "/");
    if (!AUTH_ROUTE_PATH_RE.test(relPath)) continue;

    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (RATE_LIMIT_HINT_RE.test(content)) continue;

    findings.push({
      id: `rate-limit-missing-${relPath}`,
      phase: "1-auth-validation",
      severity: "medium",
      title: "Auth-related route has no visible rate limiting",
      detail: "This route's path suggests it handles login/signup/password-reset, but no rate-limiting library or pattern was found in the file. Without it, the endpoint is open to credential-stuffing and brute-force attempts.",
      file: relPath,
    });
  }

  return findings;
}
