import fg from "fast-glob";

const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.next/**",
  "**/dist/**",
  "**/build/**",
  "**/.vercel/**",
  "**/coverage/**",
];

export async function listFiles(root: string, patterns: string[]): Promise<string[]> {
  return fg(patterns, {
    cwd: root,
    ignore: DEFAULT_IGNORE,
    dot: true,
    absolute: true,
    onlyFiles: true,
  });
}
