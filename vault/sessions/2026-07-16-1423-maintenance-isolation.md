---
type: session
date: 2026-07-16-1423
branch: main
trigger: wrapup
status: complete
tags: [session, architecture/tenancy, security/isolation, product/api]
related:
  - "[[00-north-star]]"
  - "[[architecture]]"
  - "[[roadmap]]"
  - "[[2026-07-16-1403-organization-export-isolation]]"
---

# Prove maintenance isolation

## What changed

- Added a checksum-pinned reviewed migration for organization-owned maintenance schedules and append-only completion records under forced RLS.
- Added idempotent owner/admin schedule creation and completion operations plus all-member schedule reads with uniform pilot/viewer mutation denial.
- Derived flight-hour and flight-count consumption from active canonical flights after the latest completion or initial baseline, with one-shot-date support and explained condition state.
- Proved payload-redacted audits, complete-export manifest accounting, pooled-context clearing, composite aircraft/schedule ownership, and uniform exact-ID denial.
- Expanded the executable isolation contract to twenty-three customer tables and committed the source slice as `882cfb7`.

## Why

Maintenance depends on corrected canonical flight usage, so a separate counter would risk drift and cross-organization leakage. This slice keeps schedule state derived from the same active flight records while making completion history durable and organization-scoped.

## Verification

- Ran the native ephemeral PostgreSQL, pg-boss, and loopback API suite: 28 passed, zero skipped, zero failed across twenty-three forced-RLS customer tables.
- Ran the complete existing host suite: 78 passed, zero skipped, zero failed.
- Checked JavaScript syntax, all five pinned migration digests, declared isolation-contract expansion, Git whitespace, the focused schema/API/documentation diff, and privacy patterns.
- No Docker, persistent PostgreSQL service, real object provider, raw fixture, private coordinate, credential, or customer data was used.

## Open threads

- Generate complete-export JSON/CSV/archive bytes and link an artifact through an idempotent worker transition without selecting a real storage provider.
- Repeat export, expiry, revocation, object access, and deletion against real object-storage artifacts.
- Prove permanent database, object, log, and backup deletion paths.
- Prove atomic dispatch, worker termination, cancellation, queue-age observability, and idempotent domain mutation before accepting pg-boss under D-011.
- Keep D-002 and D-011 proposed; production operations and D-012 gates remain separate.

## Next session entry point

Resume from source commit `882cfb7` plus this vault-only closeout. Continue P0-05 with the smallest complete-export generation proof: deterministic documented JSON/CSV content from the stored RLS manifest, idempotent worker state transition, organization-derived artifact reference, retry and cross-organization tests, and no real storage provider.
