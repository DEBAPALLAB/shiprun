# Check reference

Every check below is **deterministic**: regex / pattern matching over file
contents and file paths, plus one subprocess call (`npm audit`). No network
calls, no LLM, no API key required. This document describes exactly what each
check does, so you can judge for yourself when it'll be wrong.

Each finding has a stable `id`. Use that id with `shiprun dismiss <id>` if a
finding doesn't apply to your situation — see [README.md](../README.md#persistence)
for the persistence model.

### Readiness score

`SHIPRUN.md` and the terminal output both show `Readiness: N/100`. It's
computed in `src/report.ts` as `100 - sum(penalty per open finding)`, where
`critical = 15`, `high = 8`, `medium = 3`, `low = 1`, floored at 0. This is a
heuristic for "how loud should this number be," not a certification — two
repos with the same score can have very different actual risk if one's
findings are all dismissable false positives and the other's aren't. Read
the actual findings, not just the number.

---

## Phase 0 — Doesn't leak data

### `secrets-env-not-gitignored`
**File:** `src/checks/secrets.ts` · **Severity:** critical

Looks for `.env`, `.env.local`, `.env.production`, `.env.development` at the
repo root. If any exist, reads `.gitignore` and checks for a line starting
with `.env` or containing `.env*`. If no such line exists, flags it.

- **Triggers on:** any of those four exact filenames present with no
  `.gitignore` rule covering them.
- **Does not trigger on:** `.env.example` (that file should be tracked).
- **False positive case:** you intentionally vendor a non-secret `.env.test`
  with dummy values and don't mind it being committed — dismiss it.
- **Fix:** add `.env*` to `.gitignore`, keep `.env.example` as the only
  tracked one (and `git rm --cached` anything already committed — see the
  next check).

### `secrets-env-tracked-<path>`
**File:** `src/checks/secrets.ts` · **Severity:** critical

Runs `git ls-files` and checks whether any of the four `.env*` filenames
above are actually tracked by git (committed, not just present on disk).
This is strictly worse than "not gitignored" — if the repo has ever been
pushed, the secrets are already on the remote and in history.

- **Requires:** the scanned directory to be a git repository. If `git
  ls-files` fails (no git, not a repo), this check silently skips — no
  finding, no error printed.
- **Fix:** the detail text spells this out — removing the file does **not**
  remove it from git history. You need `git filter-repo` or BFG to scrub
  history, and you must rotate every credential that was ever in that file,
  not just delete it going forward.

### `secrets-literal-<provider>-<path>`
**File:** `src/checks/secrets.ts` · **Severity:** critical

Scans every `.ts`/`.tsx`/`.js`/`.jsx`/`.json`/`.env*` file (excluding
`.env.example`) for strings shaped like a live credential from a specific
provider:

| Provider | Pattern |
|---|---|
| AWS access key | `AKIA[0-9A-Z]{16}` |
| Stripe live secret key | `sk_live_[0-9a-zA-Z]{16,}` |
| Stripe live restricted key | `rk_live_[0-9a-zA-Z]{16,}` |
| OpenAI API key | `sk-...T3BlbkFJ...` or `sk-proj-...` |
| GitHub PAT | `gh[pousr]_[A-Za-z0-9]{36,}` |
| Slack token | `xox[baprs]-...` |

- **Why these and not a generic high-entropy-string scanner:** generic
  entropy detection is noisy (hashes, UUIDs, base64 assets all look
  "random"). Provider-prefixed patterns are near-zero false-positive by
  construction — `AKIA...` is not coincidentally going to appear in normal
  code.
