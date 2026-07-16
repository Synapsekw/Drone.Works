# Phase 1A security acceptance checklist

Status: required for the walking skeleton
Last updated: 2026-07-16

Evidence must link to a CI run, reviewed configuration, drill record, or test.
An unchecked blocking item keeps the stated boundary disabled.

## Every change

- [ ] Core domain behavior is under `/api/v1/`; no private web/server-action write path exists.
- [ ] New customer records carry one organization and forced-RLS/composite-ownership tests.
- [ ] API, job, export, download, deletion, and audit paths use current membership/role checks.
- [ ] Imported, derived, overridden, and effective values remain explicit.
- [ ] Request/response/job schemas reject unknown fields and bound sizes/counts.
- [ ] Logs/traces/errors contain only allowlisted fields and pass sensitive-value canaries.
- [ ] Dependencies are exact/locked; licenses, advisories, SBOM, and generated changes are reviewed.
- [ ] Tests use generated or explicitly authorized fixtures and never commit customer data/secrets.

## Before staging promotion

- [ ] Alpha/Beta negative suite passes with the ordinary non-owner pooled database role.
- [ ] Migration checksums, independent ledger, grants, owners, RLS, and isolation digest pass.
- [ ] Outbox atomicity, stable dispatch, retry, cancellation, stale lease, and queue metrics pass.
- [ ] Parser image signature/SBOM passes; no-network and every resource/output limit are asserted.
- [ ] Poison input fails independently and a following valid parse succeeds.
- [ ] Conditional object upload, checksum, exact version, expiry/tamper, purge, and peer preservation pass.
- [ ] Authentication revocation and provider org/role-claim rejection pass.
- [ ] CSP, attachment/nosniff, CSRF/origin, redirect, body/batch, and rate-limit tests pass.
- [ ] Health, graceful shutdown, alarms, backup age, deletion backlog, and budget alerts are active.

## Before any hosted customer data

- [ ] Production/non-production AWS accounts, VPCs, KMS keys, buckets, databases, secrets, and roles are distinct.
- [ ] IaC proves S3 Block Public Access/TLS/versioning, private RDS, no inbound SSH, and least-privilege IAM.
- [ ] The object suite passes against a temporary private AWS bucket, CloudTrail is reviewed, and test resources are destroyed.
- [ ] Generated-data RDS point-in-time restore completes within four hours in isolation.
- [ ] Restore replays synthetic deletion receipts before exposure and verifies no deleted rows or S3 versions return.
- [ ] Better Auth registration, verification, login, linking, recovery, invite, revocation, last-owner, and deletion tests pass.
- [ ] Hosted cookies are Secure/HttpOnly/SameSite, CSRF/origin controls pass, and auth/email rate limits alert.
- [ ] Workload roles use no static cloud key; parser receives no environment secret, network, DB, or host IAM access.
- [ ] Application/control log retention is 30/90 days and sample review finds no forbidden payload.
- [ ] Federated MFA operator, SSM, CloudTrail, approval, and break-glass alert/rotation drill pass.
- [ ] Budgets and anomaly detection use the approved beta thresholds.
- [ ] Backup/deletion maximum windows and subprocessors are accurately disclosed for qualified review.

## Before enabling DJI key retrieval

- [ ] Qualified review approves current terms, authority, notice/consent, and customer-facing failure language.
- [ ] Managed DJI credential has a dedicated broker role, exact endpoint allowlist, rotation, and access alarm.
- [ ] Redirect, DNS/SSRF, timeout, response-size, retry, and sanitized-error tests pass against the production adapter.
- [ ] Authenticated cache ciphertext is bound to organization/source/parser/version and deletion is exercised through backup expiry.
- [ ] The parser still has no network or provider credential and receives keychain plaintext only through bounded ephemeral IPC.
- [ ] Representative authorized fixtures pass the supported-version matrix; unsupported versions fail clearly.

## Before private-beta release

- [ ] One promoted image digest passes staging smoke from organization creation through upload, parse, replay, export, and deletion.
- [ ] Production rollback to the prior compatible digest and failed-migration rollback/forward-repair rehearsal pass.
- [ ] Incident contacts, severity rules, credential compromise, cross-tenant, deletion, and parser escape runbooks are exercised.
- [ ] Critical/high threat controls in `THREAT-MODEL.md` have named owners and linked evidence.
- [ ] External blockers and disabled features match the product/decision documents; no UI implies unsupported capability.

