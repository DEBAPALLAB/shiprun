# Architecture

This document explains how shiprun is put together and, more importantly,
*why* — the design decisions here came out of an explicit "thinnest possible
v0, shrink scope until usage proves you need more" planning process. If you're
extending shiprun, read the "Design principles" section before adding
anything.

## File layout (source)

```
src/
  cli.ts            entry point (commander) — scan / dismiss / reopen / list
  types.ts           Finding, Severity, Phase, StackInfo
  detect.ts           stack detection (Next.js? Supabase?)
  walk.ts             fast-glob wrapper with default ignores
  scan.ts             orchestrator — runs all checks, flattens results
  report.ts           renders Finding[] -> SHIPRUN.md markdown
  store.ts            .shiprun/findings.json persistence + reconciliation
  hook.ts              generates .claude/hooks/shiprun-context.cjs +
                        registers it in the target repo's .claude/settings.json
  checks/
    secrets.ts         env exposure, literal keys, service-role key misuse
    rls.ts             missing Row Level Security on Supabase tables
    storage.ts         public Supabase storage buckets
    dependencies.ts     npm audit wrapper
    auth-routes.ts      API routes with no visible auth check
    cors.ts             wildcard CORS headers
    rate-limit.ts       auth routes with no rate-limiting hint
    validation.ts       routes parsing a body with no schema validation
    deployability.ts    missing CI / missing build script
    observability.ts    missing error-tracking SDK
```

## Data flow, one scan

```
cli.ts (scan command)
  -> detect.ts: detectStack(root)            -> StackInfo
  -> scan.ts: runScan(root)
       -> Promise.all([ ...every checks/*.ts function(stack) ])
       -> flatten -> Finding[]               (ephemeral, in-memory only)
  -> store.ts: reconcile(root, Finding[])
       -> load .shiprun/findings.json (or empty store)
       -> merge: new findings -> "open", open findings no longer
          detected -> "resolved", "dismissed" findings stay dismissed
       -> save .shiprun/findings.json
       -> returns { active, dismissed, newCount, resolvedCount }
  -> report.ts: renderMarkdown(stack, active, meta) -> string
  -> writeFileSync(SHIPRUN.md)
  -> store.ts: appendHistory(root, counts)   -> .shiprun/history.jsonl
```

Every `checks/*.ts` function has the same shape:
`(stack: StackInfo) => Promise<Finding[]>`. A `Finding` is a plain object —
`{ id, phase, severity, title, detail, file?, line? }` — with no behavior, no
references to other findings. This is deliberate: checks are pure functions
over the filesystem, independently testable, independently addable/removable
in `scan.ts`'s `Promise.all([...])` list with no coordination required
between them.

## Why `.shiprun/findings.json`, not a graph database

The original design discussion (before any code was written) considered a
full knowledge graph — nodes for files/commits/sessions/decisions, edges for
modifies/depends-on/caused-by. That was deliberately **not** built for v1.

