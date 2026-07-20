# Security boundaries

Status: accepted Phase 0 baseline
Last updated: 2026-07-20

The abuse-case analysis and release gates are in
[`../security/THREAT-MODEL.md`](../security/THREAT-MODEL.md) and
[`../security/PHASE-1A-SECURITY-CHECKLIST.md`](../security/PHASE-1A-SECURITY-CHECKLIST.md).

## Trust boundaries

| Boundary                             | Trusted input crossing it                                                                                     | Forbidden input or capability                                                              | Enforcement                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Browser → web/API                    | validated request plus a verified hosted session, or one server-resolved generated persona in local/test only | client-selected user/organization/role, object key, queue payload, database tenant context | D-015 environment/persona interlock or Better Auth session lookup, schemas, rate limits, app-derived identifiers |
| Identity → authorization             | generated local `userId`, or hosted `sessionId` and `userId` only                                             | arbitrary browser user; provider active organization or role                               | D-015/D-013 identity adapters; canonical membership and RLS                                                      |
| API/worker → PostgreSQL              | transaction-local organization, bounded parameters                                                            | contextless customer query, owner/superuser/BYPASSRLS connection                           | non-owner roles, forced RLS, composite organization keys, organization-required repositories                     |
| API/worker → S3                      | derived key, exact version, checksum, bounded expiry                                                          | public ACL, client key, bucket listing, unsigned customer read                             | prefix-scoped IAM, Block Public Access, adapter, signed exact-version GET                                        |
| Queue → worker                       | version, organization ID, domain ID                                                                           | telemetry, coordinates, source bytes, keychains, credentials                               | strict payload schema and RLS reload                                                                             |
| Worker → parser                      | one read-only source and bounded private keychain IPC                                                         | network, database, S3/IAM credentials, durable queue access                                | fresh rootless no-network container and resource limits                                                          |
| Key broker → DJI                     | separately authorized bounded provider request                                                                | parser network, broad credentials, redirects, logged request/response bodies               | disabled-by-default allowlist adapter and D-012 gates                                                            |
| Application → telemetry/log provider | outcome, timing, opaque correlation IDs, aggregate counts                                                     | coordinates, telemetry, serials, names, object keys, auth/session tokens                   | structured allowlist and redaction tests                                                                         |
| Operator → production                | federated, time-bound approved session                                                                        | shared keys, standing admin, direct customer export                                        | separate account, least privilege, SSM, CloudTrail, audited break-glass procedure                                |

## Parser execution boundary

The worker may invoke only a content-addressed A08 parser image with an exact
source path, byte count, and SHA-256. It rehashes the regular non-symlink source,
caps it at 32 MiB, sends at most 256 KiB of private input over standard input,
and retains at most 32 MiB of combined process output. The effective container
configuration is inspected before execution; any network, privilege, writable
root/source, unexpected mount, secret-like environment name, or weakened
resource setting fails closed.

Successful output must pass the exact private intermediate schema and source
identity check before a one-use consumer can see it. The wrapper clears private
input, captured stdout, and consumed object fields and removes the container on
success or failure. Runtime control operations have their own hard deadlines,
and failed forced removal becomes a sanitized cleanup failure. Public/job/log-safe
failures contain only an allowlisted code and bounded process/resource metadata;
stderr contents, source hashes, telemetry, coordinates, names, identifiers, and
key material are excluded.

## Development identity boundary

The generated persona adapter exists only to assemble and test the functional
application before Better Auth integration. It requires validated `local` or
`test` mode, a separate explicit enable flag, and a server-owned generated
scenario manifest. A development control may select only a named allowlisted
persona; it never supplies a user ID, organization ID, membership, or role.

Every request still reloads current app-owned membership and enters PostgreSQL
through the ordinary forced-RLS transaction. Hosted configuration must reject
the adapter at startup and hosted route inventories must not contain its control.
A13a evidence is neither authentication nor release evidence. A13b proves this
adapter is absent from hosted artifacts and repeats the complete functional and
Alpha/Beta paths through the verified-session adapter.

## Verified identity boundary

