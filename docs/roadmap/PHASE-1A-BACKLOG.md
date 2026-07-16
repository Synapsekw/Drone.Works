# Phase 1A implementation backlog

Status: implementation-ready
Last updated: 2026-07-16
Outcome: an authorized user enters an organization, uploads one supported DJI
log, observes isolated asynchronous processing, and opens a flight summary with
a 2D track.

## Delivery rules

- Implement tasks in vertical, reviewable slices. Do not copy a spike wholesale;
  promote only the proven contract with production naming, tests, and ownership.
- Add exact dependencies when their task needs them. Do not install the whole
  future stack in the bootstrap task.
- Every customer-data task adds Alpha/Beta negative coverage at the boundary it
  creates. Every job is organization-scoped and idempotent.
- Hosted customer data, real DJI retrieval, email, and maps remain disabled until
  their task-specific security gates pass.
- A task is done only when its acceptance and verification evidence are linked
  from the change. Product-visible contract changes require explicit product
  document review.

## Critical path and safe parallel work

```text
A01 repository
  -> A02 local runtime
  -> A03 API contracts
  -> A04 PostgreSQL/RLS
  -> A05 auth + organization
  -> A06 immutable upload
  -> A07 outbox + jobs
  -> A08 parser supervisor
  -> A09 supported-format/key gate
  -> A10 normalize + persist
  -> A11 flight summary/replay API
  -> A12 web vertical path
  -> A13 end-to-end failure/isolation
  -> A14 staging deployment
  -> A15 hosted data/recovery gates
  -> A16 beta readiness
```

After A01, parser packaging in A08 and IaC scaffolding in A14 may begin without
credentials. After A03, the web shell portion of A12 may proceed against generated
contracts. A05 and A08 may run in parallel after A04/A01 respectively. A09 is the
only external decision on the walking-skeleton critical path: either D-012's
encrypted-key enablement passes, or an authorized unencrypted supported variant
must be obtained. No implementation may silently substitute an unsupported log.

## Milestone 1 — Runnable local foundation

### A01 — Bootstrap the production repository

**Outcome:** A clean checkout has a pinned pnpm/TypeScript workspace with
independently runnable web, API, worker, and shared packages.

**Scope:** Root workspace, pinned Node/pnpm, strict TypeScript, formatter/linter,
test runner, package-boundary rules, environment-schema package, CI cache, and
empty buildable `apps/web`, `apps/api`, `apps/worker`, `packages/contracts`,
`packages/domain`, `packages/database`, `packages/telemetry`, and
`packages/testing`.

**Non-goals:** No database, auth provider, domain endpoint, cloud IaC, parser
dependency, or UI feature.

**Acceptance:** One documented command installs and verifies a clean checkout;
all three processes build and expose only a local health placeholder; workspace
rules prevent the web package importing database code.

**Dependencies:** D-001, D-010, D-011; supported local Node/pnpm versions.

**Verification:** `corepack pnpm install --frozen-lockfile`, `pnpm verify`, and
`pnpm build` pass in CI and a clean local directory without Docker.

**Contract impact:** None; scaffolding only.

**Operational impact:** Establishes dependency ownership, lockfile review, CI
artifacts, and version pinning. No hosted resource.

### A02 — Provide the no-cloud local runtime

**Outcome:** One command starts the local web/API/worker dependencies with
generated data and no production credential.

**Scope:** Native PostgreSQL prerequisite/discovery, isolated local database,
loopback versioned-object service, local email capture, deterministic generated
seed, process orchestration, readiness checks, and cleanup.

**Non-goals:** Docker Compose, cloud emulators, real email, map provider, real
fixture data, or persistent shared development state.

**Acceptance:** Start/stop is repeatable, cleanup removes generated state, ports
are collision-safe, and no process reads repository-root production secrets.

**Dependencies:** A01, `ENVIRONMENTS.md`.

**Verification:** `pnpm dev:up`, `pnpm smoke:local`, and `pnpm dev:down` pass twice
from a clean generated state; secret/privacy scan passes.

**Contract impact:** None.

**Operational impact:** Documents native PostgreSQL and optional container-runtime
prerequisites; no Docker requirement.

### A03 — Establish the versioned API contract

**Outcome:** Fastify serves one generated OpenAPI 3.1 contract with RFC 9457
problems and a typed web client.

