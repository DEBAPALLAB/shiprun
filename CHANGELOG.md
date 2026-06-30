# Changelog

All notable changes to this project are documented in this file.

## Unreleased

**Presentation pass — first-impression strength, no new checks.**

Added:
- `Readiness: N/100` score, shown in both terminal output and at the top of
  `SHIPRUN.md` (weighted by open finding severity — see
  [docs/CHECKS.md](docs/CHECKS.md#readiness-score)).
- Phase breakdown table at the top of `SHIPRUN.md`.
- README rewritten with a real captured sample (terminal + report excerpt)
  instead of a description-only pitch.
- Full documentation set: `docs/CHECKS.md`, `docs/ARCHITECTURE.md`,
  `CHANGELOG.md`, `LICENSE`.

## 0.3.0

**Strengthened existing checks — no new architecture.**

Added (all Phase 0 / Phase 1, deterministic, no LLM):
- `secrets-literal-<provider>-<path>` — hardcoded AWS, Stripe (live), OpenAI,
  GitHub, and Slack credential-shaped strings found directly in source.
- `secrets-env-tracked-<path>` — `.env` files actually committed to git
  (via `git ls-files`), not just missing from `.gitignore`.
- `storage-public-bucket-sql-<path>` / `storage-public-bucket-js-<path>` —
  Supabase storage buckets created with `public = true`.
- `cors-wildcard-<path>` — `Access-Control-Allow-Origin: *` in API routes,
  middleware, or `next.config.*`.
- `rate-limit-missing-<path>` — auth-flow routes (login/signup/reset-password
  paths) with no rate-limiting library reference.
- `validation-missing-<path>` — routes parsing a request body with no
  zod/yup/joi schema validation.

Fixed:
- `git ls-files` failures (e.g. scanning a non-git directory) were leaking
  `fatal: not a git repository` to stderr instead of failing silently.

## 0.2.0

**Persistence layer.**

Added:
- `.shiprun/findings.json` — every scan reconciles into a persisted store
  instead of regenerating findings from scratch each time.
- `shiprun dismiss <id> [--reason]` — suppress a finding so it's excluded
  from future reports even if the underlying pattern is still detected.
- `shiprun reopen <id>` — undo a dismissal or a resolution.
- `shiprun list [--all]` — list findings by status (open by default).
- Auto-resolution: a finding that was open and is no longer detected on
  re-scan is recorded as `resolved` with a timestamp.
- `.shiprun/history.jsonl` — append-only per-scan log (counts only).
- `SHIPRUN.md` now reports a diff each run (new / resolved / dismissed
  counts) instead of just a flat finding count.

## 0.1.0

**Initial v0 — deterministic scanner, no persistence.**

Checks shipped:
- `secrets-env-not-gitignored` — `.env` files present without a
  `.gitignore` rule.
- `secrets-service-role-<path>` — Supabase service role key referenced
  outside a server-only file.
- `rls-missing-<table>` — tables created in Supabase migrations with no
  matching `ENABLE ROW LEVEL SECURITY`.
- `auth-missing-<path>` — Next.js API routes that query the database with
  no visible auth check.
- `deps-critical-vulns` / `deps-high-vulns` — `npm audit` critical/high
  vulnerability counts.
- `deploy-no-ci` / `deploy-no-build-script` — missing CI config / missing
  `build` script.
- `observability-no-error-tracking` — no error-tracking SDK dependency.

CLI: `shiprun scan` only, writes `SHIPRUN.md`, no persistence between runs.
