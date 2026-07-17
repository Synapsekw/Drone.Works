---
type: session
date: 2026-07-17-1155
branch: main
trigger: wrapup
status: complete
tags: [session, roadmap/phase-1a, normalization, telemetry, tenancy]
related:
  - "[[00-north-star]]"
  - "[[roadmap]]"
  - "[[architecture]]"
  - "[[2026-07-17-1009-a09-v14-keychain-gate]]"
---

# Complete the A10 normalization gate

## What changed

- Promoted the canonical-v1 adapter into production packages with explicit
  imported, derived, effective, and user-override envelopes plus private source
  and parser provenance.
- Added organization-scoped stable aircraft identifiers, known/unseen/model-only/
  ambiguous matching, uploader pilot proposal, review-bound assignment states,
  and a checksum-pinned forced-RLS migration.
- Added deterministic `droneworks-columnar-json-gzip` telemetry version 1 with
  fixed columns, truthful nulls, immutable object metadata, and checksum
  verification.
- Made exact source and exact-normalized re-uploads converge on the retained
  flight, including redundant raw/telemetry object cleanup and retained attempt
  history.
- Added rollback-safe object/database persistence and proved recovery through a
  real pg-boss retry with payload-redacted audit and metric metadata.
- Updated the canonical behavior, decisions, domain model, local runbook, and
  backlog, then pushed implementation commit `1386603` to `origin/main`.

## Why

A11 needed one trustworthy persisted flight behind the completed parser and job
boundaries. A10 now turns the private parser result into organization-isolated,
provenance-aware relational and telemetry records without guessing assignments
or creating a second flight on exact retries.

## Verification

- `pnpm test:normalize` passed six native PostgreSQL/pg-boss integration tests
  covering the selected valid shape, exact retries and both duplicate classes,
  assignment evidence, telemetry checksum, object/transaction retry, real job
  retry, and Alpha/Beta pooled isolation.
- `pnpm test:database` passed seven migration/RLS tests; `pnpm test:upload`
  passed seven immutable-source tests; authorization and jobs each passed six;
  the production parser passed 20.
- `pnpm verify`, `pnpm build`, and `git diff --check` passed after the final
  implementation and documentation changes.
- The pushed commit is synchronized with `origin/main`. No new hosted workflow
  was listed for `1386603` at wrap-up, so the prior A09 hosted runs remain the
  latest hosted evidence.

## Open threads

- A11 is next: expose an authorized flight summary and bounded track replay from
  the retained revision and exact telemetry object without leaking object keys
  or private provenance.
- A12/A13a still own the functional web path; A13b must replace the local
  identity harness with verified authentication before A14.
- Hosted provider credentials, managed keys, AWS/RDS, and uploads beyond the
  completed immutable-source boundary remain off until their later gates.
- The unrelated `.obsidian/app.json` change and two untracked `index 2.ts`
  copies remain unstaged and untouched.

## Next session entry point

Start A11 from its backlog contract. Add the organization-authorized summary and
bounded replay API over A10's current revision and versioned telemetry object,
with exact-object checksum, null/gap, pagination/downsampling, redaction, and
Alpha/Beta tests.
