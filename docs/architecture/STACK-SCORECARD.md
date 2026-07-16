# Provisional stack scorecard

Status: proposed stack with accepted telemetry layout
Last updated: 2026-07-16

## Recommendation

Use a modular TypeScript monorepo with separate deployable web, API, and worker processes:

```text
apps/web       Next.js web client
apps/api       Fastify public REST API
apps/worker    Node.js background jobs and parser supervisor

packages/contracts   JSON Schema/TypeBox API contracts
packages/domain      Framework-independent domain rules
packages/database    PostgreSQL schema, migrations, RLS, and repositories
packages/telemetry   Normalized telemetry types and algorithms
packages/testing     Fixtures, builders, and isolation helpers
```

Provisional supporting choices:

| Concern | Provisional choice | Status |
|---|---|---|
| Language/runtime | TypeScript on a supported Node.js LTS | Recommended; pin exact versions at bootstrap |
| Package workspace | pnpm workspaces | Recommended |
| Web | Next.js App Router | Recommended |
| Public API | Fastify with JSON Schema/TypeBox contracts | Recommended; prove OpenAPI 3.1 fidelity |
| Worker | Separate Node.js process | Recommended |
| Primary database | PostgreSQL with PostGIS available | Recommended |
| Tenant enforcement | PostgreSQL RLS plus organization-required repositories | Recommended; requires executable proof |
| Database access | Drizzle plus reviewed SQL for RLS/migrations | Provisional |
| Background queue | pg-boss using PostgreSQL | Provisional; benchmark and fault-test |
| Authentication | Better Auth core with PostgreSQL; app-owned organizations | Selected under D-013; real-package integration gates remain in Phase 1A |
| Raw object storage | S3-compatible API | Recommended; provider undecided |
| Maps | MapLibre GL JS | Recommended; tile provider undecided |
| Charts | ECharts | Provisional UI choice, not architecture-blocking |
| Observability | OpenTelemetry-compatible tracing/metrics and structured logs | Recommended; vendor undecided |
| Tests | Vitest, API integration tests, Playwright, and containerized dependency tests | Recommended |
| Local environment | Native Node tooling plus Docker Compose dependencies | Recommended |
| Deployment | OCI containers with managed PostgreSQL and object storage | Recommended; provider undecided |
| Telemetry layout | Versioned per-flight columnar objects with PostgreSQL metadata | Accepted under D-008; production codec still must pass reference tests |
| DJI parser/runtime | Evaluate in P0-03 | Deliberately undecided under D-009 |

## Why this direction

- One primary language minimizes context switching across the web, API, worker, contracts, and tests.
- Separate processes preserve API completeness and keep parser failure outside the web runtime.
- PostgreSQL offers database-enforced row security, transactions, relational integrity, geospatial extension options, and a path to a PostgreSQL-native queue.
- Container boundaries preserve deployment choice and make worker resource limits explicit.
- The architecture can begin as three small processes without prematurely introducing Kubernetes, Redis, or microservice-specific infrastructure.

This is a modular monolith at the domain and repository level, not a distributed microservice program. Web, API, and worker may deploy separately while sharing versioned packages and one primary database.

## Scoring method

Candidates receive 1–5 for each quality attribute:

- **5:** strong native fit with limited proof remaining;
- **4:** good fit with a known implementation burden;
- **3:** viable but has material tradeoffs;
- **2:** weak fit requiring compensating architecture;
- **1:** conflicts with the product direction;
- **U:** materially unknown; no total should be trusted until resolved.

Weighted total = sum of `(score ÷ 5) × weight`. A disqualifying condition overrides the total.

## Architecture candidates

### A — Modular TypeScript services

Next.js web, Fastify API, separate Node worker, PostgreSQL/RLS, and S3-compatible object storage.

### B — Next.js-centered full-stack application

Next.js handles most UI and domain/API work, with a separate worker added for parsing.

### C — TypeScript web plus Python API/worker

Next.js web with FastAPI and Python workers, sharing PostgreSQL and object storage.

### D — Backend-as-a-service centered

Next.js with a hosted PostgreSQL/auth/storage platform and provider-native functions, plus an external parser worker where required.

## Weighted comparison

