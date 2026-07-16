---
type: session
date: 2026-07-16-1555
branch: main
trigger: wrapup
status: complete
tags: [session, architecture/jobs, security/isolation, operations/recovery]
related:
  - "[[00-north-star]]"
  - "[[architecture]]"
  - "[[roadmap]]"
  - "[[2026-07-16-1540-telemetry-benchmark]]"
---

# Prove atomic outbox dispatch

## What changed

- Added a payload-free organization-scoped outbox owned by the queue infrastructure and created in the same transaction as an export request.
- Gave the app only enqueue/cancel functions and a separate dispatcher only lease/complete/release/metrics functions; neither can read the outbox or customer tables directly.
- Derived a stable queue UUID so a dispatcher crash after send reclaims safely without creating a second pg-boss job.
- Proved abandoned-worker lease recovery, queued cancellation, stale-claim denial, and payload-redacted queue-age metrics; committed the slice as `d7664ce`.

## Why

Direct transactional pg-boss insertion would have required request connections to gain queue-table privileges. The outbox preserves least privilege while closing the job-loss window between a domain commit and queue insertion.

## Verification

- Ran 33 native PostgreSQL/pg-boss integration tests with zero skips or failures.
- Proved commit/rollback atomicity, one queue job after post-send recovery, old-token denial, abandoned active-job retry, cancelled-job non-fetchability, pending/claimed/age metrics, strict payload reconstruction, RLS execution, and pooled clearing.
- Checked JavaScript syntax, SQL role/grant boundaries, Git whitespace, and privacy patterns.
- No Docker, persistent service, production credential, customer data, raw fixture, or provider network was used. The unrelated `.obsidian/app.json` change remained unstaged and untouched.

## Open threads

- Finish P0-07 authentication selection and integration boundary.
- Select and exercise the production-shaped S3-compatible adapter/provider, then close active-object deletion and signed-link evidence without claiming backup/cache/log deletion prematurely.
- Write environments, system, security-boundary, restore/rollback, observability, and cost documents before accepting D-011.

## Next session entry point

Resume from `d7664ce` plus this vault-only closeout. Continue P0-07 with the Better Auth versus managed-auth comparison, then the smallest S3-compatible provider-shaped lifecycle proof and deploy/recovery package.
