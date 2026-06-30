import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HOOK_SCRIPT_RELPATH = ".claude/hooks/shiprun-context.cjs";
const HOOK_MARKER = "shiprun-context.cjs";

// Plain CommonJS regardless of the host repo's package.json "type" field —
// .cjs forces Node to parse it as CommonJS no matter what.
const HOOK_SCRIPT = `#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");

// this file lives at <project>/.claude/hooks/shiprun-context.cjs
const findingsPath = path.join(__dirname, "..", "..", ".shiprun", "findings.json");

try {
  if (!fs.existsSync(findingsPath)) process.exit(0);
  const store = JSON.parse(fs.readFileSync(findingsPath, "utf8"));
  const open = Object.values(store.findings || {}).filter((f) => f.status === "open");
  if (open.length === 0) process.exit(0);

  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  open.sort((a, b) => order[a.severity] - order[b.severity]);

  const counts = {};
  for (const f of open) counts[f.severity] = (counts[f.severity] || 0) + 1;
  const countStr = Object.entries(counts)
    .map(([sev, n]) => \`\${n} \${sev}\`)
    .join(", ");

  const top = open
    .slice(0, 3)
    .map((f) => \`- [\${f.severity}] \${f.title}\${f.file ? \` (\${f.file}\${f.line ? \`:\${f.line}\` : ""})\` : ""}\`)
    .join("\\n");

  console.log(
    [
      \`shiprun: \${open.length} open finding(s) (\${countStr}).\`,
      top,
      \`Run "shiprun list" for the full list, "shiprun dismiss <id>" to suppress one that doesn't apply.\`,
    ].join("\\n")
  );
  process.exit(0);
} catch {
  // never block session start over a malformed/missing store
  process.exit(0);
}
`;

interface HookEntry {
  type: string;
  command: string;
  args?: string[];
  timeout?: number;
}

interface MatcherEntry {
  matcher: string;
  hooks: HookEntry[];
}

interface ClaudeSettings {
  hooks?: {
    SessionStart?: MatcherEntry[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface HookInstallResult {
  installed: boolean; // true only if this call newly registered the hook
  settingsPath: string;
}

/**
 * Writes the generated hook script and registers it as a SessionStart hook
 * in .claude/settings.json. Idempotent: safe to call on every scan. Leaves
 * any unrelated settings/hooks the user already has untouched.
 */
export function ensureSessionStartHook(root: string): HookInstallResult {
  const hookDir = join(root, ".claude", "hooks");
  if (!existsSync(hookDir)) mkdirSync(hookDir, { recursive: true });
  writeFileSync(join(root, HOOK_SCRIPT_RELPATH), HOOK_SCRIPT, "utf8");

  const settingsPath = join(root, ".claude", "settings.json");
  let settings: ClaudeSettings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
      // unparseable existing settings.json — don't touch it, don't crash the scan
      return { installed: false, settingsPath };
    }
  }

  settings.hooks = settings.hooks ?? {};
  const sessionStart = settings.hooks.SessionStart ?? [];
  settings.hooks.SessionStart = sessionStart;

  const alreadyRegistered = sessionStart.some((matcher) =>
    matcher.hooks?.some((h) => h.command?.includes(HOOK_MARKER) || h.args?.some((a) => a.includes(HOOK_MARKER)))
  );

  if (alreadyRegistered) {
    return { installed: false, settingsPath };
  }

  sessionStart.push({
    matcher: "startup",
    hooks: [
      {
        type: "command",
        command: "node",
        args: ["${CLAUDE_PROJECT_DIR}/" + HOOK_SCRIPT_RELPATH],
        timeout: 10,
      },
    ],
  });

  if (!existsSync(join(root, ".claude"))) mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");

  return { installed: true, settingsPath };
}
