# Decision Log — Drone.Works

Status: active
Last updated: 2026-07-16

This file records architectural and implementation decisions. Product behavior belongs in `BEHAVIOR.md`; unresolved choices remain open here until accepted.

## Decision format

Each entry includes status, context, decision, consequences, and reconsideration triggers. Status is `proposed`, `accepted`, `superseded`, or `rejected`.

## D-001 — API-first domain behavior

Status: accepted
Date: 2026-07-12

### Context

Drone.Works intends to be integration-friendly and must avoid a weak public API added after the web product.

### Decision

All core domain reads and writes are available through the versioned REST API, and the first-party web application uses those operations. Auth/session and billing callbacks are standing exceptions. New exceptions require a decision entry.

### Consequences

API authorization, performance, and error behavior are product-critical from the start. Internal batch jobs may call application services directly, but they must preserve the same domain validation and authorization invariants.

## D-002 — Organization isolation in storage and application layers

Status: accepted
Date: 2026-07-12

### Context

Organization leakage would be a catastrophic failure. Defense in depth is appropriate, but the exact persistence stack has not been selected.

### Decision

Use organization identifiers on every customer-owned record, require organization context in the data-access layer, and enforce storage isolation with non-owner PostgreSQL roles, transaction-local organization context, composite organization ownership, and forced row-level security.

### Acceptance evidence

- Isolation tests cover reads, mutations, joins, aggregates, jobs, exports, and object-storage paths.
- Background jobs cannot run without explicit organization context.

### Phase 0 evidence — 2026-07-16

The first native PostgreSQL 18 spike validates the leading relational mechanism against the generic canonical ownership model. A non-owner, non-superuser, non-`BYPASSRLS` application role is constrained by forced RLS on organizations, memberships, pilots, aircraft, canonical flights, revisions, and telemetry. Composite organization foreign keys prevent cross-organization relationships. Transaction-local context is proven to clear before the same pooled backend is reused; direct reads, joins, aggregates, exports, writes, owner behavior, and organization-required job lookup have Alpha-versus-Beta negative tests.

The follow-up slice adds forced-RLS raw-source and export-artifact references plus an authorization boundary that rechecks current membership, derives escaped organization-prefixed keys only from visible rows, bounds link lifetime, and returns one denial for cross-organization, insufficient-role, expired, deleted, revoked, or missing resources. A removed admin cannot refresh a previously issued link after it expires. The executable signer remains a deterministic adapter rather than a real object-storage provider.

A third slice runs pg-boss against the native ephemeral cluster through a dedicated non-superuser queue role with no customer-table access. Durable jobs allow only a payload version, organization ID, and domain ID; validation occurs before enqueue and again at execution. A failed Alpha attempt remains Alpha-scoped through retry on the one-connection RLS pool, a Beta-scoped Alpha ID remains hidden, and an adapter-bypassing ID-only job fails before domain handling.

The first `/api/v1/` slice then proves authenticated membership and role checks over real loopback HTTP without selecting an authentication provider or API framework. All roles can view organization flights; owner/admin download access, viewer denial, pilot-own-flight raw/export scope, stored organization pilot restrictions, mixed-pilot denial, and cross-organization exact-ID denial execute through the same RLS pool and return uniform RFC 9457 not-found problems without signer access.

The mutation follow-up proves idempotent manual creation, owner/admin reassignment and delete/restore, pilot-own note editing, viewer denial, a strict 30-day restoration boundary, derived-total changes, and uniform cross-organization mutation denial. All successful mutations create RLS-protected audit events containing actor/action/time/resource and changed field names without copying note content. Idempotency state is also organization-owned and RLS-protected; equivalent replay returns the original result without a duplicate flight or audit event.

The reassignment proof also preserves the current imported pilot and aircraft as a separate baseline while storing the active user correction in an organization-owned override row. A future processing revision can update the imported baseline without erasing the effective correction.

The privileged-access follow-up adds a non-inheriting migration login that may explicitly assume only the no-login customer-schema owner. Repository migrations are checksum-pinned, serialized, replay-safe, and recorded through narrow security-definer functions in an operational ledger owned by a separate no-login audit role. The runner, schema owner, application, and queue roles have no direct ledger-table privileges; ordinary roles cannot assume migration authority. The ordered reviewed migration set leaves a deterministic digest of customer-table ownership, grants, policies, RLS, and `FORCE RLS` unchanged. This is Phase 0 mechanism evidence, not a selection of production credential delivery, CI, or emergency-access providers.

The organization-administration API follow-up proves owner/admin member listing, idempotent non-owner membership changes, settings updates, member removal with historical pilot-profile retention, and payload-redacted audits. A second checksum-pinned reviewed migration adds the organization settings/deletion state, partial single-owner index, and unlink-on-member-removal constraint without changing the isolation-contract digest. A separate owner-only transaction transfers ownership to an existing member, while owner-only deletion request/cancellation records reversible organization state without executing permanent deletion. Pilot, viewer, missing-member, and cross-organization requests remain indistinguishable.