| Attribute | Weight | A | B | C | D |
|---|---:|---:|---:|---:|---:|
| Organization isolation and authorization | 20 | 5 | 4 | 5 | 5 |
| Data integrity, provenance, and deletion | 15 | 5 | 4 | 4 | 4 |
| Async work and parser isolation | 15 | 4 | 3 | 4 | 2 |
| Public API contract | 10 | 5 | 3 | 5 | 3 |
| Telemetry access and lifecycle | 10 | 4 | 4 | 4 | 3 |
| Delivery speed and maintainability | 10 | 4 | 5 | 2 | 5 |
| Operability and recovery | 8 | 4 | 4 | 3 | 4 |
| Deployment portability | 7 | 5 | 4 | 5 | 2 |
| Early operating cost | 5 | 4 | 4 | 3 | 4 |
| **Provisional weighted total** | **100** | **90.4** | **77.0** | **80.8** | **73.2** |

These scores compare architecture shapes, not named hosting vendors. D-008's full-profile benchmark now accepts versioned per-flight columnar objects with PostgreSQL metadata; provider-inclusive latency and deletion remain later provider gates. If later parser or provider evidence crosses D-008's explicit thresholds, affected cells become `U` and the total is recalculated.

## Candidate analysis

### A — Modular TypeScript services: recommended

Strengths:

- Clear public API boundary from the first vertical slice.
- Shared TypeScript contracts without allowing the web application to bypass the API.
- Parser work is naturally supervised by a separate worker process.
- PostgreSQL transactions can coordinate domain changes and job creation.
- Containers run on many managed platforms or a conventional cloud.

Costs and risks:

- Three process types require slightly more initial setup than a Next.js-only application.
- Shared-package boundaries need linting and review to prevent circular coupling.
- Fastify schema tooling must prove the desired generated OpenAPI contract.
- Node is recommended only if P0-03 confirms the selected parser can be isolated effectively.

### B — Next.js-centered: fast but boundary risk

Strengths:

- Fastest route to an initial authenticated interface.
- One framework handles rendering and many web concerns.
- Straightforward deployment on several platforms.

Costs and risks:

- Server actions and private route handlers create a persistent temptation to bypass `/api/v1/`.
- Long-running or hostile parser work still requires another worker architecture.
- Framework cache and multi-instance behavior add concerns unrelated to the core product when self-hosted.

This candidate is rejected as the default architecture, though Next.js remains the recommended web layer.

### C — TypeScript plus Python: capable but premature

Strengths:

- Strong option if ArduPilot/PX4 parsing or scientific telemetry libraries become central later.
- FastAPI provides a productive typed API environment.
- Python subprocess isolation patterns are well understood.

Costs and risks:

- Two type systems, dependency systems, contract generators, build pipelines, and observability stacks for a very small team.
- The Phase 1A DJI path has not demonstrated a Python requirement.

Keep Python as an isolated parser-sidecar option if P0-03 evidence requires it. Do not make it the default API language preemptively.

### D — Backend-as-a-service centered: useful components, weak system boundary

Strengths:

- Quick database, authentication, storage, and preview setup.
- Hosted PostgreSQL offerings may expose RLS directly.
- Low initial operational burden.

Costs and risks:

- Provider functions are a poor default boundary for resource-limited parser processes.
- Product behavior may become split between database policies, provider functions, Next.js paths, and the public API.
- Portability and deletion verification depend more heavily on provider behavior.

Managed PostgreSQL, auth, or object storage can still be selected individually. The rejection is of making a backend-as-a-service product surface the application architecture.

## Component rationale and proof obligations

### Next.js web

