---
type: session
date: 2026-07-17-0824
branch: main
trigger: wrapup
status: complete
tags: [session, roadmap/phase-1a, local-development]
related:
  - "[[00-north-star]]"
  - "[[roadmap]]"
  - "[[operations]]"
  - "[[2026-07-17-0704-a08-parser-supervisor]]"
---

# Fix the local start command

## What changed

- Reproduced `pnpm dev` failing before startup because the root workspace had no
  `dev` script; the existing `dev:up` stack itself was healthy.
- Added `pnpm dev` as the conventional alias for the same generated local
  runtime orchestrator and retained `dev:up` as the explicit lifecycle command.
- Updated the local-development runbook to lead with the working conventional
  command and committed the fix as `2100b32`.
- Confirmed A09 cannot start truthfully yet: A08 hosted production-image evidence
  is pending, and the available v14 research path still requires the external
  D-012 legal/provider gate.

## Why

The documented local application was runnable, but the command developers
naturally try returned before any server could start. The alias removes that
avoidable first-run failure without changing runtime behavior or weakening the
remaining parser/provider gates.

## Verification

- The original `corepack pnpm dev` failure was reproduced as a missing command.
  After the fix, it printed a generated loopback web address, the complete
  `smoke:local` path passed, and `dev:down` removed all generated state.
- A separate explicit `dev:up` → `smoke:local` → `dev:down` cycle also passed API,
  dispatcher, worker, object/email services, generated authorization, immutable
  upload/dispatch, web, and PostgreSQL.
- `corepack pnpm verify` and Git whitespace checks passed, including eleven
  parser host tests and four API contract tests.
- The execution sandbox initially denied loopback binding and process-group
  termination; the same commands passed with approved local runtime permission.
  No Docker, push, private fixture, provider request, customer data, Better Auth,
  or AWS/RDS resource was used.

## Open threads

- A08 remains pending its exact production OCI, retained Linux containment,
  digest, and attestation workflow on the committed change; nothing was pushed.
- A09 then requires qualified D-012 approval for the encrypted v14 path or a new
  authorized supported unencrypted variant. Until then, parsing support remains
  disabled rather than claiming unsupported behavior.
- The unrelated `.obsidian/app.json` change remains unstaged and untouched.

## Next session entry point

Make the A08 commits available to hosted Linux CI without changing their pinned
evidence inputs, inspect every parser job, and update A08 only after the exact
production-image gate passes. Then resolve A09's qualified external path before
starting normalization.
