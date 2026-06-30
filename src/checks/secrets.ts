import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { relative } from "node:path";
import { listFiles } from "../walk.js";
import type { Finding, StackInfo } from "../types.js";

const SERVER_ONLY_HINTS = [/\/api\//, /\/server\//, /route\.ts$/, /route\.js$/, /\.server\.ts$/, /middleware\.ts$/];

function isLikelyServerFile(relPath: string): boolean {
  return SERVER_ONLY_HINTS.some((re) => re.test(relPath.replace(/\\/g, "/")));
}

// Literal key prefixes for common providers — these are live-credential shaped strings,
// not just env var *names*, so a match here is much higher-confidence than the generic scan.
const LITERAL_KEY_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "AWS access key", re: /AKIA[0-9A-Z]{16}/ },
  { name: "Stripe live secret key", re: /sk_live_[0-9a-zA-Z]{16,}/ },
  { name: "Stripe live restricted key", re: /rk_live_[0-9a-zA-Z]{16,}/ },
  { name: "OpenAI API key", re: /sk-[a-zA-Z0-9]{20,}T3BlbkFJ[a-zA-Z0-9]{20,}|sk-proj-[a-zA-Z0-9_-]{20,}/ },
  { name: "GitHub personal access token", re: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: "Slack token", re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
];

function gitTrackedFiles(root: string): Set<string> | undefined {
  try {
    const out = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return new Set(out.split("\n").map((f) => f.trim()).filter(Boolean));
  } catch {
    return undefined; // not a git repo, or git unavailable — skip the tracked-file check
  }
}

export async function checkSecrets(stack: StackInfo): Promise<Finding[]> {
  const findings: Finding[] = [];

  // .env files present but not gitignored
  const envFiles = await listFiles(stack.root, [".env", ".env.local", ".env.production", ".env.development"]);
  if (envFiles.length > 0) {
    const gitignorePath = `${stack.root}/.gitignore`;
    const gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
    const envIgnored = /^\.env/m.test(gitignore) || gitignore.includes(".env*");

    if (!envIgnored) {
      findings.push({
        id: "secrets-env-not-gitignored",
        phase: "0-data-exposure",
        severity: "critical",
        title: ".env file(s) present but not excluded by .gitignore",
        detail: `Found ${envFiles.length} env file(s) that could be committed with real secrets. Add ".env*" to .gitignore (keep ".env.example" tracked instead).`,
      });
    }
  }

  // .env files already committed to git history/index — worse than just "not ignored",
  // the secrets are already on the remote if this has ever been pushed.
  const tracked = gitTrackedFiles(stack.root);
  if (tracked) {
    for (const file of envFiles) {
      const relPath = relative(stack.root, file).replace(/\\/g, "/");
      if (tracked.has(relPath) && relPath !== ".env.example") {
        findings.push({
          id: `secrets-env-tracked-${relPath}`,
          phase: "0-data-exposure",
          severity: "critical",
          title: `${relPath} is tracked by git`,
          detail: "This file is committed to the repository. If it ever contained real secrets, rotate them — removing the file now does not remove it from git history. Use git filter-repo / BFG to scrub history, then rotate every credential that was in it.",
          file: relPath,
        });
      }
    }
  }

  // literal provider-key-shaped strings hardcoded anywhere in source
  const allSourceFiles = await listFiles(stack.root, ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.json", "**/*.env*"]);
  for (const file of allSourceFiles) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const relPath = relative(stack.root, file).replace(/\\/g, "/");
    if (relPath.endsWith(".env.example")) continue;

    for (const { name, re } of LITERAL_KEY_PATTERNS) {
      const match = content.match(re);
      if (!match) continue;
      const lineIdx = content.slice(0, match.index).split("\n").length - 1;
      findings.push({
        id: `secrets-literal-${name.replace(/\s+/g, "-")}-${relPath}`,
        phase: "0-data-exposure",
        severity: "critical",
        title: `Hardcoded ${name} found in source`,
        detail: "This looks like a live credential committed directly in code rather than read from an environment variable. Move it to an env var and rotate the key.",
        file: relPath,
        line: lineIdx + 1,
      });
    }
  }

  // service role key referenced outside server-only files
  const srcFiles = await listFiles(stack.root, ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"]);
  for (const file of srcFiles) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!/SUPABASE_SERVICE_ROLE_KEY|service_role/i.test(content)) continue;

    const relPath = relative(stack.root, file);
    const hasUseClientDirective = /^["']use client["']/m.test(content);

    if (hasUseClientDirective || !isLikelyServerFile(relPath)) {
      const lineIdx = content.split("\n").findIndex((l) => /SUPABASE_SERVICE_ROLE_KEY|service_role/i.test(l));
      findings.push({
        id: `secrets-service-role-${relPath}`,
        phase: "0-data-exposure",
        severity: "critical",
        title: "Supabase service role key referenced outside a server-only file",
        detail: "The service role key bypasses Row Level Security entirely. It must never be referenced in client components or any file bundled to the browser.",
        file: relPath,
        line: lineIdx >= 0 ? lineIdx + 1 : undefined,
      });
    }
  }

  return findings;
}
