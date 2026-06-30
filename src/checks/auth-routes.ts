import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { listFiles } from "../walk.js";
import type { Finding, StackInfo } from "../types.js";

const DB_CALL_RE = /\.from\s*\(|supabase\.rpc\s*\(|prisma\.\w+\.(find|create|update|delete)|db\.query\s*\(/i;
const AUTH_CHECK_RE = /auth\.getUser\s*\(|auth\.getSession\s*\(|getServerSession\s*\(|requireAuth|currentUser\s*\(|getAuth\s*\(/i;

export async function checkAuthOnRoutes(stack: StackInfo): Promise<Finding[]> {
  if (!stack.isNextJs) return [];

  const findings: Finding[] = [];
  const routeFiles = await listFiles(stack.root, [
    "app/**/route.ts",
    "app/**/route.js",
    "src/app/**/route.ts",
    "src/app/**/route.js",
    "pages/api/**/*.ts",
    "pages/api/**/*.js",
    "src/pages/api/**/*.ts",
    "src/pages/api/**/*.js",
  ]);

  for (const file of routeFiles) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    if (!DB_CALL_RE.test(content)) continue;
    if (AUTH_CHECK_RE.test(content)) continue;

    const relPath = relative(stack.root, file);
    findings.push({
      id: `auth-missing-${relPath}`,
      phase: "1-auth-validation",
      severity: "high",
      title: "API route queries the database with no visible auth check",
      detail: "This route calls the database but no auth/session check (e.g. supabase.auth.getUser, getServerSession) was found in the file. If this route is meant to be restricted, verify the caller's identity before querying.",
      file: relPath,
    });
  }

  return findings;
}
