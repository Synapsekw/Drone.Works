---
type: session
date: 2026-07-16-1505
branch: main
trigger: wrapup
status: complete
tags: [session, architecture/tenancy, security/isolation, product/deletion]
related:
  - "[[00-north-star]]"
  - "[[architecture]]"
  - "[[roadmap]]"
  - "[[2026-07-16-1444-export-artifact-generation]]"
---

# Prove permanent organization deletion

## What changed

- Added a dedicated non-superuser deletion-worker login with no direct customer-table or receipt-table grants.
- Added a checksum-pinned migration that removes ordinary-app organization-root deletion and grants only a narrow permanent-deletion function.
- Enforced the exact pending-request timestamp and 30-day grace boundary, then deleted all twenty-two child table types plus the root in explicit dependency order under transaction-local forced RLS.
- Added a separately owned operational receipt containing only the opaque organization reference, timestamps, configured backup deadline, object counts, and system role.
- Proved early, cancelled, and stale references do not delete; a post-commit pg-boss failure retries to the same receipt without repeating the effect; committed the source slice as `5e876f2`.

## Why

The owner-facing request was already reversible, but final deletion had no executable least-privilege boundary. This slice proves active PostgreSQL removal and retry safety while leaving provider, cache, log, and backup deletion outside the claim.

## Verification

- Ran the native ephemeral PostgreSQL, pg-boss, and loopback API suite: 30 passed, zero skipped, zero failed across twenty-three forced-RLS customer tables.
- Ran the complete existing host parser suite: 78 passed, zero skipped, zero failed.
- Checked JavaScript syntax, all six pinned migration digests, declared grant tightening, every customer-table count before/after deletion, receipt redaction, queue retry, pooled clearing, cross-organization/stale behavior, Git whitespace, and privacy patterns.
- No Docker, persistent PostgreSQL service, real object provider, raw fixture, private coordinate, credential, or customer data was used. The unrelated `.obsidian/app.json` change remained unstaged and untouched.

## Open threads

- Prove permanent flight deletion after its restoration window, including telemetry/payload removal and exclusive-versus-shared raw-source retention.
- Repeat export/raw deletion and authorization behavior against real object-storage artifacts; select a production archive container separately.
- Prove cached organization-secret, external-log, and backup deletion plus verification; select the production maximum backup-retention value.
- Prove atomic dispatch, worker termination, cancellation, and queue-age observability before accepting pg-boss under D-011.
- Keep D-002 and D-011 proposed; production operations and D-012 gates remain separate.

## Next session entry point

Resume from source commit `5e876f2` plus this vault-only closeout. Continue P0-05 with the smallest permanent-flight database deletion proof: enforce expired restoration, remove canonical payload and telemetry, delete only exclusively referenced raw sources, retain a payload-redacted action reference, and prove retry, pooled reuse, and cross-organization isolation without a real object provider.