**Scope:** TypeBox/JSON Schema source, route registration, request/response
validation, problem format, correlation ID, generated OpenAPI and client,
undocumented-route check, body limits, and `/api/v1/health`.

**Non-goals:** Customer domain operations, auth, server actions, or persistence.

**Acceptance:** Invalid/unknown fields fail consistently; implementation and
documentation cannot drift; the web calls the generated client; no customer
write path exists outside `/api/v1/`.

**Dependencies:** A01.

**Verification:** `pnpm test:contract`, OpenAPI snapshot/diff, generated-client
compile, and route-inventory check pass.

**Contract impact:** Creates the API conventions but no product resource schema.

**Operational impact:** Correlation IDs and safe error serialization become
mandatory for later tasks.

## Milestone 2 — Identity and organization isolation

### A04 — Promote the PostgreSQL migration and RLS boundary

**Outcome:** The production database package creates the minimum Phase 1A schema
with forced organization isolation and reviewed migration roles.

**Scope:** Organizations, memberships, pilot profiles, aircraft, raw sources,
import batches/items/attempts, canonical flights/revisions, telemetry metadata,
idempotency, audit, outbox, migration ledger, composite ownership, forced RLS,
organization-required repository transaction, and generated Alpha/Beta seed.

**Non-goals:** Full Phase 1C/D schema, Drizzle adoption, production RDS, or UI.

**Acceptance:** Ordinary app/queue/dispatcher/migration roles match D-002; missing
context fails closed; one-connection pooled reuse clears context; migrations are
checksum-pinned and isolation-digest checked.

**Dependencies:** A01–A02, D-002, generic domain model and spike evidence.

**Verification:** `pnpm test:database` runs native PostgreSQL Alpha/Beta reads,
writes, joins, aggregates, ownership constraints, pooled clearing, grants, and
migration replay with the ordinary roles.

**Contract impact:** Implements the accepted internal ownership/provenance
contract; no new user behavior.

**Operational impact:** Defines migration/rollback ledger, database role delivery,
and pool configuration. Production startup cannot migrate.

### A05 — Integrate verified sessions and organization membership

**Outcome:** A verified user can register/sign in, create an organization as its
owner, enter a selected organization, and be revoked without provider claims
becoming authorization.

**Scope:** Exact Better Auth package/lock, reviewed auth schema migration, local
email verification/recovery, secure session adapter, app-owned organization and
invite records, owner membership/pilot-profile link, organization switch API,
last-owner protection, revocation, rate limits, CSRF/origin/redirect controls,
and audit metadata.

**Non-goals:** SSO, custom roles, billing, production email provider, or using
Better Auth organization/role claims.

**Acceptance:** Registration/verification/login/recovery/link/revoke/delete and
invite lifecycle tests pass; provider active-org/owner claims cannot elevate;
membership removal blocks access even with a live identity session.

**Dependencies:** A03–A04, D-013.

**Verification:** `pnpm test:auth` plus API Alpha/Beta claim-mismatch, revoked
session, last-owner, secure-cookie, CSRF/origin, redirect, and rate-limit tests.

**Contract impact:** Adds auth callbacks plus organization/session API schemas;
update generated OpenAPI. No role behavior beyond the accepted contract.

**Operational impact:** Auth migrations, email capture, session cleanup, auth
alerts, incident revocation, and backup/deletion ownership are exercised.

## Milestone 3 — Durable upload and isolated processing

### A06 — Implement immutable raw upload

**Outcome:** An authorized owner/admin/pilot declares and completes one raw upload
that is checksum-bound, immutable, organization-owned, and idempotent.

**Scope:** Upload declaration/completion API, derived encoded object key,
conditional put, SHA-256 and size/type checks, exact version ID, original display
filename sanitization, local object adapter, import item state, and authorization.

**Non-goals:** Batch UI, format detection beyond the selected variant, direct
public bucket access, parsing, or probable duplicates.

**Acceptance:** Client keys are rejected; retry of identical bytes returns the
same source; different bytes cannot reuse the key; Beta cannot read/complete
Alpha; unsupported size/type fails before enqueue; no signed URL is minted
without current authorization.

**Dependencies:** A03–A05, D-004/D-014.

**Verification:** `pnpm test:upload` across API, database, and loopback object
service; checksum/collision/IDOR/pool tests and object absence after rollback.

