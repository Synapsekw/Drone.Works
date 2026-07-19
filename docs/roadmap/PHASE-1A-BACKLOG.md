# Phase 1A implementation backlog

Status: implementation-ready
Last updated: 2026-07-17
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
- The development identity is a local/test harness, not authentication. It may
  exercise app-owned authorization but can never satisfy a hosted or release
  identity gate.
- A task is done only when its acceptance and verification evidence are linked
  from the change. Product-visible contract changes require explicit product
  document review.

## Critical path and safe parallel work

```text
A01 repository
  -> A02 local runtime
  -> A03 API contracts
  -> A04 PostgreSQL/RLS
  -> A05 local identity seam + organization authorization
  -> A06 immutable upload
  -> A07 outbox + jobs
  -> A08 parser supervisor
  -> A09 supported-format/key gate
  -> A10 normalize + persist
  -> A11 flight summary/replay API
  -> A12 web vertical path
  -> A13a functional local end-to-end
  -> A13b verified auth + repeated end-to-end
  -> A14 staging deployment
  -> A15 hosted data/recovery gates
  -> A16 beta readiness
```

After A01, parser packaging in A08 and IaC scaffolding in A14 may begin without
credentials. After A03, the web shell portion of A12 may proceed against
generated contracts. A05 and A08 may run in parallel after A04/A01 respectively.
A13a is the functional local-app gate. Better Auth is deliberately integrated in
A13b after that gate and before any AWS deployment; the local identity can never
pass A13b. A09 is the only external decision on the walking-skeleton functional
path: either D-012's encrypted-key enablement passes, or an authorized
unencrypted supported variant must be obtained. No implementation may silently
substitute an unsupported log.

## Milestone 1 — Runnable local foundation

### A01 — Bootstrap the production repository

**Status:** Complete (2026-07-16). Evidence: the pinned root workspace and CI
workflow, with commands documented in
[`LOCAL-DEVELOPMENT.md`](../operations/LOCAL-DEVELOPMENT.md).

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

**Status:** Complete (2026-07-16). Evidence: native PostgreSQL and loopback
orchestration under `scripts/dev/`, verified by the documented start, smoke, and
cleanup commands.

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

**Operational impact:** Documents native PostgreSQL prerequisites; no Docker or
container-runtime requirement.

### A03 — Establish the versioned API contract

**Status:** Complete (2026-07-16). Evidence: the generated OpenAPI 3.1 snapshot,
compiled client, route inventory, and contract tests in `packages/contracts/`
and `apps/api/`.

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

## Milestone 2 — Local identity seam and organization isolation

### A04 — Promote the PostgreSQL migration and RLS boundary

**Status:** Complete (2026-07-16). Evidence: the checksum-pinned migration,
independently owned ledger, organization-required transaction wrapper, and
native PostgreSQL suite in `packages/database/`; the no-cloud local runtime now
applies the same migration and generated Alpha/Beta seed.

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

### A05 — Establish the local identity seam and organization authorization

**Status:** Complete (2026-07-16). Evidence: the provider-neutral identity
source, generated-persona interlock/control, organization authorization
repository, versioned organization/membership routes, and disposable native
PostgreSQL suite in `apps/api`, `packages/database`, and `packages/contracts`;
the local runtime smoke exercises persona issuance through canonical Alpha
selection.

**Outcome:** A generated local persona can create or enter an organization and
exercise the real app-owned membership and role boundary without installing an
authentication provider.

**Scope:** Provider-neutral identity interface, explicit local/test-only persona
adapter, server-side generated-persona allowlist, hosted-mode startup rejection,
app-owned organization and membership records, owner membership/pilot-profile
link, organization selection API, last-owner protection, current-membership role
checks, Alpha/Beta personas, and payload-redacted audit metadata.

**Non-goals:** Better Auth, credentials, registration, login, cookies, email
verification/recovery, invitations, SSO, production identity, or accepting a
browser-supplied user, organization, or role as authority.

