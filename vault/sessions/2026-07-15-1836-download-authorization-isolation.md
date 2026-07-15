---
type: session
date: 2026-07-15-1836
branch: main
trigger: wrapup
status: complete
tags: [session, architecture/tenancy, security/isolation, product/downloads]
related:
  - "[[00-north-star]]"
  - "[[architecture]]"
  - "[[roadmap]]"
  - "[[2026-07-15-1826-postgres-rls-isolation]]"
---

# Prove download authorization isolation

## What changed

- Added organization-owned raw-source and export-artifact references under forced PostgreSQL RLS.
- Added a download boundary that rechecks current membership, derives escaped organization-prefixed keys only from authorized rows, and rejects client-supplied keys.
- Bounded issued links to at most 15 minutes and kept membership/artifact rows locked through signer issuance.
- Proved uniform denial without signer access for cross-organization, viewer, deleted, expired, revoked, and unknown resources; a removed admin cannot refresh an expired link.
- Updated P0-05 evidence while retaining D-002 as proposed; committed the source slice as `f09ad43`.

## Why

The relational RLS proof did not yet show that database isolation survives the handoff to object storage. This slice proves that an application can derive object authority only from a currently authorized organization row while keeping the storage signer replaceable.

## Verification

- Ran the native ephemeral PostgreSQL suite: 11 passed, zero skipped, zero failed across nine forced-RLS tables and the injected signer boundary.
- Ran the complete existing host suite outside the outer sandbox: 78 passed, zero skipped, zero failed, including loopback provider behavior and real macOS parser network denial.
- Checked JavaScript syntax, JSON parsing, Git whitespace, privacy patterns, and that no persistent PostgreSQL service was started.
- The signer is deterministic test evidence; no real object-storage provider or customer object was accessed.
- No Docker or local container runtime was used.

## Open threads

- Exercise organization-required payloads, retry, and ID-only rejection through a real background queue.
- Integrate the full Phase 1 API role matrix, including pilot-own-flight raw/export scope.
- Repeat URL expiry, membership revocation, object access, and deletion against real object-storage artifacts.
- Define observable privileged migration/maintenance access and prove migration-tool preservation of ownership, grants, policies, and forced RLS.
- Keep D-002 and D-011 proposed until the remaining P0-05/P0-07 gates close; broader fixtures and production D-012 gates remain separate.

## Next session entry point

Resume from source commit `f09ad43` plus this vault-only closeout. Continue P0-05 with the smallest real-queue proof: require organization ID plus domain ID in every durable payload, reject ID-only jobs before enqueue and execution, and prove Alpha/Beta retry isolation without Docker.
