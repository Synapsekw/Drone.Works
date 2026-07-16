---
type: session
date: 2026-07-16-2251
branch: main
trigger: wrapup
status: complete
tags: [session, roadmap/phase-1a, upload, object-storage]
related:
  - "[[00-north-star]]"
  - "[[roadmap]]"
  - "[[architecture]]"
  - "[[2026-07-16-2224-a05-local-authorization]]"
---

# Complete A06 immutable upload

## What changed

- Added versioned declaration, authenticated content, exact-version completion,
  and status operations without exposing client-controlled object keys or URLs.
- Added server-derived organization/upload object keys, conditional immutable
  loopback writes, digest/size/type verification, filename sanitization, and
  exact unreferenced-version cleanup after database rollback.
- Added app-owned owner/admin/pilot authorization, viewer and removed-member
  denial, transaction-scoped idempotency, import/raw-source linking, and
  payload-redacted audit metadata on top of the existing forced-RLS pool.
- Added generated OpenAPI/client contracts, CI coverage, six native upload tests,
  an integrated local upload smoke path, and canonical A06 evidence; committed
  the implementation as `8972c8a`.

## Why

A07 needs a durable, organization-owned source boundary before it can dispatch
processing. This slice proves immutable retention and authorization locally
without coupling the domain to AWS or starting queue/parser work early.

## Verification

- `corepack pnpm verify`, `corepack pnpm build`, contract drift, formatting,
  lint, strict types, boundaries, source privacy, and Git whitespace checks
  passed; all four API contract tests passed.
- `corepack pnpm test:database`, `corepack pnpm test:authorization`, and
  `corepack pnpm test:upload` each passed six tests against disposable native
  PostgreSQL; A06 also used the loopback object service.
- One `dev:up` → `smoke:local` → `dev:down` cycle passed generated identity,
  Alpha organization selection, immutable upload completion, web/services, and
  removed all generated runtime state.
- No Docker, Better Auth, job/queue, parser, AWS resource or credential,
  customer data, or private fixture was used.

## Open threads

- A07 is next: add payload-free transactional outbox dispatch, stable job
  identity, retry/cancellation behavior, and observable import status without
  starting parser execution.
- A09 provider enablement remains external and disabled; A13b verified Better
  Auth remains mandatory before A14 can deploy any hosted environment.
- The unrelated `.obsidian/app.json` change remains unstaged and untouched.

## Next session entry point

Resume at A07 in the Phase 1A backlog. Preserve A06 exact-version ownership,
A05 current-membership authorization, and A04 forced RLS while adding the
smallest atomic dispatch/status slice; stop before A08 parsing.