**Acceptance:** The adapter requires both a local/test environment and an
explicit development flag; staging/production configuration fails at startup;
only server-allowlisted generated persona names resolve to user IDs; every route
still derives organization access from current canonical membership and forced
RLS; removing membership blocks the next operation; Alpha/Beta exact-ID denials
remain indistinguishable.

**Dependencies:** A03–A04, D-002, D-013, D-015.

**Verification:** `pnpm test:authorization` covers the configuration matrix,
unknown/arbitrary persona rejection, role matrix, membership removal, last-owner
rules, organization switching, exact-ID denial, and one-connection pool reuse.

**Contract impact:** Adds organization and membership API schemas to generated
contracts. The persona control is a D-015 local test-harness exception outside
`/api/v1/`, excluded from public OpenAPI and hosted route inventories.

**Operational impact:** Documents the local-only identity switch, generated seed,
startup interlock, and the later A13b replacement point. It creates no auth schema
or hosted credential.

## Milestone 3 — Durable upload and isolated processing

### A06 — Implement immutable raw upload

**Status:** Complete (2026-07-16). Evidence: the versioned declaration, content,
completion, and status API derives storage keys after current membership checks;
the local adapter conditionally writes checksum-bound immutable bytes and records
the exact version. `pnpm test:upload` proves the four-role matrix, immediate
membership removal, idempotency, checksum and occupied-key collisions,
Alpha/Beta exact-ID denial, database rollback cleanup, audit redaction, and
one-backend context clearing against disposable native PostgreSQL plus the
loopback object service.

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

**Status:** Complete (2026-07-16). Evidence: upload completion and one
payload-free outbox reference commit in the same forced-RLS transaction; the
separately owned jobs schema leases that reference to a non-customer dispatcher,
which derives one stable pg-boss UUID. `pnpm test:jobs` proves rollback,
post-send deduplication, stale-token denial, lease and worker recovery, safe
pending cancellation, retry/backoff, dead-letter and redacted aggregate metrics,
strict contextless/wrong-organization rejection, and one-backend context clearing
against disposable native PostgreSQL.

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

