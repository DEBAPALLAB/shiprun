import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { listFiles } from "../walk.js";
import type { Finding, StackInfo } from "../types.js";

const CREATE_TABLE_RE = /create\s+table\s+(?:if\s+not\s+exists\s+)?["`]?(?:public\.)?["`]?(\w+)["`]?/gi;
const ENABLE_RLS_RE = /alter\s+table\s+["`]?(?:public\.)?["`]?(\w+)["`]?\s+enable\s+row\s+level\s+security/gi;

export async function checkRowLevelSecurity(stack: StackInfo): Promise<Finding[]> {
  if (!stack.usesSupabase) return [];

  const findings: Finding[] = [];
  const sqlFiles = await listFiles(stack.root, ["supabase/migrations/**/*.sql", "supabase/**/*.sql"]);

  if (sqlFiles.length === 0) return findings;

  const tablesCreated = new Map<string, string>(); // table -> file where created
  const tablesWithRls = new Set<string>();

  for (const file of sqlFiles) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const relPath = relative(stack.root, file);

    for (const match of content.matchAll(CREATE_TABLE_RE)) {
      tablesCreated.set(match[1].toLowerCase(), relPath);
    }
    for (const match of content.matchAll(ENABLE_RLS_RE)) {
      tablesWithRls.add(match[1].toLowerCase());
    }
  }

  for (const [table, file] of tablesCreated) {
    if (!tablesWithRls.has(table)) {
      findings.push({
        id: `rls-missing-${table}`,
        phase: "0-data-exposure",
        severity: "critical",
        title: `Table "${table}" has no Row Level Security policy`,
        detail: `Without RLS enabled, any authenticated (or anonymous, depending on your API key usage) client can read/write this table directly through the Supabase client. Run: ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; and add policies.`,
        file,
      });
    }
  }

  return findings;
}
