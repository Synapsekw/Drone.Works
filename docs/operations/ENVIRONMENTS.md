# Environments and deployment

Status: accepted Phase 0 baseline
Last updated: 2026-07-16

## Environment matrix

| Environment | Data | Dependencies | Credentials | Lifetime |
|---|---|---|---|---|
| Local | generated data and authorized ignored fixtures only | native Node/pnpm, native PostgreSQL, loopback/filesystem S3 adapter, local email capture | local random values; no production credential | developer controlled |
| CI | generated repository-safe fixtures | native PostgreSQL service, loopback object/email services, OCI builder for Linux parser proof | short-lived CI identity; no customer account | per workflow |
| Staging | generated synthetic organizations only by default | complete AWS shape in the non-production account | environment-scoped IAM roles and secrets | ephemeral or scheduled off |
| Production | authorized customer data | production account, EC2, RDS, S3, ECR, KMS, Secrets Manager, CloudWatch | workload roles and federated operators | continuous |

Local development does not require Docker, a cloud account, production
credentials, real email delivery, real map tiles, or real customer data. OCI
images and the Linux parser containment proof are built in CI; developers may
use a local compatible container runtime only by choice.

## Configuration and secrets

Non-secret configuration is validated at process startup from environment
variables and committed schemas. Secret values come from local ignored files in
development and Secrets Manager through workload IAM in hosted environments.
Processes receive only the secrets they need. The parser receives none.

Production and non-production have distinct AWS accounts, KMS keys, buckets,
databases, signing domains, OAuth clients, email identities, and alert channels.
There is no shared database, bucket, or wildcard secret. Preview deployments are
UI-only or use ephemeral generated data; they never connect to production.

## Build and promotion

1. CI pins Node, pnpm, Rust, PostgreSQL client, and dependency lockfiles.
2. It runs contract, RLS, pooled isolation, jobs, parser containment, telemetry,
   object lifecycle, redaction, and migration-integrity tests.
3. It produces SBOMs and signed OCI images for web, API, worker, and parser.
4. One set of image digests is deployed to staging with environment-only
   configuration. Smoke tests cover health, authentication, migration state,
   upload, job, parse, replay, deletion, and telemetry emission.
5. A human promotes those exact digests to production. Production does not build
   source or apply migrations on process startup.

## Migrations and rollback

Migrations are checksum-pinned reviewed SQL executed by the non-inheriting
migration role under an advisory lock. Use expand/migrate/contract changes:

- deploy backward-compatible schema expansion;
- deploy code that can read old and new state;
- backfill idempotently with observable checkpoints;
- promote readers/writers to the new state;
- remove old state only in a later deployment after rollback expiry.

The runner records the migration digest and isolation-contract result in the
separately owned operational ledger. A failed transaction rolls back. If a
forward-only data migration has committed, application rollback means deploying
the last compatible image, not reversing customer data blindly.

## Health, shutdown, and observability

- Liveness proves the process event loop; readiness verifies configuration and
  bounded dependency checks without exposing details.
- Deployments stop readiness, stop claiming work, allow bounded request/job
  completion, release leases, and then terminate.
- Required metrics include request error/latency, pool saturation, queue
  pending/age/retry/dead-letter, parser duration/outcome/resource kills, object
  errors, migration state, backup age, and deletion backlog/deadline.
- Alerts page on cross-tenant/redaction/security signals, failed backups,
  deletion deadline risk, unavailable API, stuck queue, and repeated parser
  containment failures. Cost alerts follow `COST-MODEL.md`.

## Infrastructure ownership

Infrastructure is reproducible IaC reviewed like application code. The exact IaC
tool is chosen in the bootstrap task; OpenTofu/Terraform is preferred because it
keeps the deployment portable. State is encrypted, versioned, locked, and held
outside the application account. Console-only resources are defects except
temporary incident containment recorded afterward.

