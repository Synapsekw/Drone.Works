---
type: session
date: 2026-07-15-1845
branch: main
trigger: wrapup
status: complete
tags: [session, architecture/tenancy, security/isolation, architecture/queues]
related:
  - "[[00-north-star]]"
  - "[[architecture]]"
  - "[[roadmap]]"
  - "[[2026-07-15-1836-download-authorization-isolation]]"
---

# Prove real-queue retry isolation

## What changed

- Added pinned pg-boss persistence to the native PostgreSQL isolation spike without using Docker or a persistent service.
- Added a non-superuser queue role that owns only its infrastructure schema and has no customer-table grants.
- Restricted durable flight-refresh payloads to a version, organization ID, and flight ID; enqueue and execution both reject ID-only or unexpected private material.
- Proved a failed Alpha attempt remains Alpha-scoped through retry on the one-connection RLS pool, while a Beta-scoped Alpha ID completes as not found without reaching the domain handler.
- Proved an ID-only payload inserted by bypassing the enqueue adapter is rejected during execution and reaches terminal failed state; committed the source slice as `e2d1a2b`.

## Why

The earlier repository lookup proved organization context only in memory. This slice shows the same fail-closed contract survives durable queue storage, pooled connection reuse, a real failure transition, and retry while keeping customer-table authority outside the queue role.

## Verification

- Ran the native ephemeral PostgreSQL suite: 13 passed, zero skipped, zero failed, including queue-role grants, durable payload inspection, retry, and cross-organization denial.
- Ran the complete existing host suite outside the outer sandbox: 78 passed, zero skipped, zero failed, including loopback provider behavior and real macOS parser network denial.
- Checked Git whitespace and reviewed the focused architecture, migration, adapter, test, and lockfile changes before committing.
- No Docker, persistent PostgreSQL service, real object provider, raw fixture, or customer data was used.

## Open threads

- Integrate the full Phase 1 API role matrix, including pilot-own-flight raw/export scope and cross-organization IDOR denial.
- Prove worker termination, cancellation, queue-age observability, and idempotent domain mutation before accepting pg-boss under D-011.
- Repeat download expiry, membership revocation, object access, and deletion against real object-storage artifacts.
- Define observable privileged migration/maintenance access and prove migration-tool preservation of ownership, grants, policies, and forced RLS.
- Keep D-002 and D-011 proposed; broader fixtures and production D-012 gates remain separate.

## Next session entry point

Resume from source commit `e2d1a2b` plus this vault-only closeout. Continue P0-05 with the smallest versioned API authorization proof over the current schema: enforce the owner/admin/viewer/pilot-own-flight matrix and cross-organization IDOR denial without broadening the Phase 1 contract.
