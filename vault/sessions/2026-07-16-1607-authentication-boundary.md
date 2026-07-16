---
type: session
date: 2026-07-16-1607
branch: main
trigger: wrapup
status: complete
tags: [session, architecture/authentication, security/isolation, product/decision]
related:
  - "[[00-north-star]]"
  - "[[architecture]]"
  - "[[roadmap]]"
  - "[[2026-07-16-1555-atomic-outbox-dispatch]]"
---

# Select the authentication boundary

## What changed

- Selected self-hosted Better Auth with PostgreSQL for identity and sessions while keeping organizations, invitations, memberships, and roles in the canonical Drone.Works domain.
- Added a provider-neutral identity adapter that emits only session and user IDs and discards provider organization and role claims.
- Proved provider organization mismatch, forged owner role, and immediate session revocation through the versioned API, forced RLS, and one-connection pool.
- Compared Better Auth, Clerk Organizations, and first-party credentials; accepted D-013 and committed the slice as `8bb0880`.

## Why

Authentication must not create a second tenant-authorization source. The narrow adapter keeps database membership and RLS authoritative while preserving a replaceable identity provider boundary.

## Verification

- Ran 34 native PostgreSQL/pg-boss integration tests with zero skips or failures.
- Verified cross-organization hiding, role non-elevation, revoked-session `401`, transaction-local pooled context, migration roles, queue fault behavior, and deletion behavior.
- Checked Git whitespace and removed the temporary untracked dependency-install residue.
- No Docker, persistent database, production identity account, production credential, customer data, or fixture was used. The unrelated `.obsidian/app.json` change remained unstaged and untouched.

## Open threads

- Finish P0-07 object-storage/provider lifecycle proof and select deployment environments, secrets, migrations, observability, recovery, rollback, and cost thresholds.
- Integrate the exact Better Auth package only during Phase 1A bootstrap and pass the documented migration, cookie, invitation, recovery, linking, deletion, and hosted-security gates.
- Close P0-08 threat/privacy flows and P0-09 implementation backlog after the system boundary is accepted.

## Next session entry point

Resume from `8bb0880` plus this vault-only closeout. Build the smallest production-shaped S3-compatible immutable-upload, signed-download, version deletion, and absence-verification proof without Docker, then write and accept the deployment/recovery/cost package.

