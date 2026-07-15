---
type: session
date: 2026-07-15-1857
branch: main
trigger: wrapup
status: complete
tags: [session, architecture/tenancy, security/isolation, product/api]
related:
  - "[[00-north-star]]"
  - "[[architecture]]"
  - "[[roadmap]]"
  - "[[2026-07-15-1845-real-queue-retry-isolation]]"
---

# Prove versioned API role isolation

## What changed

- Added a real loopback `/api/v1/` flight-read and download-issuance boundary with replaceable authenticated identity resolution and RFC 9457 denials.
- Added organization-owned raw-source/export flight-scope links and stored pilot download restrictions under forced RLS.
- Proved every role can view organization flights while owner/admin, viewer denial, pilot-own-flight, other-pilot, mixed-pilot, and disabled-policy download behavior follows the Phase 1 contract.
- Proved cross-organization and unknown exact IDs return the same not-found problem without signer access; route-supplied identity cannot override the authenticated session.
- Updated D-002 and tenancy evidence without accepting a framework, authentication provider, or the isolation decision; committed the source slice as `e2eb152`.

## Why

Database and signer isolation were not sufficient evidence for the API-first product contract. This slice shows membership and role authorization survive the actual HTTP boundary while remaining independent of the unresolved Fastify and session-provider choices.

## Verification

- Ran the native ephemeral PostgreSQL and loopback API suite: 16 passed, zero skipped, zero failed across eleven forced-RLS customer tables.
- Ran the complete existing host suite outside the outer sandbox: 78 passed, zero skipped, zero failed, including loopback provider behavior and real macOS parser network denial.
- Checked JavaScript syntax for the API, repositories, and integration tests plus Git whitespace and the focused schema/documentation diff.
- No Docker, persistent PostgreSQL service, real object provider, raw fixture, or customer data was used.

## Open threads

- Extend the API matrix across manual creation, pilot-own note editing, reassignment, deletion/restoration, member administration, organization settings, and complete export.
- Prove worker termination, cancellation, queue-age observability, and idempotent domain mutation before accepting pg-boss under D-011.
- Repeat download expiry, membership revocation, object access, and deletion against real object-storage artifacts.
- Define observable privileged migration/maintenance access and prove migration-tool preservation of ownership, grants, policies, and forced RLS.
- Keep D-002 and D-011 proposed; broader fixtures and production D-012 gates remain separate.

## Next session entry point

Resume from source commit `e2eb152` plus this vault-only closeout. Continue P0-05 with the smallest flight-mutation API role slice: manual creation for owner/admin/pilot, pilot-own note editing, owner/admin reassignment and delete/restore, viewer denial, and uniform cross-organization IDOR behavior.