**Contract impact:** Adds raw-source/import-item upload schemas and actionable
validation problems; update OpenAPI/behavior only if observable rules differ.

**Operational impact:** Upload/object error metrics, incomplete upload cleanup,
and object version inventory begin.

### A07 — Dispatch and observe processing atomically

**Outcome:** Completing an upload atomically creates one durable organization-
scoped processing job whose status is observable and retry-safe.

**Scope:** Payload-free outbox, stable pg-boss ID, dispatcher lease/complete/
release, worker claim, strict job payload, import status API, retries/backoff,
cancellation, queue age/count/retry/dead-letter metrics, and graceful shutdown.

**Non-goals:** Parser execution, normalization, scheduling UI, or cross-job
workflows.

**Acceptance:** Domain commit/outbox are atomic; crash after send creates no
duplicate queue job; abandoned lease retries; cancelled work is unclaimable;
contextless/wrong-org jobs fail before handling.

**Dependencies:** A04, A06.

**Verification:** `pnpm test:jobs` covers rollback, post-send crash, worker kill,
stale token, cancel, retry, queue metrics redaction, and Alpha/Beta payload swap.

**Contract impact:** Adds import-status read/cancel operations; job payload is
private and versioned.

**Operational impact:** Establishes dispatcher/queue roles, supervision,
shutdown, alerts, and retry runbook.

### A08 — Package the native parser supervisor

**Outcome:** The worker runs one exact source in a fresh constrained Linux parser
container and receives only a bounded versioned private intermediate or sanitized
failure.

**Scope:** Pinned Rust source build, SBOM/notices/advisories/attestation, OCI
parser image, rootless no-network execution, read-only input, private IPC,
CPU/memory/PID/tmp/time/output limits, result schema validation, panic/timeout/
OOM/output classification, and cleanup.

**Non-goals:** DJI network access, durable keychains, normalization, or multiple
parser families.

**Acceptance:** Parser has no DB/S3/IAM/environment secret; malformed/truncated
input cannot stop worker/next parse; valid authorized evidence matches the
accepted D-009 result/resource envelope.

**Dependencies:** A01–A02, D-009; may run in parallel with A04–A07.

**Verification:** `pnpm test:parser:host` and Linux CI containment suite cover
valid, poison, panic, timeout, memory/PID/output limits, no-network, read-only FS,
private IPC cleanup, SBOM, signature, and reproducible build.

**Contract impact:** Implements the private intermediate/failure contract only.

**Operational impact:** Defines parser image promotion, resource metrics,
containment alarms, and upgrade review.

### A09 — Pass the supported DJI/key enablement gate

**Outcome:** One legally usable Phase 1A DJI variant has an explicit production
processing path, or the walking-skeleton release is declared blocked without a
false support claim.

**Scope:** Choose and document one of two acceptable paths: (A) approve D-012
terms/notice/consent, managed secret, allowlisted broker, encrypted scoped cache,
redaction/deletion tests, and representative encrypted fixture; or (B) obtain an
authorized supported unencrypted fixture/variant requiring no DJI request.

**Non-goals:** Broad DJI matrix, customer fixture acquisition without consent,
scraping/reverse engineering, or enabling provider access merely because code
exists.

**Acceptance:** Qualified review and fixture provenance are recorded; the public
support matrix names exactly what passed; unavailable key, unsupported, corrupt,
and truncated outcomes remain distinct. If neither path passes, upload/parse of
that variant stays disabled and A10–A16 cannot claim the Phase 1A exit gate.

**Dependencies:** A08, D-009/D-012, fixture policy; external owner/legal/provider
input.

**Verification:** Fixture manifest verification; provider redirect/timeout/size/
error/redaction/deletion suite when path A is used; fresh contained decode and
normalized-result comparison for the chosen variant.

**Contract impact:** Updates the supported-format matrix and customer-visible
failure/support wording; review PRODUCT/BEHAVIOR/acceptance for any scope change.

**Operational impact:** Enables only the approved provider/secret/retention path;
otherwise leaves it disabled and records the blocker.

### A10 — Normalize and persist one flight idempotently

**Outcome:** A successful parser result creates one canonical flight revision,
provenance, pilot/aircraft assignment state, telemetry object, and completed
import; exact re-upload creates no second flight.