Better Auth 1.6.23 owns credentials, email verification, recovery tokens, and
revocable sessions in the separate `droneworks_auth` schema. Its login is
non-superuser/non-owner/non-BYPASSRLS and has no customer-table privileges. The
API accepts only an online verified `userId`/`sessionId` result; provider
organization and role claims are discarded before app-owned membership and
forced RLS run.

Hosted cookies are Secure, HttpOnly, SameSite=Lax. CSRF/origin and redirect
allowlists remain enabled, implicit account linking is disabled, verification
and recovery links expire, recovery revokes sessions, and sensitive routes are
rate limited. Invitation tokens are random and persisted only as SHA-256; auth
and domain audits store action/resource identifiers and changed-field names,
never email, password, cookie, recovery/invitation token, or request payload.

## Data classes and cryptography

- Raw logs, telemetry, coordinates, serial numbers, pilot identity, exports, and
  cached keychains are confidential customer data. They are encrypted in transit
  and at rest; authorization is always organization-scoped.
- Authentication secrets, invitation/recovery tokens, cookies, AWS credentials,
  and the DJI API credential are secrets. They never enter customer schemas,
  jobs, logs, URLs, fixtures, or support exports.
- S3, RDS, EBS, and Secrets Manager use environment-specific KMS keys. IAM roles,
  not static access keys, grant workloads access. Key policies deny the parser.
- Cached DJI keychains use authenticated envelope encryption bound to
  organization, raw source, parser, and format version. The cache is disabled
  until D-012 production gates pass.

## Object access and deletion

Application code derives every key below `organizations/<encoded-org>/` after
database authorization. Uploads use conditional create plus SHA-256 confirmation;
immutable-key reuse with different bytes is an error. Downloads name an exact
version, expire within 15 minutes, use `private, no-store`, and are minted only
after current membership/role checks.

Permanent deletion lists every object version and delete marker under the exact
resource or organization prefix, deletes by version ID, relists until empty,
and stores only a digest/count/time receipt. A simple S3 delete is insufficient
for a versioned bucket. The Docker-free proof in
[`spikes/object-storage`](../../spikes/object-storage/) exercises conditional
upload, exact signed retrieval, expiry/tamper denial, cross-organization prefix
preservation, version purge, absence verification, and idempotent retry.

The loopback service proves the application contract, not live AWS IAM or S3
conformance. Before any customer upload, Phase 1A must run the same suite against
a temporary private AWS bucket, inspect CloudTrail, then destroy the bucket and
credentials. Until that gate passes, hosted storage is not authorized for
customer data.

## Logs, metrics, and traces

Allowed fields are timestamp, service/version, environment, severity, request or
job correlation ID, route template, status/outcome code, latency, retry count,
queue age, byte/count buckets, and a keyed organization pseudonym where needed
for abuse detection. Free-form exception serialization is forbidden at external
boundaries.

Coordinates, telemetry values, filenames, object keys, SQL parameters, emails,
names, serials, request/response bodies, cookies, authorization headers,
keychains, feature points, and provider payloads are forbidden. Production
application logs retain 30 days; security/control-plane logs retain 90 days and
contain no customer payload by design.

## Privileged and emergency access

No routine support workflow permits direct customer-data browsing. Production
access requires federation with MFA, an approved time window, a ticket/reason,
and CloudTrail. Database migration, deletion worker, outbox dispatcher,
application, queue, and read-only operational roles remain distinct.

Break-glass credentials are recovery-only, alert on use, cannot be shared, and
are rotated after every exercise. Emergency database access occurs on a restored
or isolated instance when possible. Any customer-data access becomes an
incident record and follows the applicable notice process.

## Security gates before hosted customer data

- real Better Auth cookie, invitation, recovery, linking, revocation, and
  deletion tests pass;
- temporary AWS S3 conformance and permanent-version-deletion tests pass;
- IaC policy tests prove no public bucket/database and no parser credentials;
- backup restore plus deletion-receipt replay passes on generated data;
- dependency/SBOM, container signing, vulnerability, and parser containment
  checks pass for the promoted digest;
- alarms, log-redaction tests, budgets, and break-glass alerting are active; and
- D-012 terms, consent, managed-secret, egress, cache, and deletion gates pass
  before the DJI provider is enabled.
