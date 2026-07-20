---
type: session
date: 2026-07-20-0943
branch: main
trigger: wrapup
status: complete
tags: [session, roadmap/phase-1a, auth, tenancy, web]
related:
  - "[[00-north-star]]"
  - "[[roadmap]]"
  - "[[architecture]]"
  - "[[2026-07-19-0827-a13a-functional-local-gate]]"
---

# Complete the A13b verified-auth gate

## What changed

- Integrated exact `better-auth@1.6.23` behind the provider-neutral identity
  seam with reviewed, checksum-pinned auth schema migration 004, verified email
  sessions, recovery, session revocation, and account deletion safeguards.
- Added app-owned, forced-RLS invitation operations to the generated
  `/api/v1/` contract while keeping provider claims unable to grant membership
  or role authority.
- Added verified registration, sign-in, recovery, invitation, revocation, and
  deletion UI. Hosted builds exclude the generated-persona endpoint and control;
  local development retains an explicit mutually exclusive identity mode.
- Replayed the full destructive browser path under verified HttpOnly-cookie
  sessions and preserved the original generated-persona replay. Updated the
  canonical product, architecture, operations, security, research, backlog, and
  testing evidence documents; pushed implementation commit `4a86db4`.

## Why

A13b replaces disposable identity at the hosted boundary without moving domain
authorization into the provider. Current app-owned membership plus forced RLS
remain authoritative, while the local persona stays available only for explicit
disposable development.

## Verification

- `pnpm test:auth` passed 7 lifecycle, request-control, drift, redaction, and
  authorization scenarios. Native gates passed: database 7, authorization 6,
  upload 8, jobs 8, normalization 6, and flight API 6.
- `pnpm test:web` passed 7 browser/security tests. The verified-session
  functional report passed worker recovery, duplicate reuse, corrupt isolation,
  Alpha/Beta denial, API and coordinate-network boundaries, and redaction; the
  unchanged generated-persona replay also passed.
- `CI=true pnpm verify`, `pnpm build`, contract snapshot, package boundaries,
  privacy scan, migration integrity, and the production dependency audit passed.
- Hosted verify run
  [29719523125](https://github.com/Synapsekw/Drone.Works/actions/runs/29719523125)
  and parser-evidence run
  [29719523112](https://github.com/Synapsekw/Drone.Works/actions/runs/29719523112)
  passed on `4a86db4`.

## Open threads

- A14 is next but requires explicit AWS account, approved-region, and spend
  authority before any paid resource or hosted credential is created.
- Hosted trusted-proxy/IP policy, real email delivery, cloud secrets, and alert
  evidence remain fail-closed A14/A15 work; no AWS resource was provisioned.
- The unrelated `.obsidian/app.json` change and two untracked `index 2.ts`
  copies remain unstaged and untouched.

## Next session entry point

Resume at A14 only after external AWS authority is confirmed. Start with the
pre-provision region/service-health gate and reviewed synthetic-only IaC; keep
customer uploads, real DJI keys, hosted credentials, and production data off.
