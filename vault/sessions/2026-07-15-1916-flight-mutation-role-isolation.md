---
type: session
date: 2026-07-15-1916
branch: main
trigger: wrapup
status: complete
tags: [session, architecture/tenancy, security/isolation, product/api]
related:
  - "[[00-north-star]]"
  - "[[architecture]]"
  - "[[roadmap]]"
  - "[[2026-07-15-1857-versioned-api-role-isolation]]"
---

# Prove flight-mutation role isolation

## What changed

- Added versioned manual-flight creation with complete required fields, organization/user/operation-scoped idempotency, equivalent replay, and conflicting-input rejection.
- Added role-scoped note editing, pilot/aircraft reassignment, soft deletion, and restoration with uniform cross-organization and unauthorized not-found behavior.
- Added forced-RLS organization rows for assignment overrides, idempotency state, and payload-redacted audit events.
- Preserved the current imported pilot/aircraft baseline separately from the effective user reassignment so later processing can retain the override.
- Updated D-002 and tenancy evidence without accepting the isolation decision; committed the source slice as `2c089b0`.

## Why

The read/download API boundary did not yet prove the Phase 1 mutation role matrix or that idempotency and audit state remain organization-isolated on a reused connection. This slice closes the smallest flight-mutation gap while keeping framework, session-provider, and storage-provider choices open.

## Verification

- Ran the native ephemeral PostgreSQL and loopback API suite: 18 passed, zero skipped, zero failed across fourteen forced-RLS customer tables.
- Ran the complete existing host suite: 78 passed, zero skipped, zero failed, including loopback provider behavior and real macOS parser network denial.
- Checked JavaScript syntax, Git whitespace, the focused schema/API/documentation diff, assignment-override provenance, audit redaction, pooled context clearing, and privacy patterns.
- No Docker, persistent PostgreSQL service, real object provider, raw fixture, private coordinate, or customer data was used.

## Open threads

- Define observable privileged migration/maintenance access and prove migration-tool preservation of ownership, grants, policies, and forced RLS.
- Extend API authorization across member administration, organization settings/ownership, tags/batteries, uploads/imports, and complete organization export.
- Prove worker termination, cancellation, queue-age observability, and idempotent domain mutation before accepting pg-boss under D-011.
- Repeat expiry, revocation, object access, and deletion against real object-storage artifacts; prove permanent database/object/log/backup deletion paths.
- Keep D-002 and D-011 proposed; broader fixtures and production D-012 gates remain separate.

## Next session entry point

Resume from source commit `2c089b0` plus this vault-only closeout. Continue P0-05 with the smallest privileged migration/maintenance proof: ordinary processes must remain unable to assume elevated authority while reviewed migration tooling preserves table ownership, grants, RLS policies, and `FORCE ROW LEVEL SECURITY`.
