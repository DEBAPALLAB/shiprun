import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { listFiles } from "../walk.js";
import type { Finding, StackInfo } from "../types.js";

const SQL_PUBLIC_BUCKET_RE = /insert\s+into\s+storage\.buckets[\s\S]*?\btrue\b/i;
const JS_PUBLIC_BUCKET_RE = /createBucket\s*\(\s*['"][^'"]+['"]\s*,\s*\{[^}]*public\s*:\s*true/i;

export async function checkStorageBuckets(stack: StackInfo): Promise<Finding[]> {
  if (!stack.usesSupabase) return [];

  const findings: Finding[] = [];

  const sqlFiles = await listFiles(stack.root, ["supabase/migrations/**/*.sql", "supabase/**/*.sql"]);
  for (const file of sqlFiles) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!SQL_PUBLIC_BUCKET_RE.test(content)) continue;

    const relPath = relative(stack.root, file);
    findings.push({
      id: `storage-public-bucket-sql-${relPath}`,
      phase: "0-data-exposure",
      severity: "high",
      title: "Storage bucket created with public = true",
      detail: "A public bucket serves any file inside it to anyone with the URL, no auth required. Confirm this is intentional (e.g. public avatars) and not used for user documents, uploads, or anything containing personal data.",
      file: relPath,
    });
  }

  const srcFiles = await listFiles(stack.root, ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"]);
  for (const file of srcFiles) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!JS_PUBLIC_BUCKET_RE.test(content)) continue;

    const relPath = relative(stack.root, file);
    const lineIdx = content.split("\n").findIndex((l) => /createBucket/i.test(l));
    findings.push({
      id: `storage-public-bucket-js-${relPath}`,
      phase: "0-data-exposure",
      severity: "high",
      title: "Storage bucket created with public: true",
      detail: "A public bucket serves any file inside it to anyone with the URL, no auth required. Confirm this is intentional (e.g. public avatars) and not used for user documents, uploads, or anything containing personal data.",
      file: relPath,
      line: lineIdx >= 0 ? lineIdx + 1 : undefined,
    });
  }

  return findings;
}
