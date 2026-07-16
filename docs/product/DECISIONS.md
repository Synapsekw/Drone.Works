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

Status: proposed
Date: 2026-07-12

### Context

Organization leakage would be a catastrophic failure. Defense in depth is appropriate, but the exact persistence stack has not been selected.

### Proposed decision

Use organization identifiers on every customer-owned record, require organization context in the data-access layer, and add a database-enforced isolation mechanism where the selected database supports it. Postgres row-level security is the current leading option, not yet an accepted commitment.

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

This evidence does not yet accept D-002. Provider-side signed-URL expiry and object deletion, complete-export archive/artifact generation, and permanent deletion paths remain open. Production credential delivery, externally retained audit logs, and emergency operations remain P0-07 concerns. See `../architecture/TENANCY.md`.

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

Object references need lifecycle tracking. A raw object shared by processing revisions is not deleted prematurely. Technical caches must be de-identified if retained beyond customer deletion. The Phase 0 lifecycle proof keeps immutable revisions separate from mutable delete/restore state and makes source deletion eligibility explicit; database, object-storage, export, log, and backup enforcement remain later proof obligations.

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

Status: proposed
Date: 2026-07-12

### Context

Telemetry is high-volume time-series data. Monthly relational partitions and a target of roughly 1,000 returned points were suggested, but actual scale and access patterns are unproven.

### Proposed decision

Benchmark representative fixtures before selecting relational partitions, a time-series extension, or object-backed columnar storage. Default API responses are downsampled and extrema-preserving; full retrieval is bounded and paginated or streamed.

### Reconsideration trigger

Accept a storage design only after measuring import, replay, export, deletion, and cost on a dataset representing at least 100,000 flights.

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

## D-011 — Provisional Phase 1A application stack

Status: proposed
Date: 2026-07-12

### Context

Phase 0 needs a coherent stack candidate for tenancy, parser, telemetry, and delivery proofs. A full-stack framework alone risks weakening the public API boundary, while introducing multiple language ecosystems before parser evidence would slow a small team.

### Proposed decision

Use a modular TypeScript monorepo with separate Next.js web, Fastify API, and Node.js worker processes. Use PostgreSQL as the primary relational system with database-enforced row security plus organization-required repositories. Package and deploy the processes as OCI containers.

Shortlist Drizzle for database access/migrations, pg-boss for background jobs, Better Auth for web authentication and organization membership, S3-compatible object storage for immutable sources, and MapLibre GL JS for map rendering. These shortlist components are not accepted until their proof obligations in `../architecture/STACK-SCORECARD.md` pass.

Telemetry layout, DJI parser/runtime, authentication provider, and deployment vendors remain deliberately unresolved under their Phase 0 workstreams.

### Consequences

- The web application cannot use Next.js server actions as a private domain write path.
- Web, API, and worker share versioned packages but remain independently runnable and deployable.
- Parser execution runs below the worker in a separately constrained boundary.
- PostgreSQL is the provisional database commitment; Drizzle and pg-boss remain replaceable implementation choices.
- Python remains available as an isolated parser sidecar if P0-03 demonstrates a concrete requirement, rather than becoming the default API ecosystem.

### Acceptance evidence required

- P0-01 owner assumptions and quality-attribute weights are confirmed.
- P0-03 demonstrates a viable parser/runtime boundary.
- P0-05 proves organization isolation with pooled connections and non-owner application roles.
- P0-06 validates a telemetry layout at the benchmark profile.
- P0-07 completes authentication, deployment, recovery, and cost comparisons.

## D-012 — DJI keychain trust boundary

Status: proposed
Date: 2026-07-12

### Context

Version 13+ DJI logs require a keychain obtained through a DJI API. Giving the untrusted parser an API credential or network access would violate parser isolation, while placing plaintext keychains in durable jobs or logs would create a sensitive secret-distribution problem.

### Proposed decision

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

### Acceptance evidence required

- Private parser request/keychain IPC is bounded, sanitized, and crash-cleaned.
- The provider adapter is tested against a mock server for redirects, timeouts, response limits, errors, and redaction.
- Current DJI terms, product notices/consent, and authority to use the API are approved.
- Cache schema, RLS, KMS rotation, backup, and deletion behavior pass their Phase 0 proofs.

## Open decisions

The following require evidence before implementation commitment:

1. Application/runtime stack and deployment platform.
2. Primary database and organization-isolation mechanism.
3. Telemetry storage, indexing, downsampling, and deletion strategy.
4. Background job and parser-isolation technology.
5. Authentication provider versus first-party authentication.
6. Map, geocoding, and terrain providers.
7. DJI key acquisition, terms, cache scope, and failure handling.
8. Backup retention and deletion-verification mechanism.
9. Supported DJI application/format version matrix based on legally obtained fixtures.
10. Billing provider and UAE/global tax strategy, after early product validation.
