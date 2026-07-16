# Architecture quality attributes

Status: accepted planning baseline for Phase 1A
Last updated: 2026-07-16

## Purpose

These attributes convert the Drone.Works product contract into measurable architecture constraints. They are used to compare stack candidates and to reject options that are convenient but unsafe for the product.

## Accepted planning assumptions and reconsideration triggers

These are accepted for implementation planning, not permanent product promises:

- One primary builder initially, with AI-assisted development and review.
- TypeScript is acceptable as the main product language.
- The beta must operate on a modest infrastructure budget.
- Managed infrastructure is acceptable when data remains exportable and the application remains container-portable.
- Initial customers may be in the UAE or elsewhere; no contractual regional-residency requirement is assumed yet.
- Early beta availability is important, but there is no external uptime SLA yet.
- Production customer flight logs will never be used as casual development fixtures.

If an assumption changes, update this document and rescore affected candidates before scaffolding production code.

## Evaluation profiles

These profiles exist for engineering tests and cost comparisons. They are not customer or sales forecasts.

| Profile | Organizations | Users | Flights | Typical flight | Typical telemetry | Purpose |
|---|---:|---:|---:|---:|---:|---|
| Local | 2 | 6 | 100 | 20 min | 5 Hz | Developer and isolation tests |
| Beta | 10 | 100 | 25,000 | 20 min | 5 Hz | Early operational and cost model |
| Benchmark | 100 | 1,000 | 100,000 | 20 min | 5 Hz | Storage and query architecture gate |

At 5 Hz, a 20-minute flight contains roughly 6,000 frames. The benchmark profile therefore represents roughly 600 million frames before any alternate encoding or compression. Sparse fields and higher-rate sources must also be represented in the benchmark generator.

## Priority and weighting

| Attribute | Weight | Why it matters |
|---|---:|---|
| Organization isolation and authorization | 20 | Cross-customer disclosure is a catastrophic failure |
| Data integrity, provenance, and deletion | 15 | The product differentiates on trustworthy records |
| Async work and parser isolation | 15 | Real logs can be malformed, encrypted, or expensive to process |
| Public API contract | 10 | The first-party UI and integrations share the same domain API |
| Telemetry access and lifecycle | 10 | Replay, export, reprocessing, and deletion are core workloads |
| Delivery speed and maintainability | 10 | A small team must ship and understand the system |
| Operability and recovery | 8 | Jobs and data pipelines require observable failure and retry |
| Deployment portability | 7 | The product should not depend on one proprietary compute model |
| Early operating cost | 5 | Beta economics matter but cannot overrule safety |
| **Total** | **100** | |

Product non-negotiables are disqualifying even if a candidate would otherwise receive a high weighted score.

## QA-01 — Organization isolation and authorization

### Required behavior

- Every customer-owned record has exactly one organization owner.
- Ordinary database access fails closed when organization context is missing.
- Direct-ID access, joins, aggregates, mutations, jobs, exports, and downloads remain organization-scoped.
- Application authorization enforces the Phase 1 role matrix independently of record isolation.
- Privileged operational access is explicit, narrow, and auditable.

### Measurement

- Automated Alpha-versus-Beta negative tests at repository, API, job, export, and download boundaries.
- Database policies tested using the same non-owner role used by the running application.
- Tests confirm that table ownership, superuser access, or a `BYPASSRLS` role is not used by ordinary requests.