**Scope:** Validate private intermediate, canonical-v1 adapter, source and exact-
normalized fingerprints, known/unseen reliable aircraft identity for the chosen
fixture, uploader pilot proposal, revision/provenance, versioned telemetry codec,
transactional persistence, and deterministic retry.

**Non-goals:** Probable duplicate decisions, reconciliation UI, multi-format
matrix, reprocessing UI, or full charts.

**Acceptance:** Imported/derived/override fields remain distinct; exact source or
normalized retry is idempotent; missing/ambiguous required assignment enters a
clear waiting state rather than guessing; failed object/DB commit retries safely.

**Dependencies:** A07–A09, D-003/D-005/D-006/D-008.

**Verification:** `pnpm test:normalize` and worker integration cover selected
valid fixture, exact retry/re-upload, unknown/ambiguous asset, telemetry checksum,
transaction rollback, job retry, and Alpha/Beta isolation.

**Contract impact:** Adds private processing transitions; import result exposes
only documented status/reason/match evidence.

**Operational impact:** Parser/normalize/persist duration and outcome metrics;
telemetry/object failure alerts; no intermediate payload logging.

## Milestone 4 — User-visible walking skeleton

### A11 — Serve flight summary and bounded track replay

**Outcome:** Every organization member can retrieve the created flight summary
and a bounded 2D track representation through `/api/v1/`.

**Scope:** Flight summary schema, provenance/capabilities subset, organization
authorization, telemetry metadata lookup, exact object read, D-008 downsampling
with first/last/extrema/gaps, bounded full pages for internal verification,
cache headers, and consistent not-found problem.

**Non-goals:** Full charts, search/filter, manual flight, export, corrections,
bulk operations, or 3D.

**Acceptance:** Alpha/Beta exact-ID denial is indistinguishable; default track is
responsive and preserves significant events/gaps; missing capability is absent,
not zero; no telemetry/object key appears in logs/errors.

**Dependencies:** A03–A05, A10.

**Verification:** `pnpm test:flight-api`, contract snapshot, Alpha/Beta test,
reference codec/downsampling tests, bounded page limits, corrupt object failure,
and provider-inclusive staging latency later in A15.

**Contract impact:** Adds the Phase 1A flight-summary and track schemas to
OpenAPI; must match accepted missing-data/provenance behavior.

**Operational impact:** Replay latency/object-error metrics and D-008 threshold
alarms.

### A12 — Build the minimal web vertical path

**Outcome:** A user signs in, creates/enters an organization, uploads one file,
watches its status, and opens a flight summary with a 2D MapLibre track.

**Scope:** Generated API client only, accessible auth/organization screens,
single-file upload, processing status polling, actionable failure display,
flight summary, capability-aware MapLibre track, loading/empty/error states, CSP,
and provider-free/local basemap option.

**Non-goals:** Batch upload UI, review/reconciliation, chart suite, fleet lists,
manual entry, export, maintenance, billing, or private server-action writes.

**Acceptance:** The browser performs no domain mutation outside `/api/v1/`;
organization switch clears prior data/cache; coordinates never enter tile/style
requests; corrupt/unsupported/key failures are distinct and understandable.

**Dependencies:** A03, A05–A07, A11. UI shell may begin after A03.

**Verification:** `pnpm test:web`, Playwright local happy/failure paths, network
assertion for `/api/v1/` and tile privacy, CSP report test, accessibility smoke,
and stale-organization cache test.

**Contract impact:** No new API behavior; consumes generated contracts. Update
behavior only if error/status wording changes observable rules.

**Operational impact:** Browser error correlation without payload, CSP reporting,
and no distributed Next.js cache dependency.

### A13 — Close local end-to-end failure and isolation acceptance

**Outcome:** The complete local Phase 1A path passes success, corrupt-input,
idempotency, deletion, and cross-organization acceptance from the browser/API to
database/object/parser boundaries.

**Scope:** Generated Alpha/Beta scenario builders, chosen valid fixture by policy,
controlled corrupt derivative, exact re-upload, organization removal, object
purge, worker kill/retry, redaction canaries, clean-checkout script, and evidence
report.

**Non-goals:** Full Phase 1 acceptance suite, broad fixture matrix, production
cloud, load testing beyond documented walking-skeleton thresholds, or usability
study.

**Acceptance:** Phase 1A local exit gate passes; corrupt input fails independently;
same bytes create one flight; Beta cannot infer Alpha; organization removal
leaves zero active DB/object payload; logs contain no canary values.

