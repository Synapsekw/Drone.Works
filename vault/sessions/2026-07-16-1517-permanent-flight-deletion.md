---
type: session
date: 2026-07-16-1517
branch: main
trigger: wrapup
status: complete
tags: [session, architecture/tenancy, security/isolation, product/deletion]
related:
  - "[[00-north-star]]"
  - "[[architecture]]"
  - "[[roadmap]]"
  - "[[2026-07-16-1505-permanent-organization-deletion]]"
---

# Prove permanent flight deletion

## What changed

- Added a checksum-pinned privilege-tightening migration that removes ordinary-app deletion from canonical flights and raw sources.
- Added a dedicated-worker function bound to organization, flight, soft-deletion timestamp, and the 30-day restoration boundary.
- Removed canonical payload, revisions, telemetry, associations, and overrides; deleted only the raw source exclusive to that flight while preserving a shared source and peer flight.
- Retained only a UTC payload-redacted action reference and proved early, cross-organization, and stale jobs do not delete.
- Proved a post-commit pg-boss retry returns the original evidence without repeating deletion; committed the source slice as `3addfc4`.

## Why

Permanent organization deletion was proven, but an expired single flight still lacked executable source-reference handling. This closes the local relational lifecycle gap without claiming provider object deletion.

## Verification

- Ran the native ephemeral PostgreSQL, pg-boss, and loopback API suite: 31 passed, zero skipped, zero failed across twenty-three forced-RLS customer tables.
- Ran the complete existing host parser suite: 78 passed, zero skipped, zero failed.
- Checked JavaScript syntax, all seven pinned migration digests, grant tightening, payload/telemetry removal, exclusive/shared source behavior, audit redaction, retry, pooled clearing, cross-organization denial, Git whitespace, and privacy patterns.
- No Docker, persistent PostgreSQL service, real object provider, raw fixture, private coordinate, credential, or customer data was used. The unrelated `.obsidian/app.json` change remained unstaged and untouched.

## Open threads

- Run P0-06's reproducible 100,000-flight telemetry ingest/replay/export/deletion/cost benchmark and close D-008.
- Repeat raw/export deletion and authorization against real object-storage artifacts.
- Prove cached organization-secret, external-log, and backup deletion plus verification; select the production retention value.
- Close atomic dispatch, worker termination, cancellation, and queue-age evidence before accepting pg-boss under D-011.

## Next session entry point

Resume from source commit `3addfc4` plus this vault-only closeout. Start P0-06 by defining the synthetic 100,000-flight dataset, candidate layouts, extrema/gap-preserving replay algorithm, benchmark commands, deletion checks, measurement boundaries, and cost variables without using private telemetry.