The remaining-resource follow-up expands the reviewed isolation contract by exactly six declared tables for tags, batteries, flight associations, import batches, and import items while rejecting any change to existing table isolation. All twenty customer tables are migrator-owned with enabled and forced RLS. All members may list tag and battery definitions; owner/admin battery mutations and pilot-own tag mutations retain imported-versus-user origins and produce payload-redacted audits. Owner/admin/pilot upload declarations create idempotent batches and per-file items, while reads are limited to managers or the uploading pilot. Composite foreign keys, exact-ID API denials, and contextless reuse of the same pooled backend retain the Alpha/Beta boundary.

The complete-export follow-up adds one declared forced-RLS request table, bringing the executable customer-table matrix to twenty-one. Owner/admin API creation snapshots organization settings, documented operational collection counts, and logical raw-source references into an immutable manifest; pilots and viewers are denied. Equivalent idempotent replay creates no duplicate request or audit. The durable pg-boss payload contains only its schema version, organization ID, and export-request ID, and execution reloads the manifest through the ordinary RLS pool. A Beta-scoped job carrying an Alpha request ID returns `not_found`. This is request/manifest/queue evidence only: archive bytes, atomic dispatch, artifact creation, and real object storage remain unproven.

The maintenance follow-up adds two declared forced-RLS tables, bringing the executable customer-table matrix to twenty-three. Owner/admin operations idempotently create aircraft schedules and append completion records, while all current organization members may read calculated state and completion history. Flight-hour and flight-count consumption is derived from active canonical flights after the latest completion or initial baseline; one-shot schedules use an explicit due date and lead time. Composite aircraft/schedule ownership, exact-ID denial, payload-redacted audits, append-only completion privileges, and contextless reuse of the same pooled backend retain the Alpha/Beta boundary. Complete-export manifests now account for both maintenance collections.

The export-generation follow-up freezes a sanitized ordered data snapshot for all nineteen manifest collections inside the manager-authorized request transaction. A deterministic logical archive envelope contains a public manifest, complete JSON data, flight CSV, and telemetry CSV with canonical ordering and per-file/outer SHA-256 digests. The worker derives its artifact identity and organization-prefixed key from the request and digest, uses an injected put-if-absent adapter, then moves the RLS request to `ready` with one artifact and redacted audit. A synthetic adapter failure rolls the transaction back and succeeds through real pg-boss retry; later execution returns the existing artifact without another write. Alpha managers can authorize its download, while pilot and Beta exact-ID requests remain hidden. This proves content, artifact, and retry semantics without selecting ZIP/TAR or a real storage provider.

The permanent-organization-deletion follow-up adds a dedicated non-superuser worker with no direct customer-table access and removes ordinary-app `DELETE` from the organization root through a checksum-pinned privilege-tightening migration. Its sole deletion function binds to the exact pending-request timestamp, enforces the 30-day grace boundary, applies transaction-local forced RLS, deletes all twenty-two child table types in explicit dependency order, deletes the root, and atomically records a payload-free receipt in the separately owned operational schema. One synthetic organization with a row in every customer table reaches zero rows; early, cancelled, and cross-organization/stale references do not delete. A failure after commit retries through pg-boss and returns the original receipt without repeating the effect. This proves active relational deletion, pooled clearing, and retry idempotency without claiming object, cache, log, or backup deletion; the worker-configured backup deadline is mechanism evidence, not a selected production retention value.

The permanent-flight-deletion follow-up removes ordinary-app `DELETE` from canonical flights and raw sources and grants the same dedicated worker one timestamp-bound function. After the 30-day restoration window it deletes the canonical record, revisions, telemetry, associations, and overrides; clears retained import references before deleting raw sources linked only to that flight; and preserves a source still linked to another retained flight. Early, restored/missing, cross-organization, and stale references return the same non-eligible outcome. The retained action evidence contains only an opaque flight reference, UTC deletion time, removed-source count, system actor, and changed field. A post-commit pg-boss failure retries to that same evidence without repeating the effect, and pooled context clears.

The transactional-outbox follow-up closes the direct API-to-queue gap without granting the application role pg-boss table access. Organization-export creation and its payload-free outbox reference commit or roll back together. A separate non-superuser dispatcher has only lease/complete/release/metrics functions, derives one stable queue UUID from the organization/outbox identity, and cannot select customer or outbox tables. A simulated post-send crash reclaims the expired lease and retains exactly one pg-boss job; stale completion fails. An abandoned active job retries through supervision, a cancelled queued job remains unclaimable, and aggregate queue age/count metrics expose no organization or resource values.

The final Phase 0 slice adds a Docker-free versioned-object service boundary. It proves checksum-bound conditional creation, immutable-key collision denial, exact-version signed retrieval, expiry/signature tamper denial, cross-organization prefix preservation, permanent version enumeration/deletion, absence verification, and idempotent purge. D-014 selects private versioned S3 and requires the same conformance suite against a temporary AWS bucket before hosted customer data.

