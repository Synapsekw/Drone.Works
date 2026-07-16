---
type: session
date: 2026-07-16-1403
branch: main
trigger: wrapup
status: complete
tags: [session, architecture/tenancy, security/isolation, product/api]
related:
  - "[[00-north-star]]"
  - "[[architecture]]"
  - "[[roadmap]]"
  - "[[2026-07-16-1346-remaining-resource-isolation]]"
---

# Prove organization-export isolation

## What changed

- Added a checksum-pinned reviewed migration for immutable organization-export request and manifest rows under forced RLS.
- Added owner/admin request creation and lookup with idempotent replay, pilot/viewer denial, payload-redacted audit, and uniform cross-organization not-found behavior.
- Built each manifest through the organization-scoped repository with canonical UTC time, organization settings, seventeen operational collection counts, and logical raw-source references.
- Added strict pg-boss references containing only schema version, organization ID, and export-request ID; execution reloads the manifest through the ordinary RLS pool.
- Proved pooled-context clearing, cross-organization queue denial, database snapshot immutability, and a twenty-one-table isolation-contract expansion; committed the source slice as `09613e0`.

## Why

Complete export crosses API, database, queue, and future object-storage boundaries. This slice proves that its request and manifest cannot escape their organization while deliberately leaving archive creation and storage-provider selection open.

## Verification

- Ran the native ephemeral PostgreSQL, pg-boss, and loopback API suite: 26 passed, zero skipped, zero failed across twenty-one forced-RLS customer tables.
- Ran the complete existing host suite: 78 passed, zero skipped, zero failed.
- Checked JavaScript syntax, all four pinned migration digests, declared isolation-contract expansion, Git whitespace, the focused schema/API/queue/documentation diff, and privacy patterns.
- No Docker, persistent PostgreSQL service, real object provider, raw fixture, private coordinate, credential, or customer data was used.

## Open threads

- Add remaining Phase 1 customer resources such as maintenance schedules and completions to the RLS and API role matrix.
- Generate complete-export archive bytes and artifact records, then prove dispatch and object lifecycle against a real provider.
- Prove permanent database, object, log, and backup deletion paths.
- Prove worker termination, cancellation, queue-age observability, and idempotent domain mutation before accepting pg-boss under D-011.
- Keep D-002 and D-011 proposed; production operations and D-012 gates remain separate.

## Next session entry point

Resume from source commit `09613e0` plus this vault-only closeout. Continue P0-05 with the smallest maintenance-resource proof: organization-owned maintenance schedules and completion records under forced RLS, owner/admin mutation, all-member reads where allowed, derived aircraft-usage scope, pooled reuse, and uniform cross-organization denial.
