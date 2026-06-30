# shiprun

Scans your vibe-coded Next.js + Supabase app and tells you exactly what's
missing to make it production-ready — as a phased, file:line checklist that
remembers what you've already fixed or dismissed, not a one-shot generic
scanner dump.

```
npx shiprun
```

That's the whole interface. No account, no API key, no config required to
get a first result.

## Why this exists

Carnegie Mellon found that ~61% of AI-generated code is functionally correct
but only ~10.5% is secure. The common failure pattern in vibe-coded apps
isn't "broken" — it's "works perfectly, wide open": a REST endpoint with no
auth check, an admin route protected only by a client-side flag, a public
storage bucket holding user uploads, a service-role key shipped to the
browser. shiprun is built to catch exactly that category of gap, specific to
the Next.js + Supabase stack most vibe-coding tools (Lovable, Bolt, Replit,
v0, Cursor) default to.

It is **not** a general security scanner (Semgrep/Snyk already do that well)
and **not** a memory/knowledge-graph tool (codebase-memory-mcp, claude-mem do
that well). It's narrowly the "what's missing to make this a real app"
checklist for one specific, common stack — see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full reasoning behind
that scope.

## Install

shiprun is a local Node CLI. Three ways to run it, depending on how it's
distributed at the moment:

```bash
# once published to npm (not yet):
npx shiprun

# from a local clone/copy of this repo:
npm install
npm run build
node dist/cli.js scan          # from inside the target repo, or...
npm link                       # ...then `shiprun` works globally
```

Requires Node ≥ 18.

## Usage

Run it from the root of the repo you want scanned:

```bash
shiprun
```

This is shorthand for `shiprun scan`. It:

1. Detects the stack (`detect.ts`: looks for `next`/`next.config.*` and
   `@supabase/supabase-js`/`supabase/`). If neither Next.js signal is found,
   it warns and most checks no-op — see [Limitations](#limitations).
2. Runs every check in `src/checks/*.ts` in parallel against the repo.
3. Reconciles results into `.shiprun/findings.json` (see
   [Persistence](#persistence) below).
4. Writes `SHIPRUN.md` to the repo root: open findings only, grouped into
   four phases, each with severity, file:line, an explanation, and a
   dismissable `id`.
5. Appends one line to `.shiprun/history.jsonl`.
6. Prints a one-line summary to the terminal (open count, critical/high
   counts, new/resolved since last scan).

### The four phases

| Phase | Question it answers |
|---|---|
| **0 — Doesn't leak data** | Can someone outside the app read data they shouldn't? (secrets, RLS, public buckets, vulnerable deps) |
| **1 — Has the auth/validation a real app needs** | Can someone do something they shouldn't? (missing auth checks, CORS, rate limiting, input validation) |
| **2 — Deployable** | Can this actually ship? (CI, build script) |
| **3 — Monitorable** | Will you know when it breaks? (error tracking) |

Full detail on every individual check — exact pattern, what it does and
doesn't catch, known false-positive cases, the fix — is in
[docs/CHECKS.md](docs/CHECKS.md). Read that before trusting or dismissing a
finding.

### Commands

```
shiprun [scan]              run all checks, write SHIPRUN.md
  -o, --out <file>            output file (default: SHIPRUN.md)

shiprun dismiss <id>        suppress a finding — excluded from future scans
  -r, --reason <reason>       why (recorded in findings.json, not required)

shiprun reopen <id>         undo a dismissal or a resolution

shiprun list                list findings known for this repo
  -a, --all                   include resolved/dismissed (default: open only)
```

`<id>` comes from the `id:` line under each finding in `SHIPRUN.md`, or from
`shiprun list --all`.

## Persistence

Every scan reconciles fresh results into `.shiprun/findings.json`, which is
meant to be **committed to your repo** so state is shared across machines and
teammates — it's a few KB of JSON, not a database, not a secret.

- **Fix the underlying issue, re-scan** → the finding disappears from
  `SHIPRUN.md` and is recorded as `resolved` (with a timestamp) in the store.
  If it comes back later (regression), it reopens automatically.
- **Decide a finding doesn't apply** → `shiprun dismiss <id> --reason "..."`.
  It's excluded from `SHIPRUN.md` from then on, *even though the underlying
  pattern is still detected* — dismissal is permanent until you `reopen` it.
- `.shiprun/history.jsonl` is an append-only log, one line per scan, counts
  only (no file contents, no finding text) — safe to keep forever, useful
  for "how many open findings did we have a month ago."

Full schema and the reasoning for "flat JSON, not a graph database" is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#why-shirunfindingsjson-not-a-graph-database).

## What checks actually look like

Every check is a pure function `(stack: StackInfo) => Promise<Finding[]>`
that pattern-matches file contents or paths — no LLM, no network call, no
control-flow analysis. Example: `auth-missing-<path>` flags any Next.js API
route that calls the database (`.from(`, `prisma.x.find`, etc.) but contains
no auth-check pattern (`auth.getUser(`, `getServerSession(`, etc.) anywhere
in the same file.

That also means it has a known blind spot: auth applied centrally in
`middleware.ts` is invisible to a per-route check, so a genuinely-protected
route can still get flagged. This is documented per-check, with the exact
failure mode, in [docs/CHECKS.md](docs/CHECKS.md) — when a check is wrong
for your repo, dismiss it rather than treating the output as gospel.

## Limitations

- **Stack-specific.** Checks are tuned for Next.js + Supabase. Run it on
  anything else and most checks silently no-op (their `if (!stack.isNextJs)
  return [];` guard at the top of the file) — you'll get a near-empty report,
  not an error.
- **Pattern matching, not program analysis.** No AST, no control-flow graph,
  no import tracing. See [docs/CHECKS.md](docs/CHECKS.md#what-none-of-these-checks-do-by-design-for-now)
  for the full list of what this rules out.
- **`npm audit` only.** pnpm/yarn lockfiles aren't read yet.
- **No judgment-call checks yet** — e.g. "does this route verify the caller
  *owns* the resource" requires reasoning, not regex, and isn't built. See
  Roadmap.

## Roadmap (not yet built)

- LLM judgment-call checks, routed through your own already-running Claude
  Code session (not a shiprun-owned API key) — so the deterministic layer
  stays free and instant, and reasoning-heavy checks cost you nothing extra
  to run.
- Generated `.claude/agents/*.md` specialists (security / backend+API /
  frontend / devops) that read `.shiprun/findings.json` directly, so
  `@security-agent fix the auth issue` starts from the actual finding instead
  of re-deriving context.
- A `SessionStart` hook that injects a short summary ("3 open critical
  findings, last scan 2 days ago") at the start of every Claude Code session
  in the repo.
- Broader stack support beyond Next.js + Supabase, once this one is proven.

This order is deliberate — see the build-order reasoning in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Each layer is gated on real
usage of the one before it, not built speculatively.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

MIT — see [LICENSE](LICENSE).