**Status:** Complete (2026-07-17). Evidence: the production package, pinned
release manifest, rootless image, strict private intermediate validator,
sanitized supervisor, host suite, and promotion workflow pass the
[hosted Linux gate](https://github.com/Synapsekw/Drone.Works/actions/runs/29555481380).
That run built the exact native artifact twice, passed target-only RustSec and
the retained Linux containment suite, exercised and cleaned up the exact
production OCI image, published binary provenance/SBOM and OCI attestations, and
uploaded the release evidence.

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

**Status:** Complete (2026-07-17). Path A is selected for the exact DJI Fly /
DJI TXT v14 variant in
[`SUPPORTED-FORMATS.md`](../product/SUPPORTED-FORMATS.md). Hosted
[parser evidence run `29558470922`](https://github.com/Synapsekw/Drone.Works/actions/runs/29558470922)
and [repository verify run `29558470853`](https://github.com/Synapsekw/Drone.Works/actions/runs/29558470853)
are green.

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

**Status:** Complete (2026-07-17). Evidence: the production canonical-v1
adapter, fixed-order versioned telemetry codec, checksum-pinned migration,
organization-scoped persistence repository, and `pnpm test:normalize` native
PostgreSQL/pg-boss suite cover the selected valid shape, exact retry and both
duplicate classes, known/unseen/model-only/ambiguous aircraft evidence,
telemetry checksum, object and transaction rollback/retry, redacted metrics and
audit metadata, and Alpha/Beta pooled isolation. `pnpm test:upload` separately
proves exact-file raw-source reuse and redundant-object cleanup.

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

**Status:** Complete (2026-07-17). Evidence: the generated OpenAPI contract,
organization-authorized current-revision repository, exact-version loopback
object read, checksum/codec/metadata verification, deterministic significant-v1
selection, revision-bound full paging, private cache policy, and
`pnpm test:flight-api` native PostgreSQL suite cover all four Alpha roles,
Beta/removed exact-ID denial, endpoint/extrema/gap preservation, 2,000-sample
page limits, corrupt-object redaction, payload-free metrics, and one-backend RLS
context clearing. Provider-inclusive staging latency remains assigned to A15.

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

**Status:** Complete (2026-07-17). Evidence: the generated v1 client now owns
every organization, upload, status, summary, and track call; the local-only
persona UI/rewrite is excluded from the hosted production build; the source-free
MapLibre style keeps coordinates in memory; and `pnpm test:web` passes seven
production-browser tests for the happy path, public failure categories,
authorization, organization-switch clearing, capability absence, CSP reporting,
accessibility, and request/coordinate boundaries. The native jobs suite adds the
result-flight and redacted failure projection under forced RLS. A13a still owns
the real parser/worker end-to-end path.

**Outcome:** A generated local persona creates/enters an organization, uploads
one file, watches its status, and opens a flight summary with a 2D MapLibre
track.

**Scope:** Generated API client only, a clearly marked development-persona
control, accessible organization screens, single-file upload, processing status
polling, actionable failure display, flight summary, capability-aware MapLibre
track, loading/empty/error states, CSP, and provider-free/local basemap option.

**Non-goals:** Batch upload UI, review/reconciliation, chart suite, fleet lists,
manual entry, export, maintenance, billing, login/registration/recovery/invite
screens, or private server-action writes.

**Acceptance:** The browser performs no domain mutation outside `/api/v1/`;
organization switch clears prior data/cache; coordinates never enter tile/style
requests; corrupt/unsupported/key failures are distinct and understandable; the
UI states that the generated persona is local development only and the persona
control is absent from hosted builds.

**Dependencies:** A03, A05–A07, A11. UI shell may begin after A03.

**Verification:** `pnpm test:web`, Playwright local happy/failure paths, network
assertion for `/api/v1/` and tile privacy, CSP report test, accessibility smoke,
and stale-organization cache test.

**Contract impact:** No new API behavior; consumes generated contracts. Update
behavior only if error/status wording changes observable rules.

**Operational impact:** Browser error correlation without payload, CSP reporting,
and no distributed Next.js cache dependency.

### A13a — Close the functional local application

**Status:** Complete (2026-07-19). Evidence: `pnpm test:e2e:functional`
starts the native disposable PostgreSQL and loopback services without Docker,
drives the real generated-persona browser through an approved DJI Fly v14
source, kills and replaces the active worker, and reaches the persisted flight
summary and provider-free MapLibre track. The same gate proves unapproved key
retrieval fails closed, exact bytes reuse one retained flight, a controlled
corrupt derivative fails independently, Beta cannot infer Alpha, browser domain
mutations stay under `/api/v1/`, coordinates make no unrelated request,
redaction canaries stay out of service logs, and teardown leaves zero Alpha
customer rows and no referenced raw or telemetry object versions. The retained
sanitized matrix is in `../testing/A13A-FUNCTIONAL-EVIDENCE.md`; Better Auth,
AWS, RDS, and hosted credentials remain absent.

**Outcome:** The complete functional application path passes locally under the
generated identity: organization entry, upload, processing, summary, track,
corrupt-input, idempotency, deletion, and cross-organization behavior work from
the browser through database/object/parser boundaries.

**Scope:** Generated Alpha/Beta scenario builders, chosen valid fixture by policy,
controlled corrupt derivative, exact re-upload, organization removal, object
purge, worker kill/retry, redaction canaries, clean-checkout script, and evidence
report.

**Non-goals:** Real authentication, any hosted deployment, full Phase 1 acceptance
suite, broad fixture matrix, load testing beyond documented walking-skeleton
thresholds, or usability study. Passing A13a does not authorize staging or a
release.

**Acceptance:** The functional local gate passes; corrupt input fails
independently; same bytes create one flight; Beta cannot infer Alpha;
organization removal leaves zero active DB/object payload; logs contain no
canary values; hosted-mode startup rejects the development identity.

**Dependencies:** A01–A12.

**Verification:** `pnpm test:e2e:functional` from a clean checkout plus
database/object absence queries, worker recovery, privacy scan, hosted-mode
identity rejection, and a retained sanitized report.

**Contract impact:** Any discovered mismatch must update canonical docs explicitly;
no silent test-only exception.

**Operational impact:** Establishes the local functional smoke command and
evidence format. The environment remains disposable, generated, and no-cloud.

## Milestone 5 — Verified identity before hosting

### A13b — Replace the development identity with verified sessions

**Outcome:** A verified user can register/sign in, create or enter an
organization, run the same functional path, and be revoked without provider
claims becoming authorization; the development identity remains unavailable in
staged and hosted modes.

**Scope:** Exact Better Auth package/lock, reviewed auth schema migration, local
email verification/recovery, secure provider-neutral session adapter, app-owned
invitations, verified-user organization creation/linking, invite acceptance,
organization switching, session and membership revocation, account deletion,
rate limits, CSRF/origin/redirect controls, auth audit metadata, and repetition of
the A13a browser/API/database isolation path under real sessions.

**Non-goals:** SSO, custom roles, billing, production email provider, using
Better Auth organization/role claims, AWS, or weakening any local functional
acceptance to accommodate the provider.

**Acceptance:** Registration/verification/login/recovery/link/revoke/delete and
invite lifecycle tests pass; provider active-org/owner claims cannot elevate;
membership removal blocks access even with a live identity session; secure cookie
and request controls pass; staged/hosted route inventory contains no development
identity operation; the repeated A13a path remains green.

**Dependencies:** A13a, D-013, D-015.

**Verification:** `pnpm test:auth` plus `pnpm test:e2e:local`; Alpha/Beta
claim-mismatch, revoked session, last-owner, secure-cookie, CSRF/origin, redirect,
rate-limit, provider-migration, local-adapter absence, and full-path replay tests.

**Contract impact:** Adds auth callbacks and session schemas, confirms the local
persona control remains excluded from public and hosted route inventories, and
updates generated OpenAPI. No role behavior changes from the accepted app-owned
contract.

**Operational impact:** Auth migrations, local email capture, session cleanup,
auth alerts, incident revocation, backup/deletion ownership, and the hard
development-identity exclusion gate are exercised before AWS.

## Milestone 6 — Deployed non-production path

### A14 — Provision and deploy isolated AWS staging

**Outcome:** Reviewed IaC creates an ephemeral synthetic-only non-production
environment and promotes the exact signed images that passed CI.

**Scope:** Separate account/VPC/subnets, EC2 host, private RDS, private versioned
S3, ECR, KMS, Secrets Manager, SSM, CloudWatch, DNS/TLS, workload/migration/
dispatcher/deletion roles, budgets, image signature verification, deploy/health/
shutdown/rollback automation, generated seed, explicit region input, and a
pre-provision regional health/service-availability gate.

**Non-goals:** Production account, customer data, Multi-AZ, autoscaling,
Kubernetes, real DJI key, production email/map provider, or uptime SLA.

**Acceptance:** IaC policy finds no public bucket/database, SSH, static cloud key,
or parser credential; exact digest promotion and previous-digest rollback pass;
environment can be destroyed and recreated. Frankfurt fallback remains
synthetic-only and cannot enable customer uploads.

**Dependencies:** A01, A04, A08, A13b, D-014; external AWS account/spend
approval.

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

**Dependencies:** A13b–A15 and A09 supported-format gate.

**Verification:** `pnpm verify`, `pnpm test:e2e:local`, staging smoke, security
checklist audit, operational tabletop, sanitized exit report, and clean Git/status
review.

**Contract impact:** Explicit final review of PRODUCT, BEHAVIOR, acceptance, and
DECISIONS; changes require acceptance before release.

**Operational impact:** Hands off deployment, rollback, retry, log inspection,
restore, deletion, incident, and budget ownership. Does not authorize production
customer data by itself.
