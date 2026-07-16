---
type: session
date: 2026-07-16-2128
branch: main
trigger: wrapup
status: complete
tags: [session, roadmap/phase-1a, database, organization-isolation]
related:
  - "[[00-north-star]]"
  - "[[roadmap]]"
  - "[[architecture]]"
  - "[[2026-07-16-2005-phase-1a-foundation]]"
---

# Complete A04 organization isolation

## What changed

- Promoted the generic PostgreSQL proof into one checksum-pinned production
  migration covering fourteen organization-owned tables with forced RLS.
- Added separate migration, application, queue, dispatcher, schema-owner, and
  ledger-owner roles with a deterministic isolation-contract digest.
- Added a validated transaction-local organization wrapper that fails before
  acquiring a pooled connection when context is missing or invalid.
- Added generated Alpha/Beta tests for every table, cross-organization reads and
  writes, joins, aggregates, composite ownership, pool reuse, grants, migration
  replay, checksum failure, and RLS tampering.
- Updated native local startup and CI to apply and test the same migration, then
  committed A04 and its canonical documentation as `42b160a`.

## Why

Organization separation is now enforced by PostgreSQL itself as well as by the
application access boundary. A05 can add identity and sessions without trusting
provider organization claims or needing Docker, RDS, or AWS credentials.

## Verification

- `corepack pnpm verify`, `corepack pnpm test:contract`,
  `corepack pnpm build`, and `corepack pnpm peers check` passed; all four API
  contract tests passed.
- `corepack pnpm test:database` passed all six tests against a disposable native
  PostgreSQL 18 cluster. The sandboxed attempt could not allocate shared memory;
  the approved local rerun passed and removed its temporary cluster.
- One integrated `dev:up` → `smoke:local` → `dev:down` cycle passed with the
  migrated schema, two generated organizations, services, and cleanup.
- Frozen offline install, formatting, Git whitespace, package-boundary, source
  privacy, migration checksum, and OpenAPI/generated-client drift checks passed.
- No Docker, AWS resource or credential, persistent database, customer data, or
  private fixture content was used.

## Open threads

- A05 must pin Better Auth and integrate verified identity/session flows while
  keeping organization membership and authorization app-owned.
- A09 production DJI gates remain external and disabled. A14–A15 still require
  explicit AWS account/spend authority and live hosted-data evidence.
- The unrelated `.obsidian/app.json` change remains unstaged and untouched.

## Next session entry point

Resume at A05 in the Phase 1A backlog. Add the smallest reviewed auth schema and
verified local session flow on top of A04, then prove that live identity claims
cannot bypass current app-owned membership or organization selection.
