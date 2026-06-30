import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { StackInfo } from "./types.js";

export function detectStack(root: string): StackInfo {
  const pkgPath = join(root, "package.json");
  let deps: Record<string, string> = {};

  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      deps = { ...pkg.dependencies, ...pkg.devDependencies };
    } catch {
      // unreadable package.json, treat as no deps detected
    }
  }

  const isNextJs = "next" in deps || existsSync(join(root, "next.config.js")) || existsSync(join(root, "next.config.ts")) || existsSync(join(root, "next.config.mjs"));
  const usesSupabase = "@supabase/supabase-js" in deps || existsSync(join(root, "supabase"));

  return { isNextJs, usesSupabase, root };
}