The reasoning: the only thing v1 actually needs persisted is "did the user
already deal with this specific finding." That's a lookup by a stable string
ID, not a graph traversal. A flat JSON object keyed by finding ID does that
in full. Graph structure would only earn its complexity once findings need
to reference *each other* (e.g. "this auth fix touches the same file as that
unrelated RLS issue") — and nothing in shiprun today asks that question.

`findings.json` schema:

```ts
{
  version: 1,
  findings: {
    "<finding-id>": {
      // ...all Finding fields (id, phase, severity, title, detail, file?, line?)
      status: "open" | "resolved" | "dismissed",
      firstSeen: string,    // ISO timestamp, first scan that detected it
      lastSeen: string,     // ISO timestamp, most recent scan that detected it
      resolvedAt?: string,
      dismissedAt?: string,
      dismissedReason?: string,
    }
  }
}
```

`history.jsonl` is append-only, one JSON object per line, one line per scan
— counts only (`totalDetected`, `open`, `newCount`, `resolvedCount`,
`dismissedCount` + timestamp). No file contents, no finding detail, so it's
safe and cheap to keep growing indefinitely.

Both files are meant to be **committed to the host repo** (not gitignored)
so dismissal decisions and finding history are shared across a team and
across machines — that's the entire point of persisting them locally instead
of in a hosted service.

## Why deterministic checks only (no LLM in the loop yet)

Every check in `checks/*.ts` is regex/string matching against file content
or file paths, plus one `npm audit --json` subprocess call. None of it calls
an LLM. This was a sequencing decision, not a permanent one:

1. Deterministic checks are free to run, instant, and don't require the user
   to have any API key configured — zero friction to adopt.
2. The checks that actually need judgment (e.g. "does this route verify the
   caller *owns* the resource, not just that they're logged in") are a small
   minority and are explicitly **not yet built**.
3. When they are built, the plan is to route them through the user's own
   already-running Claude Code session rather than a shiprun-owned API key —
   so shiprun itself never touches LLM billing. See the "What's next"
   section in [README.md](../README.md).

This is why every false-positive-prone check in [CHECKS.md](./CHECKS.md) is
documented with its exact failure mode: until the judgment-call layer
exists, dismissal (`shiprun dismiss <id>`) is the only way to handle a check
that's technically correct about what it found but wrong about whether it
matters.

## Why a SessionStart hook, not an MCP server (yet)

The original design discussion considered an MCP server as the mechanism for
getting findings into Claude's context. That's overkill for what v1 actually
needs: a one-way push of a short summary at the start of a session, not a
queryable tool Claude calls mid-conversation.

`hook.ts` implements this as cheaply as the Claude Code hook contract allows:

- `ensureSessionStartHook(root)` writes a generated `.cjs` script to
  `.claude/hooks/shiprun-context.cjs` and registers it under
  `hooks.SessionStart` in `.claude/settings.json`, with `matcher: "startup"`.
- The script reads `.shiprun/findings.json` directly off disk — no IPC, no
  server process, no port. It prints plain text to stdout; Claude Code
  injects that text into context before the first prompt of the session
  (capped at 10,000 characters server-side; in practice this script's output
  is under 300).
- It fails closed: any error (missing file, malformed JSON) hits a bare
  `catch` that exits 0 with no output, so a broken store can never block
  Claude Code from starting a session.
- Registration is **merge, not overwrite** — `ensureSessionStartHook` reads
  any existing `.claude/settings.json`, only appends if no `shiprun-context`
  hook is already present, and leaves an unparseable existing file alone
  entirely rather than risk corrupting the user's settings.

An MCP server becomes worth the complexity once findings need to be
*queried* mid-conversation (e.g. "what's the history of changes to the
payments module") rather than just summarized at session start — that's
still future work, gated on whether anyone asks for it.

## Why npm/TypeScript, not Python or Rust

Distribution and ecosystem fit, not raw performance. shiprun ships via
`npx shiprun` — zero-install-friction matters more than language speed for a
tool that runs in seconds against a single repo. The tools it's meant to
sit alongside (`CLAUDE.md`, MCP servers, hooks, `.claude/agents/`) are all
JS-first tooling, and the target user (someone who shipped on Lovable/Bolt/
Replit/Cursor) already has Node installed because their original tool
required it.

## Stack detection (`detect.ts`)

`detectStack(root)` is intentionally shallow:

- `isNextJs`: `"next"` in `package.json` dependencies, or a
  `next.config.{js,ts,mjs}` file present.
- `usesSupabase`: `"@supabase/supabase-js"` in dependencies, or a
  `supabase/` directory present.

Every check that's Next.js- or Supabase-specific checks this flag first and
short-circuits to `[]` if the stack doesn't match — this is why running
shiprun against a non-Next.js repo currently returns almost nothing (see the
"Limitations" section in README.md). Broader stack support is future work,
not yet started.

## CLI command surface (`cli.ts`)

| Command | What it does |
|---|---|
| `shiprun` / `shiprun scan` | run all checks, reconcile into the store, write `SHIPRUN.md` |
| `shiprun dismiss <id> [-r reason]` | mark a finding `dismissed` — excluded from future reports even if still detected |
| `shiprun reopen <id>` | clear `dismissed`/`resolved` status back to `open` |
| `shiprun list [--all]` | print findings from the store; `--all` includes resolved/dismissed |

All four read/write the same `.shiprun/findings.json` via `store.ts` — there
is no separate database process, no daemon, nothing running between
invocations.

## Known architectural limitations (current)

- Every check operates on **whole-file content**, not an AST or control-flow
  graph. This is the root cause of most false positives documented in
  [CHECKS.md](./CHECKS.md) — e.g. middleware-level auth is invisible to the
  per-route `auth-missing` check because it never looks outside the file
  it's currently scanning.
- No cross-file import tracing.
- `dependencies.ts` only understands `package-lock.json` (npm). pnpm/yarn
  lockfiles are not read.
- Finding IDs are derived from file paths and check-specific strings. If you
  rename a flagged file, its finding ID changes, and the next scan will
  treat it as a brand new finding (with a separate `resolved` entry left
  behind for the old ID) rather than recognizing it as the same issue moved.