D-002 is accepted as the Phase 1A architecture. Cached keychains remain disabled until D-012 passes. Customer-payload fields are forbidden from external logs, active S3 versions are permanently deleted, RDS backup retention is capped at 35 days, and every isolated restore must replay independently retained payload-free deletion receipts before exposure. Live AWS IAM/S3 conformance and the generated-data restore drill remain Phase 1A hosted-data gates; failure keeps customer uploads disabled rather than weakening isolation or deletion. See `../architecture/TENANCY.md`, `../architecture/SECURITY-BOUNDARIES.md`, and `../operations/RECOVERY.md`.

### Phase 1A promotion — 2026-07-16

A04 promotes the generic proof into `packages/database` without copying the
full spike. One reviewed migration creates the fourteen customer tables needed
before authentication and upload work: organizations, memberships, pilots,
aircraft, raw sources, import batches/items/attempts, canonical flights and
revisions, telemetry-object metadata, idempotency, audit, and transactional
outbox references. Every table has composite organization ownership plus
enabled and forced RLS.

The production package pins both migration bytes and a deterministic isolation
digest covering the exact table set, owners, grants, policies, and force flags.
The migration runner may explicitly assume only the no-login schema owner; an
independently owned operational ledger is reachable only through narrow
security-definer functions. App queries require a validated transaction-local
organization setting. Queue and dispatcher identities have no customer-table
access at this gate; A07 owns their later pg-boss and leased-dispatch functions.
Native PostgreSQL tests prove Alpha/Beta reads, writes, joins, aggregates,
composite ownership, one-backend pool clearing, grants, replay, checksum
failure, and digest tamper detection. Local startup applies the same migration
to a disposable cluster. This is not RDS, auth integration, or a production
credential-delivery decision.

## D-003 — Canonical normalized flight model

Status: accepted
Date: 2026-07-12

### Context

Supporting several source formats without normalization would leak vendor-specific behavior through the application.

### Decision

Parsers emit a versioned intermediate result which is normalized into one canonical flight model. Downstream product behavior consumes the canonical model and declared capabilities, not source-specific parser structures.

### Consequences

Source values and parser/model versions must be retained as provenance. The canonical schema must support missing fields and multi-battery flights. Canonical import revision version 1 is a vendor-neutral private persistence contract; source adapters must validate against it before persistence.

## D-004 — Raw source immutability and deletion

Status: accepted
Date: 2026-07-12

### Context

Raw files enable parser improvement and auditability, but “keep forever” conflicts with customer deletion rights.

### Decision

Retained raw objects are immutable. They remain available while legitimately referenced by retained organization records. They are deleted when their last legitimate reference is permanently deleted or when organization deletion completes. Backups follow a documented maximum retention window.

### Consequences

Object references need lifecycle tracking. A raw object shared by processing revisions is not deleted prematurely. Technical caches must be de-identified if retained beyond customer deletion. The Phase 0 relational proof removes an expired deleted flight and its exclusive raw-source row while retaining a shared source; the versioned-object proof deletes every version and verifies absence. D-014 caps backup retention and makes deletion-receipt replay a restore gate. Live AWS conformance and the generated-data restore drill remain hosted-data gates.

## D-005 — Flight facts and user overrides

Status: accepted
Date: 2026-07-12

### Context

Improved parsers should update results without erasing corrections made by operators.

### Decision

Important fields distinguish imported values, derived values, and effective user overrides. Reprocessing creates a new processing revision and does not overwrite active user overrides.

### Consequences

The application needs a clear effective-value rule and UI affordances for viewing and removing overrides. Tests must cover recalculation of dependent summaries.

## D-006 — Duplicate classification

Status: accepted
Date: 2026-07-12

### Context

A simple timestamp-and-serial heuristic can discard legitimate flights, especially with missing batteries or rapid operations.

### Decision

Classify duplicates as exact file duplicates, exact normalized duplicates, or probable duplicates. Only exact classifications may skip canonical creation automatically. Probable duplicates require review and are reversible.

### Consequences

Fingerprint versions and match reasons are stored. Product behavior cannot rely on battery serial being present or singular.

`exact-normalized-v1` uses SHA-256 over deterministic, source-independent canonical operational material: imported normalized timing and summary facts, sorted stable aircraft identifiers, any present battery identifiers, capabilities, and telemetry samples. It excludes source/parser/provenance/organization/flight identifiers, assignments, and user overrides. Eligibility requires stable aircraft identity, reliable normalized takeoff time, and duration; a battery identifier is included when available but is not required or treated as positive evidence when absent.

## D-007 — Separate aircraft state dimensions

Status: accepted
Date: 2026-07-12

### Context

One status enum cannot correctly represent lifecycle, airworthiness, maintenance, and assignment eligibility.

### Decision

Store lifecycle and airworthiness separately, derive maintenance condition from schedules, and derive assignment eligibility from those values plus organization policy.

### Consequences

The UI must explain blocking reasons rather than displaying a single ambiguous badge.

## D-008 — Telemetry persistence and delivery

Status: accepted
Date: 2026-07-16

### Context

