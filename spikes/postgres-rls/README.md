# PostgreSQL organization-isolation spike

This disposable Phase 0 spike proves the first relational slice of P0-05 against the generic canonical ownership model. It uses a real native PostgreSQL 18 server, forced row-level security, a non-owner application role, an actual `pg` connection pool, and a pinned pg-boss queue. It does not use Docker or the Homebrew service cluster.

The schema deliberately stays small: organizations, memberships, pilot profiles, aircraft, canonical flights, immutable flight revisions, telemetry samples, raw sources, export artifacts, their flight-scope links, flight-assignment overrides, API idempotency state, and audit events. Every customer-owned child carries `organization_id`; composite foreign keys prevent a resource in one organization from referencing a parent in another.

## Install

Install PostgreSQL 18 natively and make its server binaries available at one of these locations:

- `POSTGRES_BIN=/path/to/postgresql/bin`;
- `/opt/homebrew/opt/postgresql@18/bin`; or
- `/usr/local/opt/postgresql@18/bin`.

Then install the pinned Node dependency:

```sh
cd spikes/postgres-rls
npm ci --ignore-scripts
```

## Test

```sh
npm test
```

The test runner creates a fresh temporary cluster with local socket-only trust authentication, applies the bootstrap-reviewed baseline, seeds synthetic Alpha/Beta data, then applies a checksum-pinned follow-up migration through the non-inheriting migration login. It runs the integration suite, stops the server, and removes the cluster. PostgreSQL may require the command to run outside a restrictive outer sandbox because it allocates local shared memory.

The tests prove:

- the ordinary application connection is neither owner, superuser, nor `BYPASSRLS`;
- application and queue identities cannot assume the no-login migration owner;
- the migration login has no inherited customer access and may explicitly assume only the schema owner for reviewed SQL;
- a separate no-login audit owner protects the append-only migration ledger from both the runner and schema owner;
- exact checksums, migration-ID conflicts, equivalent replay, serialized application, and recorded session identity are enforced;
- a reviewed index migration leaves the digest of customer-table owners, grants, policies, RLS, and `FORCE RLS` unchanged;
- all fourteen customer-owned tables enable and force row-level security;
- absent organization context returns no rows and rejects writes;
- Alpha/Beta direct-ID reads, joins, aggregates, exports, and mutations remain isolated;
- composite foreign keys reject cross-organization pilot/aircraft relationships;
- transaction-local context is cleared before the same pooled backend is reused;
- raw-source/export keys are derived from authorized rows, never client input;
- viewer, cross-organization, deleted, expired, missing, and revoked downloads fail uniformly without calling the signer;
- download lifetime is bounded and a removed admin cannot refresh an expired link;
- a background lookup rejects jobs without both organization and flight IDs; and
- a dedicated non-superuser queue role durably stores only versioned organization/domain references;
- enqueue and execution both reject ID-only or unexpected job payload fields;
- an Alpha job remains Alpha-scoped through a real failed attempt and retry on a one-connection application pool;
- a Beta-scoped job carrying an Alpha flight ID completes as `not_found` without invoking the domain handler; and
- real `/api/v1/` loopback requests allow every member role to view flights but uniformly hide cross-organization exact IDs;
- owner/admin, viewer denial, pilot-own-flight, mixed-pilot, and organization-disabled pilot download behavior execute without accepting route-supplied user IDs; and
- owner/admin/pilot manual creation requires complete fields and an idempotency key; equivalent replay returns the original result without duplicate data;
- note editing, reassignment, soft deletion, and restoration enforce the role matrix, update derived totals, and uniformly hide cross-organization IDs;
- reassignment preserves imported pilot/aircraft values and records the effective user correction in a separate organization-owned override row;
- restoration is limited to fewer than 30 days and every successful mutation creates an RLS-protected, payload-redacted audit event; and
- forced RLS still applies after explicitly assuming the migration-owner role.

The repository wrapper opens a transaction and sets `app.organization_id` with transaction-local `set_config(..., true)` before exposing repositories. Repository queries intentionally omit redundant organization predicates so the executable evidence demonstrates database enforcement. Application membership and role authorization must independently validate the selected organization before calling this trusted boundary; RLS does not replace authorization.

The queue proof uses pg-boss's real PostgreSQL persistence and retry state, while all domain loading remains on the ordinary RLS application pool. Queue ownership does not grant access to customer tables, and the durable payload is restricted to `schemaVersion`, `organizationId`, and `flightId`; private parser material stays outside the queue. The handler remains responsible for idempotent domain effects because retries are intentionally observable.

The API proof uses Node's loopback HTTP server and an injected synthetic session-identity adapter so authorization remains independent of the unresolved web-session provider and Fastify shortlist. It emits snake-case JSON success documents and RFC 9457 problem details. The download proof still uses an injected deterministic signer rather than a storage vendor.

The spike does not yet prove the complete API administration/resource matrix, real provider-side URL expiry and object deletion, Drizzle generation, production credential delivery and external audit retention, permanent deletion, organization deletion, or queue behavior under worker termination. Those remain P0-05/P0-07 follow-ups documented in [`../../docs/architecture/TENANCY.md`](../../docs/architecture/TENANCY.md).
