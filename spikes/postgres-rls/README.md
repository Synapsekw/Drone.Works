# PostgreSQL organization-isolation spike

This disposable Phase 0 spike proves the first relational slice of P0-05 against the generic canonical ownership model. It uses a real native PostgreSQL 18 server, forced row-level security, a non-owner application role, and an actual `pg` connection pool. It does not use Docker or the Homebrew service cluster.

The schema deliberately stays small: organizations, memberships, pilot profiles, aircraft, canonical flights, immutable flight revisions, telemetry samples, raw sources, and export artifacts. Every customer-owned child carries `organization_id`; composite foreign keys prevent a resource in one organization from referencing a parent in another.

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

The test runner creates a fresh temporary cluster with local socket-only trust authentication, applies the reviewed SQL, seeds synthetic Alpha/Beta data, runs the integration suite, stops the server, and removes the cluster. PostgreSQL may require the command to run outside a restrictive outer sandbox because it allocates local shared memory.

The tests prove:

- the ordinary application connection is neither owner, superuser, nor `BYPASSRLS`;
- all nine customer-owned tables enable and force row-level security;
- absent organization context returns no rows and rejects writes;
- Alpha/Beta direct-ID reads, joins, aggregates, exports, and mutations remain isolated;
- composite foreign keys reject cross-organization pilot/aircraft relationships;
- transaction-local context is cleared before the same pooled backend is reused;
- raw-source/export keys are derived from authorized rows, never client input;
- viewer, cross-organization, deleted, expired, missing, and revoked downloads fail uniformly without calling the signer;
- download lifetime is bounded and a removed admin cannot refresh an expired link;
- a background lookup rejects jobs without both organization and flight IDs; and
- forced RLS still applies after explicitly assuming the migration-owner role.

The repository wrapper opens a transaction and sets `app.organization_id` with transaction-local `set_config(..., true)` before exposing repositories. Repository queries intentionally omit redundant organization predicates so the executable evidence demonstrates database enforcement. Application membership and role authorization must independently validate the selected organization before calling this trusted boundary; RLS does not replace authorization.

The download proof uses an injected deterministic signer rather than a storage vendor. The spike does not yet prove the complete API role matrix, an actual job queue, real provider-side URL expiry and object deletion, Drizzle migration generation, privileged maintenance observability, or organization deletion. Those remain P0-05 follow-ups documented in [`../../docs/architecture/TENANCY.md`](../../docs/architecture/TENANCY.md).