Telemetry is high-volume time-series data. Monthly relational partitions and a target of roughly 1,000 returned points were suggested, but actual scale and access patterns are unproven.

### Decision

Store each immutable flight revision's full normalized telemetry as one organization-owned, versioned, compressed columnar object behind the S3-compatible adapter. PostgreSQL stores ownership, revision and object identity, digest, codec/capability version, sample count, time bounds, and material summary statistics. Default replay derives at most roughly 1,000 points while retaining endpoints, material minima/maxima, warnings, and explicit gaps. Full retrieval is authorization-checked and bounded to at most 2,000 points per cursor page or an equivalent bounded stream.

Do not store Phase 1 telemetry as one PostgreSQL row per sample and do not require a time-series extension. The executable benchmark physically materialized 100,000 objects and 600 million 5 Hz frames across 100 organizations. It measured 2.872 GB of objects plus 32.1 MB of metadata, 2.87 ms warm local replay, six bounded pages for a full flight, 1.95 ms single-flight deletion, and 59.21 ms to remove 999 objects. The like-for-like partitioned-row cohort occupied 236.3 bytes per frame, projecting to 141.781 GB before database headroom, backup, WAL, or replicas. Both candidates preserved replay summaries and demonstrated deletion; the object candidate also proved additive codec evolution. Provider latency and provider-side deletion verification remain separate P0-07/D-002 obligations. See [`../research/TELEMETRY-BENCHMARK.md`](../research/TELEMETRY-BENCHMARK.md).

The disposable benchmark codec proves the layout contract but is not itself an automatic production-format commitment. A production codec must remain versioned and deterministic, expose the same capability/gap semantics, keep old objects readable, and pass the retained generator and reference tests.

### Reconsideration trigger

Rebenchmark chunked columnar objects and a managed time-series extension if p95 objects exceed 2 MiB or 50,000 samples, provider-inclusive p95 replay exceeds 500 ms, decoded worker memory exceeds 25 MiB, encoded density exceeds 50 bytes per frame, telemetry requests/egress exceed 20% of the beta budget, deletion of 1,000 objects exceeds 30 seconds, old codecs become unreadable, or sample-level cross-flight analytics enters accepted product scope.

## D-009 — Parser isolation

Status: accepted
Date: 2026-07-15

### Context

Flight logs may be truncated, corrupt, or adversarial. One poison file must not affect other work.

### Decision

Run each parse in a fresh, minimal Rust CLI inside the Linux hard-container boundary. The CLI receives one read-only source path and bounded private keychain input over standard input, and has provider networking removed from its source and dependency graph.

The CLI may emit either a small sanitized diagnostic/failure envelope or a versioned private intermediate result over bounded parser-to-worker IPC. The intermediate result may contain customer telemetry and source identifiers required for normalization, so the trusted worker must validate it before use and must never copy it into ordinary logs, public errors, durable job payloads, or project documentation. Only non-sensitive structural metrics and content digests may be retained as Phase 0 evidence.

The trusted application worker remains outside this boundary. It resolves organization authorization, source access, keychain use, and any separately authorized provider request; applies wall-time and output limits; validates the CLI result; and destroys ephemeral plaintext after the child exits. The parser child runs unprivileged with no network, a read-only filesystem, dropped capabilities, `no-new-privileges`, bounded temporary storage, and hard CPU, total-memory, PID, wall-time, and output limits.

### Consequences

Parser failures require structured supervisor classification, and every operation remains independently terminable because the reviewed upstream decoder contains unchecked reads on malformed data. Parser code receives no organization credential, DJI API credential, durable keychain payload, or network access. The trusted worker owns source-hash comparison, intermediate-schema validation, normalization, persistence, and redaction at the parser boundary.

The native boundary produced the same 27,228 frames and validation/capability summary as the JS/WASM binding on the first authorized v14 fixture while reducing observed peak RSS from approximately 410 MB to 70 MB. A fresh valid child succeeded after the controlled truncated derivative caused an upstream panic. The hardened build replaces unchecked short-record reads with I/O errors and retains the outer panic guard.

For v13+ logs, the native wrapper returns `truncated_records` only when the terminal record envelope is incomplete, the decoded prefix passes time/coordinate/battery validation, and decoded flight time remains more than one second short of the source-declared total. This avoids labeling the valid fixture's harmless partial terminal record as truncation, and avoids mislabeling invalid key/data output, while classifying the controlled derivative from source evidence rather than its fixture identity. This rule remains subject to representative-fixture validation.

The JS/WASM binding remains useful as a research comparator; it is not the production parser runtime. The native build must retain pinned-source verification, target-specific SBOM/notices, advisory checks, artifact attestation, and the Linux containment proof in CI.

### Phase 1A A08 implementation evidence — 2026-07-17

The production parser package now requires a content-addressed image and one
exact source identity, independently rehashes the source, and rejects sources
above the existing 32 MiB Phase 1A upload boundary. Each invocation creates a
fresh numeric-user container with no network, a read-only root filesystem and
source mount, all capabilities dropped, `no-new-privileges`, and explicit CPU,
memory/swap, PID, temporary-filesystem, wall-time, private-input, and total-output
limits. The supervisor inspects that effective boundary before start and always
removes the container.