- **Does not catch:** test/sandbox keys that don't match these prefixes
  (e.g. Stripe's `sk_test_...` is deliberately excluded — it's not a live
  credential), or secrets pasted into non-code files (`.md`, `.txt`, `.yml`
  aren't scanned by this check).
- **Fix:** move to an environment variable, then rotate the key (assume it's
  compromised the moment it's been on disk in a repo, even if never pushed).

### `secrets-service-role-<path>`
**File:** `src/checks/secrets.ts` · **Severity:** critical

Scans the same TS/JS files for the literal strings `SUPABASE_SERVICE_ROLE_KEY`
or `service_role` (case-insensitive). If found, the file is flagged unless it
looks server-only:

- A file is considered "likely server-only" if its path matches `/api/`,
  `/server/`, `*.server.ts`, `middleware.ts`, or ends in `route.ts`/`route.js`.
- A file is flagged regardless of path if it starts with a `"use client"`
  directive (Next.js client component marker).

This is a **path-based heuristic**, not a bundler analysis — it does not
actually check whether the file ends up in the client bundle.

- **False positive case:** a server-only utility file that doesn't match any
  of the path hints above (e.g. `lib/admin.ts` with no `/server/` segment)
  will be flagged even though it's never imported client-side. Dismiss it if
  you've verified it's genuinely server-only.
- **False negative case:** a file matching `/server/` in its path that is
  nonetheless imported into a client component (re-export, barrel file) will
  not be caught — this check doesn't trace imports.
- **Fix:** never reference the service role key outside code that runs only
  on the server (API routes, server actions, server components without a
  client boundary).

### `rls-missing-<table>`
**File:** `src/checks/rls.ts` · **Severity:** critical
**Requires:** Supabase detected (`@supabase/supabase-js` dependency or a
`supabase/` directory)

Parses every `*.sql` file under `supabase/migrations/` and `supabase/` for:

- `CREATE TABLE [IF NOT EXISTS] [public.]<name>` → records the table name
  and the file it was created in.
- `ALTER TABLE [public.]<name> ENABLE ROW LEVEL SECURITY` → records that the
  table has RLS enabled.

After scanning all files, any table that was created but never had RLS
enabled is flagged.

- **Does not check:** whether the RLS policies that exist are actually
  correct (e.g. a `USING (true)` policy that effectively disables RLS would
  not be flagged — this is presence-of-RLS, not soundness-of-policy).
- **Does not check:** tables created outside `supabase/migrations/` (e.g.
  directly in the Supabase dashboard with no migration file) — those are
  invisible to this check entirely, by definition, since there's no file to
  scan.
- **False positive case:** a junction/lookup table that's intentionally
  public (e.g. a `countries` reference table). Dismiss it.
- **Fix:** `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;` plus at least one
  `CREATE POLICY` matching your actual access model.

### `storage-public-bucket-sql-<path>` / `storage-public-bucket-js-<path>`
**File:** `src/checks/storage.ts` · **Severity:** high
**Requires:** Supabase detected

Two variants of the same check:

- **SQL:** any `INSERT INTO storage.buckets (...) VALUES (...)` statement in
  a migration file whose values clause contains a literal `true` is flagged
  (this is intentionally loose — it does not parse column order, so a
  coincidental `true` anywhere in the values list will match).
- **JS/TS:** any call shaped like `createBucket('name', { ...public: true... })`.

- **False positive case (SQL variant):** a bucket insert with an unrelated
  boolean column set to `true` that isn't the `public` column — the SQL
  regex doesn't parse column names, just looks for `true` anywhere in the
  statement. Verify before treating as urgent; dismiss if it's a different
  column.
- **Fix:** confirm the bucket is meant to be public (e.g. avatars, marketing
  assets). If it holds user documents or anything with personal data, create
  it with `public: false` and serve files through signed URLs instead.

### `deps-critical-vulns` / `deps-high-vulns`
**File:** `src/checks/dependencies.ts` · **Severity:** critical / high

Runs `npm audit --json` as a subprocess (only if `package-lock.json` exists)
and reads `metadata.vulnerabilities.critical` / `.high` from the output. One
finding per non-zero severity bucket, with the count in the title.

- **Requires:** `package-lock.json` present (no lockfile → check is skipped
  entirely — this does not run for `pnpm-lock.yaml` or `yarn.lock` projects
  yet).
- **Does not run** `npm audit fix` — read-only, reporting only.
- **Fix:** run `npm audit` locally for the full list, `npm audit fix` for
  what's auto-fixable.

---

## Phase 1 — Has the auth/validation a real app needs

### `auth-missing-<path>`
**File:** `src/checks/auth-routes.ts` · **Severity:** high
**Requires:** Next.js detected

Scans `app/**/route.ts(x)` and `pages/api/**/*.ts(x)` (and their `src/`
variants). A file is flagged if it contains a DB-call pattern —
`.from(`, `supabase.rpc(`, `prisma.<model>.(find|create|update|delete)`, or
`db.query(` — but does **not** contain an auth-check pattern anywhere in the
same file: `auth.getUser(`, `auth.getSession(`, `getServerSession(`,
`requireAuth`, `currentUser(`, `getAuth(`.

- **This is whole-file presence, not control-flow analysis.** It does not
  verify the auth check actually runs *before* the DB call, or that it's on
  the same code path (e.g. an auth check inside an unrelated branch of the
  same file would suppress the finding even if the DB-call branch is
  unguarded).
- **False positive case:** a route that's intentionally public (e.g. a
  public blog post listing) will be flagged because it queries the DB with
  no auth check — which is correct behavior, just not a *problem* in that
  case. Dismiss it.
- **False negative case:** auth middleware applied centrally (e.g. Next.js
  `middleware.ts` gating the whole `/api/*` path) won't be visible from
  inside an individual route file, so genuinely-protected routes may still
  get flagged. This is the single biggest source of false positives in v1 —
  dismiss routes covered by middleware-level auth.
- **Fix:** add an explicit auth/session check before any DB call that
  shouldn't be publicly reachable.

### `cors-wildcard-<path>`
**File:** `src/checks/cors.ts` · **Severity:** high
**Requires:** Next.js detected

Scans API routes, `middleware.ts`, and `next.config.*` for a header value
shaped like `Access-Control-Allow-Origin: *` (or `'*'`/`"*"`, comma- or
colon-separated key/value).

- **Fix:** restrict to your known frontend origin(s), or omit the header
  entirely if the route doesn't need cross-origin access.

### `rate-limit-missing-<path>`
**File:** `src/checks/rate-limit.ts` · **Severity:** medium
**Requires:** Next.js detected

First filters route files to ones whose **path** suggests an auth flow:
matches `login`, `signin`/`sign-in`, `signup`/`sign-up`, `register`,
`reset-password`, `forgot-password`, `magic-link`, or `otp` (case-insensitive,
anywhere in the path). For those files only, checks file contents for any
rate-limiting hint: `ratelimit`, `rate-limit`, `@upstash/ratelimit`,
`express-rate-limit`, `rate_limit`.

- **Path-based filtering means:** an auth route with a path that doesn't
  contain one of those keywords (e.g. `app/api/session/route.ts` handling
  login) is invisible to this check.
- **Content check is a keyword hint, not a verification** that the rate
  limiter is actually applied to this specific handler — importing a
  rate-limit library anywhere in the file is enough to suppress the finding,
  even if it's unused.
- **False positive case:** rate limiting applied centrally in middleware
  rather than per-route — same caveat as the auth-missing check above.
- **Fix:** add per-route or middleware-level rate limiting to anything that
  accepts credentials.

### `validation-missing-<path>`
**File:** `src/checks/validation.ts` · **Severity:** medium
**Requires:** Next.js detected

Flags route files that read the request body (`request.json(`, `req.body`,
`await req.json(`) but show no sign of schema validation: no `.parse(`,
`.safeParse(`, and no mention of `zod`, `yup`, `joi.object`, or
`@hookform/resolvers` anywhere in the file.

- **Keyword presence, not usage verification** — importing zod elsewhere in
  the file for an unrelated purpose would suppress this finding.
- **Fix:** validate the parsed body against a schema before using it.

---

## Phase 2 — Deployable

### `deploy-no-ci`
**File:** `src/checks/deployability.ts` · **Severity:** medium

Checks for the existence of `.github/workflows/`, `.gitlab-ci.yml`, or
`vercel.json`. None present → flagged. Does not check whether an existing CI
config actually runs tests/lint/build — presence only.

### `deploy-no-build-script`
**File:** `src/checks/deployability.ts` · **Severity:** medium

Reads `package.json`, checks `scripts.build` exists. Does not validate the
script actually succeeds.

---

## Phase 3 — Monitorable

### `observability-no-error-tracking`
**File:** `src/checks/observability.ts` · **Severity:** low

Reads `package.json` dependencies (+ devDependencies) for any of:
`@sentry/nextjs`, `@sentry/node`, `@sentry/browser`, `@highlight-run/node`,
`bugsnag`. None present → flagged.

- **Dependency presence only** — does not check the SDK is actually
  initialized anywhere in the app.

---

## What none of these checks do (by design, for now)

- No control-flow / data-flow analysis — every check is "does this pattern
  exist in this file," not "does this execution path lead to this outcome."
  This is the main source of false positives, concentrated in middleware-
  level auth/rate-limiting setups (see `auth-missing` and
  `rate-limit-missing` above).
- No cross-file import tracing.
- No LLM judgment calls (e.g. "does this route check that the caller *owns*
  the resource, not just that they're logged in") — that's deliberately
  deferred to a future pass routed through your own Claude Code session, not
  a hosted API key. See the roadmap in [README.md](../README.md).
- No support for non-npm package managers' lockfiles in the dependency check
  (pnpm/yarn) yet.

If a check is wrong for your repo, the right move is `shiprun dismiss <id>
--reason "..."` — not to treat the output as gospel.
