---
type: session
date: 2026-07-16-2326
branch: main
trigger: wrapup
status: complete
tags: [session, roadmap/phase-1a, jobs, outbox]
related:
  - "[[00-north-star]]"
  - "[[roadmap]]"
  - "[[architecture]]"
  - "[[2026-07-16-2251-a06-immutable-upload]]"
---

# Complete A07 atomic dispatch

## What changed

- Added a separately owned, checksum-pinned jobs migration with a payload-free
  outbox and narrow application/dispatcher functions; customer tables and their
  forced-RLS isolation contract remain unchanged.
- Made immutable upload completion and one organization-scoped outbox reference
  atomic, with a stable pg-boss job identity, leased dispatch, retry/backoff,
  supervision, safe pending cancellation, and graceful shutdown.
- Added strict private job validation plus ordinary-pool RLS reload before a
  handler, payload-redacted aggregate queue metrics, and authorized import status
  and cancellation operations in generated public contracts.
- Added the dispatcher process, Docker-free local runtime integration, canonical
  A07 behavior/decision/operations evidence, and six native jobs tests; committed
  the implementation as `e323348`.

## Why

A08 needs one durable, retry-safe processing handoff that cannot weaken A04
tenancy or let queue payloads become a second customer-data store. The separate
jobs ownership boundary keeps the application and dispatcher away from direct
outbox access while workers re-enter through the existing forced-RLS pool.

## Verification

- `corepack pnpm verify`, `corepack pnpm build`, `corepack pnpm test:contract`,
  contract drift, formatting, lint, strict types, boundaries, source privacy,
  and Git whitespace checks passed; all four API contract tests passed.
- `corepack pnpm test:jobs` passed six atomicity, recovery, cancellation,
  redaction, tenant-swap, and pooled-context tests; the final
  `corepack pnpm test:database` replay passed all six A04 isolation tests.
- A06 upload and A05 authorization regressions each passed six tests during the
  block. One `dev:up` → `smoke:local` → `dev:down` cycle proved the dispatcher
  reached durable `dispatched` state and removed all generated runtime state.
- No Docker, parser execution, Better Auth, AWS/RDS resource or credential,
  customer data, or private fixture was used.

## Open threads

- A08 is next: package the exact native parser supervisor behind the strict A07
  worker boundary without enabling external DJI access or normalization.
- A09 provider enablement remains external and disabled; A13b verified Better
  Auth remains mandatory before A14 can deploy any hosted environment.
- The unrelated `.obsidian/app.json` change remains unstaged and untouched.

## Next session entry point

Resume at A08 in the Phase 1A backlog. Preserve the strict job payload, ordinary
forced-RLS reload, immutable exact-version source, and payload-free telemetry;
stop before A09 provider access or A10 normalization.
