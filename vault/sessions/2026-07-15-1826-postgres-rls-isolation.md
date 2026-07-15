---
type: session
date: 2026-07-15-1826
branch: main
trigger: wrapup
status: complete
tags: [session, architecture/tenancy, security/isolation, architecture/postgres]
related:
  - "[[00-north-star]]"
  - "[[architecture]]"
  - "[[roadmap]]"
  - "[[2026-07-15-1726-canonical-model-proof]]"
---

# Prove PostgreSQL RLS isolation

## What changed

- Added a native PostgreSQL 18 isolation spike over organizations, memberships, pilots, aircraft, canonical flights, revisions, and telemetry.
- Added forced RLS, separate migration/application roles, and composite organization foreign keys that prevent cross-organization relationships.
- Added an organization-required transaction wrapper and repository/job operations using transaction-local pooled context.
- Proved Alpha/Beta denial for direct IDs, joins, aggregates, exports, writes, missing context, jobs, and same-backend pool reuse.
- Documented the tenancy boundary and retained D-002 as proposed because object/download, API-role, real-queue, privileged-access, and deletion evidence remain open; committed the source slice as `ec9d5f6`.

## Why

P0-05 needed evidence that the generic P0-04 ownership model can be enforced below application query filters. This slice validates PostgreSQL RLS and composite ownership constraints as the relational mechanism while keeping non-relational and privileged-access gates explicit.

## Verification

- Clean-installed the pinned PostgreSQL client dependency with lifecycle scripts disabled.
- Ran the native ephemeral PostgreSQL suite: 7 passed, zero skipped, zero failed, including a one-connection pool test on the same backend PID.
- Ran the complete existing host suite outside the outer sandbox: 78 passed, zero skipped, zero failed, including the loopback provider contract and real macOS parser network denial.
- Checked JavaScript syntax, JSON parsing, Git whitespace, role/table policy state, repository privacy patterns, and that no persistent PostgreSQL service was started.
- No Docker or local container runtime was used.

## Open threads

- Add executable raw-source/export object-key derivation and short-lived download reauthorization, including membership revocation.
- Exercise organization-required payloads and retry behavior through a real background queue.
- Integrate the Phase 1 membership/role matrix at the API boundary and extend negative tests to remaining customer-owned resource types.
- Define observable migration/maintenance access and prove that the selected migration tool preserves roles, grants, policies, ownership, and forced RLS.
- Keep D-002 and D-011 proposed until the remaining P0-05/P0-07 gates close; broader fixtures and production D-012 gates remain separate.

## Next session entry point

Resume from source commit `ec9d5f6` plus this vault-only closeout. Continue P0-05 with the smallest object/download slice: add organization-owned raw-source and export references, derive keys only from authorized rows, and prove that cross-organization or revoked membership cannot mint a download.
