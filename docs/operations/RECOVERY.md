# Recovery, backup, and rollback

Status: accepted Phase 0 policy
Last updated: 2026-07-20

## Objectives

- Private-beta recovery-time objective: restore service within four hours.
- Private-beta recovery-point objective: lose no more than 24 hours; the selected
  RDS point-in-time capability should normally be materially better.
- These are internal engineering objectives, not customer SLAs.

## Retention and ownership

| Asset                                              | Mechanism                                        |                    Maximum retention | Owner                       | Restore/deletion rule                                                                          |
| -------------------------------------------------- | ------------------------------------------------ | -----------------------------------: | --------------------------- | ---------------------------------------------------------------------------------------------- |
| PostgreSQL customer, jobs, and Better Auth schemas | RDS automated backups and point-in-time logs     |   35 days production; 7 days staging | engineering on-call         | restore privately, validate migration/auth schema state, replay deletion receipts, then expose |
| S3 customer objects                                | active versioned bucket, not a backup archive    |          while legitimately retained | application deletion worker | permanently delete every exact version and verify empty listing                                |
| OCI images                                         | signed ECR digests                               | 90 days minimum for released digests | release owner               | redeploy last compatible digest                                                                |
| IaC and migrations                                 | Git plus encrypted remote state history          |              repository/state policy | engineering                 | recreate environment and apply reviewed state                                                  |
| Application logs                                   | CloudWatch                                       |                              30 days | operations                  | no customer payload; not restored into application                                             |
| Security/control logs                              | CloudTrail/CloudWatch                            |                              90 days | security owner              | payload-free audit and incident evidence                                                       |
| Deletion receipts                                  | separately controlled payload-free ledger/export |        45 days after backup deadline | deletion owner              | mandatory replay gate for every database restore                                               |

Amazon RDS permits automated-backup retention from 0 to 35 days. Production
selects the documented maximum so the worst remaining backup window is explicit,
not accidental. See the official [RDS retention documentation](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.BackupRetention.html).

## Deletion and backup reconciliation

Active-system permanent deletion completes after the 30-day product grace
period. It removes PostgreSQL payload, every S3 version, generated exports,
telemetry, and organization-linked cached secrets, then verifies absence before
marking success. The receipt states the latest backup-expiry time, at most 35
days later.

Backups are not edited in place. An independently retained receipt contains a
keyed digest of the organization identifier, deletion time, backup deadline,
object version count, and outcome—no customer payload. Before a restored
database can accept traffic, an offline reconciliation computes digests for its
organizations, re-applies every still-retained deletion, verifies active rows and
S3 versions are absent, and records the drill result. This prevents a restore
from silently resurrecting deleted customers. Expired backup generations and
their receipts are removed by policy.

## Database restore runbook

1. Declare an incident and create an isolated recovery environment with no
   public or customer access.
2. Restore RDS to the chosen point and pin the application images compatible
   with that schema ledger.
3. Verify migration checksums, customer/auth schema ownership and grants,
   Better Auth migration drift, forced RLS, row counts, and the
   isolation-contract digest.
4. Import the independently stored deletion receipts and replay all applicable
   organization/flight deletions before any worker or API starts.
5. Verify S3 exact versions/checksums for live references, identify missing or
   orphaned references, and do not guess or silently discard.
6. Start API and worker in restricted mode; run synthetic verified-session,
   recovery/session-revocation, Alpha/Beta isolation, queue, download, and
   parser smoke tests.
7. Obtain incident-owner approval, rotate affected secrets, switch traffic, and
   monitor error, queue, object, and deletion metrics.
8. Preserve payload-free evidence and destroy the superseded recovery resources.

## Deployment rollback

Rollback uses the previous signed image digest and its compatible configuration.
Database changes follow expand/contract rules so the previous image remains
compatible through the rollback window. Failed uncommitted migrations roll back
transactionally. Committed data transformations are repaired forward from a
reviewed procedure; destructive reverse migrations are not automatic.

## Drill schedule and gates

- Before first hosted customer data: restore generated data, replay a synthetic
  deletion receipt, verify forced RLS, and meet the four-hour objective.
- Monthly during private beta: verify backup age and perform a restore metadata
  check; quarterly: full isolated restore and deletion replay.
- Before database major upgrades or retention changes: full rehearsal.
- A failed restore, stale backup, receipt gap, isolation digest mismatch, or
  missed deletion deadline blocks release and triggers incident handling.