Next.js supports self-hosting as a Node.js server or Docker container. Its documentation also identifies reverse-proxy and multi-instance cache responsibilities. Drone.Works should use it as the UI layer, keep customer domain writes in the public API, and initially avoid relying on distributed framework caching. See the [official self-hosting guide](https://nextjs.org/docs/app/guides/self-hosting).

Proof obligations:

- Authenticated cookie/session forwarding to the API.
- No domain server action bypasses `/api/v1/`.
- A single built container can receive environment-specific runtime configuration safely.

### Fastify API and TypeBox contracts

Fastify supports schema-based validation and serialization, TypeScript type providers, and dynamic OpenAPI generation through its official ecosystem. See [validation and serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), [TypeScript](https://fastify.dev/docs/latest/Reference/TypeScript/), and [ecosystem plugins](https://fastify.dev/docs/latest/Guides/Ecosystem/).

Proof obligations:

- Generate the required OpenAPI representation from route schemas.
- Confirm RFC 9457 problem details and response schemas appear correctly.
- Generate or consume a typed web client without creating a second contract source.
- Detect undocumented routes in CI.

### PostgreSQL, PostGIS, and RLS

PostgreSQL row security can provide default-deny row access when enabled and no policy permits access. It also has explicit bypass cases for privileged roles and table owners that must be controlled. See [PostgreSQL row-security policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

PostGIS is made available for geospatial indexing or queries but should not be required for simple Phase 1A track display.

Proof obligations:

- Application connections use a non-owner, non-`BYPASSRLS` role.
- `FORCE ROW LEVEL SECURITY` and migration ownership are tested where appropriate.
- Organization context is transaction-safe with pooled connections.
- Jobs and exports fail closed without organization context.

### Drizzle

Drizzle documents PostgreSQL RLS schema support, which may help keep policies near migrations while retaining direct SQL escape hatches. See [Drizzle RLS documentation](https://orm.drizzle.team/docs/rls).

Proof obligations:

- RLS policies and grants are visible and reviewable in generated migrations.
- Per-transaction organization context cannot leak through the connection pool.
- Complex telemetry/export queries remain maintainable.
- Schema diff tooling does not remove hand-reviewed security objects unexpectedly.

If the proof fails, use a more SQL-first migration/query layer; PostgreSQL is the decision, not Drizzle.

### pg-boss

pg-boss uses PostgreSQL for background jobs and documents retries, scheduling, dead-letter behavior, transactional job creation, and Drizzle transaction adapters. See the [pg-boss repository](https://github.com/timgit/pg-boss).

Proof obligations:

- Domain handlers remain idempotent even if infrastructure claims exactly-once delivery.
- Worker termination, retry, cancellation, and queue-age monitoring behave as required.
- Queue tables and administrative access do not weaken organization isolation.
- Parser execution occurs in a constrained child/container boundary, not inside the queue handler process itself.

If job volume or isolation requirements outgrow PostgreSQL, the queue boundary should allow replacement without changing domain behavior.

### Authentication

Better Auth provides self-hosted identity and sessions with a PostgreSQL adapter. Its organization plugin was evaluated alongside Clerk Organizations, but Drone.Works keeps invitations, memberships, and roles in the canonical domain so there is only one authorization source. See the [authentication evaluation](../research/AUTHENTICATION-EVALUATION.md) and D-013.

The provider-neutral adapter passes the native organization-isolation suite: it emits only session and user identifiers, ignores provider organization/role claims, and honors immediate revocation. The selected package is integrated only during Phase 1A bootstrap so its migration and complete lockfile can be reviewed in the actual monorepo.

Proof obligations:

- Pin `better-auth@1.6.23` and review the complete dependency lock and generated migration during bootstrap.
- Pass real-package registration, verification, recovery, linking, invitation, revocation, and deletion tests.
- Verify hosted cookie, CSRF/origin, redirect, rate-limit, and email delivery controls.
- Keep pilot profiles separate and retain database membership/RLS as the authorization source.

### MapLibre GL JS

MapLibre GL JS is an open TypeScript/WebGL map renderer that accepts vector-tile styles. It does not itself supply production map tiles; the tile/style provider remains a separate decision. See the [MapLibre GL JS documentation](https://maplibre.org/maplibre-gl-js/docs/).

Proof obligations:

- Render a representative GeoJSON flight track and synchronized marker smoothly.
- Verify CSP/worker configuration and attribution requirements.
- Avoid sending private tracks to a tile provider; basemap requests must not contain the customer route.

## Decisions intentionally not made

- Cloud or regional deployment provider.
- Managed PostgreSQL vendor.
- Object-storage vendor.
- Transactional email provider.
- Map tile and geocoding provider.
- Exact production telemetry container codec behind D-008's accepted object layout.
- DJI parser library and encrypted-key strategy.
- Final authentication provider.
- Billing provider.

These are evidence-bearing decisions in later Phase 0 workstreams. Selecting them now would make the scorecard look complete without retiring the actual risk.

## Recommended bootstrap only after validation gates

Once the owner assumptions are confirmed and P0-02/P0-03 begin, the Phase 1A repository may be scaffolded with:

```text
apps/
  web/
  api/
  worker/
packages/
  contracts/
  database/
  domain/
  telemetry/
  testing/
```

Do not install the entire future stack immediately. Add dependencies in the vertical slice that proves them, pin versions in the lockfile, and record any material departure from this scorecard in the decision log.