Only the exact version-1 private intermediate is accepted. It must match the
source digest and size, parser identity, structural field allowlists, bounded
coordinates and percentages, monotonic time, declared sample counts, and
capabilities. Private input, captured process output, and consumed intermediate
objects are cleared; ordinary return values contain only structural counts,
content digests, resource summaries, and allowlisted failure codes. Stderr text,
source identity, telemetry, identifiers, keychains, credentials, and arbitrary
parser fields are never returned.

Eleven host tests cover boundary revalidation, private-output destruction, poison
recovery, panic recovery, wall-time/output/OOM classification, exact-source and
input limits, control deadlines, cleanup failure, and floating-image rejection.
Two disposable native builds were byte-identical across 86 evidence files. The
shipped 41-component Linux target graph had zero RustSec vulnerabilities or
warnings; four vulnerabilities and two warnings in non-target lockfile packages
were excluded by exact SBOM membership. The pinned Linux artifact,
SBOM/notices, distroless base, reviewed source inputs, OCI construction, runtime
proof, and attestations are one CI promotion path.

The hosted `DJI parser evidence` run on commit `f124740` passed all four jobs on
2026-07-17. It reproduced and verified the exact Linux binary with SHA-256
`492a5a3b57988e2216449800fc57ab1a6e8eca1657f409cc365020ea147fd718`,
passed the target-only RustSec gate and retained Linux containment suite, built
the pinned production image, proved production OCI execution and cleanup,
published binary provenance, binary SBOM, and OCI attestations, and uploaded the
release evidence. The complete hosted record is
[run 29555481380](https://github.com/Synapsekw/Drone.Works/actions/runs/29555481380).
A08 is complete; A09 remains the separate representative-fixture and DJI
provider/key enablement gate.

### Reconsideration triggers

- The combined envelope, decoded-prefix, and duration rule does not generalize across representative supported fixtures.
- Representative supported fixtures exceed the accepted Linux resource envelope.
- A maintained parser with stronger correctness and supply-chain evidence materially changes the trade-off.

## D-010 — Phase 1 delivery boundary

Status: accepted
Date: 2026-07-12

### Context

The original roadmap combined a flight logbook, fleet platform, compliance system, mission tool, and integration marketplace.

### Decision

Phase 1 is limited to the outcome and included behavior in `PRODUCT.md`. Deferred features do not become architectural requirements without an accepted decision.

### Consequences

Public API-key self-service, public webhooks, migration importers, configurable reporting, documents, weather enrichment, and missions are not Phase 1 release blockers.

## D-011 — Phase 1A application stack

Status: accepted
Date: 2026-07-12

### Context

Phase 0 needs a coherent stack candidate for tenancy, parser, telemetry, and delivery proofs. A full-stack framework alone risks weakening the public API boundary, while introducing multiple language ecosystems before parser evidence would slow a small team.

### Decision

Use a modular TypeScript monorepo with separate Next.js web, Fastify API, and Node.js worker processes. Use PostgreSQL as the primary relational system with database-enforced row security plus organization-required repositories. Package and deploy the processes as OCI containers.

Use `pg` plus checksum-pinned reviewed SQL for database access and migrations, a transactional outbox plus pg-boss for jobs, Better Auth for identity/session only, Amazon S3 behind an application-owned versioned-object adapter, and MapLibre GL JS for map rendering. Drone.Works owns organizations, invitations, memberships, and roles.

Use D-008 versioned per-flight columnar telemetry and the D-009 native Rust parser CLI in a fresh no-network Linux container. D-014 defines the initial AWS deployment and operations baseline.

### Consequences

- The web application cannot use Next.js server actions as a private domain write path.
- Web, API, and worker share versioned packages but remain independently runnable and deployable.
- Parser execution runs below the worker in a separately constrained boundary.
- PostgreSQL and pg-boss are accepted behind application-owned repository and job boundaries. Drizzle is deferred until it proves generated migrations cannot weaken security objects.
- Python remains available as an isolated parser sidecar if P0-03 demonstrates a concrete requirement, rather than becoming the default API ecosystem.

### Acceptance evidence

- P0-03 demonstrates the native parser/runtime boundary with contained corrupt-input failure.
- P0-05 proves pooled isolation, non-owner forced RLS, authorization, jobs, exports, and deletion across 23 customer tables.
- P0-06 validates the selected telemetry layout at 100,000 flights and 600 million frames.
- P0-07 proves auth claim rejection/revocation, atomic outbox dispatch, worker lease recovery/cancellation, and the versioned-object lifecycle contract.
- `SYSTEM.md`, `SECURITY-BOUNDARIES.md`, and the operations package assign environment, recovery, rollback, observability, deletion, and cost responsibilities.

### Phase 1A A07 evidence — 2026-07-16

Upload completion now changes the organization-owned import item to `queued`
and calls one narrow security-definer enqueue function inside the same forced-RLS
transaction. The resulting outbox row contains only organization, allowlisted
job type/version, and import identifiers. It lives with pg-boss in the separately
owned `droneworks_jobs` schema; the application and dispatcher have no direct
table grants, and the queue owner has no customer-table grants.

The dispatcher can only lease, complete, release, and read payload-free aggregate
outbox metrics. It derives one stable pg-boss UUID from organization plus outbox
identity, so an expired post-send lease resubmits the same job rather than making
a duplicate. Workers validate the exact `{ schemaVersion, organizationId,
importItemId }` shape before reloading the item through the ordinary application
pool and forced RLS. Missing organization context and an Alpha item paired with
Beta both stop before the domain handler.

The versioned API exposes authorized status and pending cancellation. A leased
or dispatched reference returns conflict rather than racing queue delivery; a
successfully cancelled reference is never claimable. The native A07 suite also
proves atomic rollback after outbox insertion, stale-token rejection, retry with
backoff, abandoned-worker supervision, dead-letter counts, redacted queue
metrics, membership/role denial, and context clearing on one reused backend.
This gate adds no parsing, Better Auth, AWS/RDS, uploads beyond A06, or customer
fixtures.

## D-012 — DJI keychain trust boundary

Status: accepted
Date: 2026-07-12

### Context

Version 13+ DJI logs require a keychain obtained through a DJI API. Giving the untrusted parser an API credential or network access would violate parser isolation, while placing plaintext keychains in durable jobs or logs would create a sensitive secret-distribution problem.

### Decision

Use a trusted keychain broker outside the parser process. The broker separately enforces authorization to use a keychain for decoding and authorization to transmit a request to DJI. It checks a source-scoped encrypted cache first, validates bounded requests and responses, and passes plaintext keychains to a fresh no-network parser child only through ephemeral private IPC.

The parser process never receives the DJI API credential or network access. Keychain requests, responses, keys, IVs, and feature-point values never appear in ordinary logs, durable queue payloads, public API representations, webhooks, or customer-visible errors.

Do not share physical keychain cache entries across organizations in Phase 1. Bind authenticated ciphertext to organization, raw source, parser, and log version, and delete it with source revocation, permanent source deletion, or organization deletion.

Phase 0 permits one narrow research exception to the disabled application provider: an explicit one-shot local runner may contact only the exact allowlisted DJI endpoint for one individually authorized fixture. It must default to dry-run, require a separate live flag, read a temporary ignored credential only in the trusted parent, use no durable keychain store, destroy its encrypted in-memory cache before exit, and emit only sanitized evidence. This exception does not authorize an application or worker integration and does not satisfy the production secret-store, consent, retention, or deletion gates.

### Consequences

- Key retrieval and parsing have separate trust and failure boundaries.
- Cached offline decoding does not imply permission to contact DJI again.
- Production requires a managed secret store, envelope encryption, provider timeouts/limits, and tested deletion.
- Jobs carry source references and authorization state, not keychain payloads.
- Real DJI access remains disabled until the acceptance gates in `../architecture/KEYCHAIN-BOUNDARY.md` pass.

### Production enablement evidence required

- Private parser request/keychain IPC is bounded, sanitized, and crash-cleaned.
- The provider adapter is tested against a mock server for redirects, timeouts, response limits, errors, and redaction.
- Current DJI terms, product notices/consent, and authority to use the API are approved.
- Cache schema, RLS, KMS rotation, backup, and deletion behavior pass their Phase 1A hosted tests.

The architecture decision is accepted because the broker, private IPC, mock
provider, controlled one-shot request, offline recovery, parser isolation, and
redaction evidence pass. Acceptance does not enable the production provider.
`DisabledKeychainProvider` remains mandatory until every applicable enablement
gate passes; A09 owns the stop/go decision for the walking skeleton.

### Phase 1A A09 evidence — 2026-07-17

The repository owner confirmed authority and approved the current terms-review,
versioned notice/consent, controlled fixture processing, and provider use for the
narrow v14 path. The accepted public matrix enables only DJI Fly / DJI TXT v14;
other DJI applications and versions remain disabled until independently tested.

The production seam now uses a trusted provider adapter with exact endpoint and
redirect interlocks, runtime credential references, bounded payload validation,
separate store-derived authorization decisions, and an organization/source/
parser/version-scoped PostgreSQL cache encrypted with AES-256-GCM through an
injected managed-key provider. Forced RLS, current membership, retained-source
checks, pooled-connection context clearing, revocation, source/organization
deletion, and payload-redacted audit metadata remain authoritative. Keychain
request construction and decode each run in a fresh no-network parser child.

A newly approved DJI Fly v14 fixture produced one bounded request and response,
decoded 5,049 samples in the rebuilt native child, reproduced the same private
intermediate digest in two fresh operations, and produced one eligible canonical
revision candidate. Ordinary output contained only sanitized structural and
process evidence. Hosted Linux reproducibility and release-digest pinning remain
the final A09 promotion check; no AWS resource is required or provisioned by this
decision.

## D-013 — Self-hosted authentication with an app-owned authorization boundary

Status: accepted
Date: 2026-07-16

### Context

Phase 1 needs verified users, linked accounts, revocable web sessions, recovery,
and invitations without creating a second source of truth for organizations and
roles. A managed organization product lowers identity operations but couples
core tenancy to provider limits and increases exit effort. First-party password
and session implementation would make a small team own an avoidable security
surface.

### Decision

Use self-hosted Better Auth with PostgreSQL for identity, credentials, account
linking, email verification, and web sessions. Pin and review the exact package,
lockfile, and generated migrations in A13b after the functional local gate and
before any hosted deployment.

Drone.Works owns organizations, invitations, memberships, ownership transfer,
and owner/admin/pilot/viewer roles. The API identity adapter accepts only a
session identifier and user identifier. It ignores provider-selected
organizations and provider roles; the route organization plus current canonical
membership, repository authorization, and forced PostgreSQL RLS remain
authoritative.

Clerk Organizations is the managed fallback if self-hosted auth operations prove
disproportionate. First-party credential/session implementation is rejected for
Phase 1.

### Consequences

- Better Auth tables are separate from the customer RLS schema and cannot be
  joined as an authorization shortcut.
- Invitations are app-owned, random, single-use, expiring domain records whose
  accepting verified email must match.
- Session removal and membership removal are independent controls; either can
  prevent access.
- Auth callbacks remain a narrow exception to `/api/v1/` and cannot become a
  private customer-domain API.
- The application owns email delivery, abuse protection, upgrades, backup,
  restore, deletion, and incident response for the self-hosted component.

### Evidence and implementation gates

The provider-neutral adapter and native PostgreSQL suite prove that forged
provider organization/role claims do not grant access and that revocation fails
immediately. The comparison and remaining real-package integration gates are in
[`../research/AUTHENTICATION-EVALUATION.md`](../research/AUTHENTICATION-EVALUATION.md).

## D-014 — AWS private-beta deployment and versioned object lifecycle

Status: accepted
Date: 2026-07-16

### Context

The walking skeleton needs one deployable, recoverable environment without
making a small beta pay for Kubernetes, a separate queue datastore, or
cross-region high availability. Raw sources and telemetry need immutable
retention, exact signed access, and permanent deletion even when object
versioning is enabled.

### Decision

Use separate production and non-production AWS accounts. Keep AWS Middle East
(UAE), `me-central-1`, as the preferred customer-data target, but require an
operational-readiness check before provisioning any region. While UAE is not
operationally suitable, AWS Europe (Frankfurt), `eu-central-1`, may host
ephemeral synthetic-only staging. This fallback does not authorize customer or
production data outside an approved residency, and Bahrain is not an automatic
substitute; every candidate region is evaluated independently.

Run digest-pinned OCI web, API, worker, dispatcher, and rootless parser
containers on one replaceable Graviton EC2 host; use private Single-AZ RDS
PostgreSQL, private versioned S3, ECR, KMS, Secrets Manager, Systems Manager,
and CloudWatch. The region remains a required IaC input so moving the same
portable application and reviewed PostgreSQL migrations does not require an
application/schema rewrite. A customer-data move still requires explicit
residency approval, backup/restore planning, and a tested migration.

Use application-derived organization prefixes, conditional checksum-confirmed
object creation, stored version IDs, exact-version signed GET, and permanent
enumerate/delete/relist for customer deletion. A simple delete marker never
counts as deletion completion. Local and CI use generated data with native
PostgreSQL and loopback object/email services; Docker and production credentials
are not required.

Production RDS automated backups retain at most 35 days. An isolated restore is
not exposed until forced-RLS checks and independently retained payload-free
deletion receipts have been replayed. Application logs retain 30 days and
security/control logs 90 days, with customer payload forbidden from both.

### Consequences

- The single host and Single-AZ database are explicit private-beta availability
  tradeoffs under a four-hour RTO and 24-hour RPO, not an external SLA.
- Multi-AZ or multiple application hosts become mandatory before an uptime
  commitment or if recovery drills miss the objectives.
- S3 and AWS-specific operations stay behind adapters and IaC; PostgreSQL,
  object formats, OCI images, and OpenTelemetry-compatible signals preserve an
  exit path.
- Live AWS IAM/S3 conformance and a generated-data restore/deletion-replay drill
  block hosted customer data. They require a temporary account/bucket and incur
  external state/cost, so Phase 0 accepts the design with that safe gate rather
  than using production credentials during discovery.
- Cached DJI keychains and external DJI network access remain disabled until
  D-012 is accepted.

### Evidence and operating envelope

The Docker-free loopback service passes immutable retry/collision, signed exact
version, expiry/tamper, cross-organization preservation, version purge,
verification, and idempotency tests. Component ownership and failure/exit paths
are in [`../architecture/SYSTEM.md`](../architecture/SYSTEM.md), controls in
[`../architecture/SECURITY-BOUNDARIES.md`](../architecture/SECURITY-BOUNDARIES.md),
and environments, restore/rollback, retention, and monthly alert thresholds in
[`../operations/`](../operations/).

### Phase 1A A06 evidence — 2026-07-16

The versioned API now declares one organization-owned import item before bytes
are accepted, derives its object key from server-generated organization/upload
IDs, and exposes content only through a currently authorized API operation. The
local adapter performs a conditional write, confirms SHA-256, byte size, media
type, and the exact generated object version, and returns the same version for an
identical retry. Completion records that version in `raw_sources` and links it to
the import item inside an organization-required transaction; an unreferenced
exact version is deleted when that transaction rolls back.

Declaration and completion reuse the existing organization/user/operation-scoped
idempotency ledger, while audit metadata contains only an item count. The current
32 MiB `application/octet-stream` boundary is an explicit walking-skeleton input
limit, not the final supported DJI format matrix. Six API/database/object tests
plus the integrated local smoke prove authorization, membership removal,
checksum and occupied-key collisions, identical retry, Alpha/Beta exact-ID
denial, exact-version rollback cleanup, and pooled-connection context clearing.
No job, parser, Better Auth, AWS, RDS, signed public URL, or customer fixture was
introduced.

## D-015 — Functional local development before authentication

Status: accepted
Date: 2026-07-16

### Context

The application can deliver faster product feedback if upload, processing,
flight, and web behavior are assembled locally before integrating a credential
and session provider. Deferring all identity and authorization would create an
unsafe late rewrite, while requiring Better Auth now would put login operations
ahead of the functional workflow the first implementation needs to learn from.
AWS is not required for either path because A02/A04 provide disposable native
PostgreSQL and loopback services.

### Decision

Split identity from authorization in the Phase 1A sequence. A05 introduces the
provider-neutral identity interface, app-owned organization membership and role
checks, plus a generated development-persona adapter. The adapter is permitted
only when the validated environment is `local` or `test`, an explicit local
identity flag is enabled, and the selected persona is resolved from a
server-owned generated scenario manifest. It never accepts arbitrary user,
organization, membership, or role identifiers from the browser.

All operations still resolve the route organization through current canonical
membership, application authorization, organization-required repositories, and
forced PostgreSQL RLS. The local adapter is therefore a convenient source of a
generated user ID, not an authorization bypass and not proof of authentication.
Hosted-mode startup and route-inventory tests must fail if the adapter or its
development control is enabled or exposed.

A06–A13a build and prove the functional application locally with this adapter.
A13b then pins and integrates Better Auth, adds verified identity/session and
invitation lifecycles, confirms the development control remains excluded from
hosted builds, and repeats the functional end-to-end and Alpha/Beta suites. A13b
must pass before
A14 may provision or deploy AWS staging. PostgreSQL remains part of local
development; only managed RDS is deferred to A14.

### Consequences

- A functional local-app gate is available before login, email, cookies, or AWS.
- Authorization behavior is built once behind a provider-neutral identity seam
  and exercised with both generated and real session identities.
- Passing A13a cannot be described as authenticated, staging-ready, releasable,
  or safe for customer data.
- Better Auth integration remains mandatory before any hosted environment, and
  D-013 remains the final identity/session selection.
- CI must prove the local adapter is unavailable under staging and production
  configuration; failure keeps deployment disabled.
- Delaying the provider creates integration risk, so A13b repeats the complete
  functional path rather than relying only on isolated auth tests.

### Reconsideration triggers

- The local adapter cannot be excluded from hosted startup and route inventory
  with objective tests.
- Better Auth integration would require changing domain authorization rather
  than replacing only the identity source.
- The A13a functional path cannot be repeated unchanged under real sessions.

### Phase 1A A05 evidence — 2026-07-16

The production API now depends on a provider-neutral identity source. Its
generated adapter issues only an opaque in-memory token for a named compiled
persona, is enabled by a separate validated flag in `local` or `test`, and is
rejected when either half of that interlock is absent. The control route is
hidden from public OpenAPI and is not registered in hosted configuration.

Organization creation generates IDs on the server and atomically creates the
organization, owner membership, linked pilot profile, and payload-redacted
audits. Selection and membership operations reload the actor's current
canonical membership inside an organization-required transaction. Owner/admin
membership management, pilot/viewer denial, immediate removal, retained pilot
history, and organization-row-serialized last-owner protection sit behind the
same ordinary application pool and forced RLS used by A04.

The disposable native PostgreSQL suite proves local/test and hosted
configuration matrices, arbitrary persona and forged-token rejection,
Alpha/Beta exact-ID denial, all four roles, membership revocation, last-owner
rules, audit redaction, and one-backend context clearing. An integrated local
runtime smoke proves generated persona issuance through Alpha organization
selection. Better Auth, credentials, cookies, invitations, email, AWS, RDS, and
uploads remain absent.

## Open decisions

The following require evidence before implementation commitment:

1. Transactional email and production map-tile providers.
2. Which production customer-data region early contracts and residency review authorize.
3. DJI terms, notice/consent, and production key-service authorization under D-012.
4. Supported DJI application/format matrix after representative fixture expansion.
5. Billing provider and UAE/global tax strategy, after early product validation.
