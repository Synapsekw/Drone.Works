---
type: session
date: 2026-07-16-1622
branch: main
trigger: wrapup
status: complete
tags: [session, architecture/deployment, operations/recovery, security/storage, product/decision]
related:
  - "[[00-north-star]]"
  - "[[architecture]]"
  - "[[operations]]"
  - "[[roadmap]]"
  - "[[2026-07-16-1607-authentication-boundary]]"
---

# Accept the deployment stack

## What changed

- Added a Docker-free loopback versioned-object proof for immutable conditional upload, exact signed retrieval, expiry/tamper, cross-organization preservation, permanent version purge, absence verification, and retry.
- Selected AWS UAE with separate accounts, one replaceable private-beta OCI host, private RDS/S3, ECR, KMS, Secrets Manager, Systems Manager, and CloudWatch.
- Defined system and security boundaries plus local/CI/staging/production environments, migration/rollback, 35-day backup retention, restore/deletion-replay responsibilities, observability, and monthly cost alerts.
- Accepted D-002, D-011, and D-014; committed the P0-07 package as `1ae513f`.

## Why

Phase 1A now has one coherent and affordable system shape without pretending that live cloud conformance has occurred. Temporary AWS S3 and restore drills remain safe hosted-data gates, so failure keeps customer uploads disabled rather than weakening deletion or isolation.

## Verification

- Ran three object lifecycle tests with zero skips or failures across a real loopback HTTP/signing boundary.
- Retained the current baseline of 34 native PostgreSQL/pg-boss, five telemetry, and 78 parser/containment tests with zero skips/failures.
- Checked JavaScript syntax, Git whitespace, decision/document consistency, and privacy patterns.
- No Docker, cloud credential, paid resource, customer data, raw fixture, or production provider was used. The unrelated `.obsidian/app.json` change remained unstaged and untouched.

## Open threads

- Complete P0-08 threat model, privacy data-flow inventory, and Phase 1A security checklist against the accepted system boundary.
- Complete P0-09 ordered walking-skeleton backlog and final Phase 0 gate reconciliation.
- Keep hosted customer data disabled until live S3 IAM/KMS/deletion conformance and generated-data RDS restore/deletion-replay gates pass; keep DJI access disabled until D-012 external gates pass.

## Next session entry point

Resume from `1ae513f` plus this vault-only closeout. Build `docs/security/THREAT-MODEL.md` around the accepted system/data flows, assign every sensitive class and high-severity control, then produce the objective Phase 1A security checklist.

