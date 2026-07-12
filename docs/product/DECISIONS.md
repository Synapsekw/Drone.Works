# Decision Log — Drone.Works

Status: active
Last updated: 2026-07-12

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

## D-003 — Canonical normalized flight model

Status: accepted
Date: 2026-07-12

### Context

Supporting several source formats without normalization would leak vendor-specific behavior through the application.

### Decision

Parsers emit a versioned intermediate result which is normalized into one canonical flight model. Downstream product behavior consumes the canonical model and declared capabilities, not source-specific parser structures.

### Consequences

Source values and parser/model versions must be retained as provenance. The canonical schema must support missing fields and multi-battery flights.

## D-004 — Raw source immutability and deletion

Status: accepted
Date: 2026-07-12

### Context

Raw files enable parser improvement and auditability, but “keep forever” conflicts with customer deletion rights.

### Decision

Retained raw objects are immutable. They remain available while legitimately referenced by retained organization records. They are deleted when their last legitimate reference is permanently deleted or when organization deletion completes. Backups follow a documented maximum retention window.

### Consequences

Object references need lifecycle tracking. A raw object shared by processing revisions is not deleted prematurely. Technical caches must be de-identified if retained beyond customer deletion.

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

Status: proposed
Date: 2026-07-12

### Context

Flight logs may be truncated, corrupt, or adversarial. One poison file must not affect other work.

### Proposed decision

Run parsing with explicit CPU, memory, time, and filesystem/network limits in an independently terminable execution boundary. The specific process, container, or worker technology will be selected after parser evaluation.

### Consequences

Parser failures need structured classification. Parser code receives no organization credentials and no unrestricted network access.

## D-010 — Phase 1 delivery boundary

Status: accepted
Date: 2026-07-12

### Context

The original roadmap combined a flight logbook, fleet platform, compliance system, mission tool, and integration marketplace.

### Decision

Phase 1 is limited to the outcome and included behavior in `PRODUCT.md`. Deferred features do not become architectural requirements without an accepted decision.

### Consequences

Public API-key self-service, public webhooks, migration importers, configurable reporting, documents, weather enrichment, and missions are not Phase 1 release blockers.

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
