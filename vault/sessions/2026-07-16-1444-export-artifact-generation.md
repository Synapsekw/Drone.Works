---
type: session
date: 2026-07-16-1444
branch: main
trigger: wrapup
status: complete
tags: [session, architecture/tenancy, security/isolation, product/export]
related:
  - "[[00-north-star]]"
  - "[[architecture]]"
  - "[[roadmap]]"
  - "[[2026-07-16-1423-maintenance-isolation]]"
---

# Prove export artifact generation

## What changed

- Extended complete-export requests to freeze a sanitized ordered snapshot for all nineteen documented operational collections inside the organization-scoped RLS transaction.
- Added a deterministic logical archive envelope containing a public manifest, complete JSON data, flight CSV, and telemetry CSV with canonical ordering and SHA-256 file/bundle digests.
- Derived stable artifact identity and organization-prefixed object keys, then finalized the request and redacted completion audit through an idempotent worker transition.
- Proved a failed artifact adapter call rolls back, the same pg-boss job succeeds on retry with one stored object, and later execution performs no additional storage write.
- Proved manager download authorization plus uniform pilot and cross-organization denial; committed the source slice as `b3c9d32`.

## Why

The prior slice proved only that an export request and manifest stayed inside its organization. This closes the smallest content and worker-effect gap without selecting an archive standard or granting access to a real storage provider.

## Verification

- Ran the native ephemeral PostgreSQL, pg-boss, and loopback API suite: 29 passed, zero skipped, zero failed across twenty-three forced-RLS customer tables.
- Ran the complete existing host parser suite: 78 passed, zero skipped, zero failed.
- Checked JavaScript syntax, all five pinned migration digests, deterministic rebuild/file hashes, Git whitespace, pooled-context clearing, queue retry, cross-organization behavior, download roles, and privacy patterns.
- No Docker, persistent PostgreSQL service, real object provider, raw fixture, private coordinate, credential, or customer data was used.

## Open threads

- Prove permanent organization deletion across customer rows with explicit worker organization context, an independently retained deletion receipt, retry idempotency, pooled reuse, and cross-organization denial.
- Repeat export expiry, revocation, object access, and deletion against real object-storage artifacts; select a production archive container separately.
- Prove atomic dispatch, worker termination, cancellation, and queue-age observability before accepting pg-boss under D-011.
- Prove permanent object, log, and backup deletion after the database boundary; keep D-002 and D-011 proposed.
- Production operations and D-012 gates remain separate.

## Next session entry point

Resume from source commit `b3c9d32` plus this vault-only closeout. Continue P0-05 with the smallest permanent organization-deletion database proof: enforce owner grace expiry, execute with explicit organization context, cascade customer rows, retain only a non-customer deletion receipt, and prove retry, pooled reuse, and cross-organization isolation without a real object provider.
