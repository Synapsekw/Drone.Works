---
type: session
date: 2026-07-16-2224
branch: main
trigger: wrapup
status: complete
tags: [session, roadmap/phase-1a, identity, authorization]
related:
  - "[[00-north-star]]"
  - "[[roadmap]]"
  - "[[architecture]]"
  - "[[2026-07-16-2145-local-first-auth-sequence]]"
---

# Complete A05 local authorization

## What changed

- Added a provider-neutral identity source and named generated personas behind
  an explicit local/test-only startup interlock.
- Added versioned organization creation/selection and membership operations
  that reload current app-owned roles through the ordinary forced-RLS pool.
- Added owner membership and pilot linking, immediate member removal, retained
  pilot history, serialized last-owner protection, and payload-redacted audits.
- Added generated contracts, hosted/public route-inventory guards, native
  authorization tests, CI coverage, and integrated local smoke behavior.
- Updated canonical behavior, acceptance, D-015 evidence, security gates, and
  the backlog; committed the implementation as `99ed78a`.

## Why

The functional local application now has a replaceable identity seam without
pretending generated personas are authentication. Authorization remains
app-owned and database-enforced, so A13b can replace only the identity source.

## Verification

- `corepack pnpm verify`, `corepack pnpm test:contract`, and
  `corepack pnpm build` passed; four API contract tests, generated OpenAPI/client
  drift, formatting, lint, strict types, boundaries, and source privacy passed.
- `corepack pnpm test:database` passed all six A04 tests, and
  `corepack pnpm test:authorization` passed all six A05 tests against separate
  disposable native PostgreSQL clusters.
- One `dev:up` → `smoke:local` → `dev:down` cycle passed the generated
  identity-to-Alpha-membership path and removed all generated runtime state.
- Frozen dependency installation and Git whitespace checks passed. No Docker,
  Better Auth, upload, AWS resource/credential, customer data, or private
  fixture was used.

## Open threads

- A06 is next: add checksum-bound immutable raw upload through the existing
  loopback object boundary without starting jobs, parsing, or AWS.
- A09 provider enablement remains external and disabled; A13b verified Better
  Auth remains mandatory before A14 can deploy any hosted environment.
- The unrelated `.obsidian/app.json` change remains unstaged and untouched.

## Next session entry point

Resume at A06 in the Phase 1A backlog. Preserve A05 membership/RLS checks while
adding the smallest idempotent upload declaration/completion slice against the
loopback object service; stop before A07 dispatch or A08 parsing.