**Dependencies:** A01–A12.

**Verification:** `pnpm test:e2e:local` from a clean checkout plus database/object
absence queries, worker recovery, privacy scan, and retained sanitized report.

**Contract impact:** Any discovered mismatch must update canonical docs explicitly;
no silent test-only exception.

**Operational impact:** Establishes the release smoke command and evidence format.

## Milestone 5 — Deployed non-production path

### A14 — Provision and deploy isolated AWS staging

**Outcome:** Reviewed IaC creates an ephemeral synthetic-only non-production
environment and promotes the exact signed images that passed CI.

**Scope:** Separate account/VPC/subnets, EC2 host, private RDS, private versioned
S3, ECR, KMS, Secrets Manager, SSM, CloudWatch, DNS/TLS, workload/migration/
dispatcher/deletion roles, budgets, image signature verification, deploy/health/
shutdown/rollback automation, and generated seed.

**Non-goals:** Production account, customer data, Multi-AZ, autoscaling,
Kubernetes, real DJI key, production email/map provider, or uptime SLA.

**Acceptance:** IaC policy finds no public bucket/database, SSH, static cloud key,
or parser credential; exact digest promotion and previous-digest rollback pass;
environment can be destroyed and recreated.

**Dependencies:** A01, A04, A08, A13, D-014; external AWS account/spend approval.

**Verification:** IaC format/validate/plan/policy tests, staging smoke, image
signature/SBOM check, role assumption denial matrix, rollback, destroy/recreate,
and budget-alarm test.

**Contract impact:** None.

**Operational impact:** Creates paid resources under the non-production warning/
stop thresholds and assigns on-call/deploy ownership.

### A15 — Pass hosted object, restore, deletion, and observability gates

**Outcome:** The deployed synthetic path proves live S3 conformance, RDS restore
with deletion replay, redacted telemetry, and the four-hour recovery objective.

**Scope:** Temporary-bucket object contract, CloudTrail review, provider-inclusive
telemetry latency/deletion, synthetic organization deletion, RDS PITR isolated
restore, independent receipt replay, RLS digest, backup age, 30/90-day retention,
log canaries, break-glass/SSM audit, and resource destruction.

**Non-goals:** Customer data, production launch, cross-region recovery, or DJI
provider enablement.

**Acceptance:** Every hosted-data checklist item passes; deleted synthetic data
does not return after restore; no live object version remains; RTO ≤4 hours and
RPO ≤24 hours; any failure keeps hosted customer data disabled.

**Dependencies:** A14, `RECOVERY.md`, security checklist; external account/spend.

**Verification:** `pnpm test:hosted-data`, retained payload-free drill record,
CloudTrail/IAM/KMS/bucket-policy evidence, restore timing, deletion queries, log
field review, and cleanup confirmation.

**Contract impact:** Confirm the customer-visible maximum backup window; update
behavior/acceptance only if the selected value changes.

**Operational impact:** Qualifies backup, restore, deletion, break-glass,
observability, and cost procedures for synthetic non-production use.

### A16 — Complete Phase 1A release readiness

**Outcome:** One promoted staging digest passes the walking-skeleton exit gate and
the next increment can begin without hidden security/operations debt.

**Scope:** Full local and staging smoke, security checklist evidence, supported-
format statement, operational instructions for deploy/rollback/retry/logs,
incident contacts/runbooks, dependency review, cost review, product-contract
diff review, and Phase 1A exit report.

**Non-goals:** Private-beta production launch, Phase 1B batch/reconciliation,
Phase 1C features, or waiving any external gate.

**Acceptance:** Every Phase 1A delivery-plan exit item passes or has an accepted
decision exception; no UI/API claims unsupported variants or enabled providers;
critical/high controls have owners/evidence; Phase 1B entry risks are current.

**Dependencies:** A13–A15 and A09 supported-format gate.

**Verification:** `pnpm verify`, `pnpm test:e2e:local`, staging smoke, security
checklist audit, operational tabletop, sanitized exit report, and clean Git/status
review.

**Contract impact:** Explicit final review of PRODUCT, BEHAVIOR, acceptance, and
DECISIONS; changes require acceptance before release.

**Operational impact:** Hands off deployment, rollback, retry, log inspection,
restore, deletion, incident, and budget ownership. Does not authorize production
customer data by itself.

