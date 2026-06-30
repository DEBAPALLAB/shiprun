import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { listFiles } from "../walk.js";
import type { Finding, StackInfo } from "../types.js";

const BODY_PARSE_RE = /request\.json\s*\(|req\.body|await\s+req\.json\s*\(/;
const SCHEMA_VALIDATION_RE = /\.parse\s*\(|\.safeParse\s*\(|zod|yup|joi\.object|@hookform\/resolvers/i;

export async function checkInputValidation(stack: StackInfo): Promise<Finding[]> {
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
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!BODY_PARSE_RE.test(content)) continue;
    if (SCHEMA_VALIDATION_RE.test(content)) continue;

    const relPath = relative(stack.root, file);
    findings.push({
      id: `validation-missing-${relPath}`,
      phase: "1-auth-validation",
      severity: "medium",
      title: "Route reads the request body with no visible schema validation",
      detail: "This route parses the request body but no validation library (zod/yup/joi) call was found. Unvalidated input that reaches the database or business logic is a common source of crashes and injection-style bugs.",
      file: relPath,
    });
  }

  return findings;
}