PostgreSQL supports default-deny behavior when row security is enabled without an applicable policy, while superusers, `BYPASSRLS` roles, and normally table owners can bypass it. The implementation must account for those exceptions rather than merely enabling RLS. See the [PostgreSQL row-security documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

### Disqualifying conditions

- Tenant isolation depends only on controllers remembering an `org_id` filter.
- The normal application connection bypasses database isolation.
- Background jobs accept a domain ID without explicit organization context.
- Signed downloads remain usable without current authorization.

## QA-02 — Data integrity, provenance, and deletion

### Required behavior

- Imported, derived, overridden, and effective values remain distinguishable.
- Reprocessing is revisioned and preserves active user overrides.
- Exact and probable duplicate decisions are explainable and reversible where specified.
- Derived totals remain consistent after correction, reassignment, deletion, restoration, and reprocessing.
- Raw files are immutable while retained and deletable when their final legitimate reference expires.

### Measurement

- Model tests trace a flight through initial import, override, parser revision, deletion, restoration, and permanent deletion.
- Database constraints cover organization ownership, canonical identity, and valid relationships.
- Deletion tests exercise database rows, object storage, generated artifacts, audit payload, and backup policy.

### Disqualifying conditions

- Reprocessing overwrites effective human corrections silently.
- Application counters become an independent source of truth.
- Raw objects cannot be traced to legitimate references or deletion state.

## QA-03 — Async work and parser isolation

### Required behavior

- Upload requests return before parsing and expose durable progress.
- Jobs are retryable and idempotent at the domain boundary.
- A poison file cannot stop the queue or another file.
- Parser execution has explicit time, memory, filesystem, credential, and network boundaries.
- External key retrieval is distinguishable from controlled parse work.

### Measurement

- Kill, timeout, retry, duplicate-delivery, and corrupt-input tests.
- Queue recovery after worker termination.
- Demonstration that parser code cannot access broad organization credentials.

### Disqualifying conditions

- Parsing runs in the web request process.
- Queue delivery semantics are treated as a substitute for idempotent handlers.
- Parser code receives the main application database or object-storage credentials.

## QA-04 — Public API contract

### Required behavior

- Core domain behavior is available under `/api/v1/`.
- The web application uses the same API operations.
- Request and response validation have one code-owned schema source.
- The API publishes generated documentation and uses consistent problem details.
- Breaking changes require an explicit version transition.

### Measurement

- Contract tests execute against the running API.
- CI detects route/schema/documentation drift.
- A UI feature review can identify its public API operation.

Fastify supports JSON Schema validation/serialization and TypeScript type providers, and its ecosystem includes dynamic OpenAPI generation. These capabilities make it a strong candidate, but OpenAPI 3.1 output and schema fidelity must be verified in the walking skeleton. See [Fastify validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), [Fastify TypeScript support](https://fastify.dev/docs/latest/Reference/TypeScript/), and the [Fastify ecosystem](https://fastify.dev/docs/latest/Guides/Ecosystem/).

### Disqualifying conditions

- Core UI mutations use private database or server-action paths unavailable to integrations.
- API documentation is manually maintained separately from validation schemas.

## QA-05 — Telemetry access and lifecycle

### Required behavior

- Default replay is responsive with extrema-preserving downsampling.
- Bounded full telemetry retrieval supports export and investigation.
- Missing samples and capability gaps remain explicit.
- One flight and one organization can be deleted predictably.
- Old telemetry remains readable after additive capability evolution.

### Measurement

- Reproducible Local, Beta, and Benchmark profile tests.
- Ingest, replay-window, downsample, export, single-flight deletion, and organization-deletion measurements.
- Storage, backup, and egress cost model with stated assumptions.

### Disqualifying conditions

- Storage choice is accepted without the Benchmark profile.
- Downsampling can omit extrema or gaps used to interpret warnings and summaries.
- Customer deletion requires an unbounded manual data-repair process.

## QA-06 — Delivery speed and maintainability

### Required behavior

- One command starts the local application and dependencies from a clean checkout after documented prerequisites.
- Shared domain contracts do not require copy/paste between web, API, and worker.
- Boundaries are explicit enough to test without deploying every component.
- Schema changes, generated clients, and migrations are reproducible in CI.

### Measurement

- Clean-machine onboarding exercise.
- Time from contract change to passing API/UI tests.
- Dependency graph and build-cache checks in the monorepo.

### Disqualifying conditions

- Two language ecosystems are introduced without evidence that the parser requires them.
- Local development depends on production credentials or cloud-only services.
- Framework magic creates an undocumented private domain path.

## QA-07 — Operability and recovery

### Required behavior

- Structured logs correlate request, organization, import item, processing attempt, and job without logging sensitive telemetry or coordinates.
- Metrics expose queue age, processing duration, outcome class, retry count, and storage failures.
- Deployments support health checks, graceful shutdown, rollback, and migration safety.
- Backups have a tested restore path and deletion policy.

### Measurement

- Worker termination and recovery exercise.
- Failed migration and rollback rehearsal in non-production.
- Restore drill using non-sensitive generated data.

### Initial internal objectives

- Beta recovery-time objective: four hours.
- Beta recovery-point objective: 24 hours or better.

These are engineering baselines, not external SLAs, and must be revisited before production commitments.

## QA-08 — Deployment portability

### Required behavior

- Web, API, and worker can run as ordinary OCI containers.
- PostgreSQL and S3-compatible object APIs are used behind application-owned adapters where provider differences matter.
- Local substitutes exist for database, object storage, and email capture.
- Provider-specific deployment configuration does not leak into the domain model.

Next.js documents Node.js and Docker self-hosting, including operational considerations for reverse proxies and multi-instance caches. Drone.Works should initially avoid application behavior that depends on provider-specific Next.js caching. See the [Next.js self-hosting guide](https://nextjs.org/docs/app/guides/self-hosting).

### Disqualifying conditions

- Core processing requires a proprietary function runtime that cannot enforce parser resource boundaries.
- Moving providers requires rewriting domain behavior or customer data formats.

## QA-09 — Early operating cost

### Required behavior

- Development and beta environments have monthly budgets and alerts.
- Cost estimates separate compute, database, object storage, backup, egress, maps, email, and external key requests.
- Telemetry retention and replay costs are modeled using measured bytes, not raw frame count alone.

### Measurement

- Cost envelope for idle development, active beta, and Benchmark profile.
- Sensitivity analysis identifies the three largest cost variables.

### Disqualifying conditions

- The baseline requires always-on enterprise infrastructure before beta evidence.
- A free tier is treated as a durable cost model.

## Reconfirm before external spend or customer commitments

The Phase 0 scorecard and D-014 use the assumptions above. Before provisioning paid production resources or making customer commitments, reconfirm:

1. Preferred or prohibited cloud providers.
2. Whether UAE data residency is a near-term sales requirement.
3. Comfortable monthly infrastructure budget for development and private beta.
4. Preferred sign-in methods for pilots: email/password, magic link, Google/Microsoft, or a subset.
5. Current TypeScript, React, Python, database, and infrastructure experience.
