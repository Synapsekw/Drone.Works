# PostgreSQL organization-isolation spike

This disposable Phase 0 spike proves the first relational slice of P0-05 against the generic canonical ownership model. It uses a real native PostgreSQL 18 server, forced row-level security, a non-owner application role, an actual `pg` connection pool, and a pinned pg-boss queue. It does not use Docker or the Homebrew service cluster.

The schema deliberately stays small: organizations, memberships, pilot profiles, aircraft, batteries, tags, canonical flights, flight tag/battery links, immutable flight revisions, telemetry samples, raw sources, upload/import batches and items, organization-export requests, maintenance schedules and completions, export artifacts, their flight-scope links, flight-assignment overrides, API idempotency state, and audit events. Every customer-owned child carries `organization_id`; composite foreign keys prevent a resource in one organization from referencing a parent in another.

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

The test runner creates a fresh temporary cluster with local socket-only trust authentication, applies the bootstrap-reviewed baseline, then applies the ordered checksum-pinned migration set through the non-inheriting migration login before seeding synthetic Alpha/Beta data. It runs the integration suite, stops the server, and removes the cluster. PostgreSQL may require the command to run outside a restrictive outer sandbox because it allocates local shared memory.

The tests prove:

- the ordinary application connection is neither owner, superuser, nor `BYPASSRLS`;
- application and queue identities cannot assume the no-login migration owner;
- the migration login has no inherited customer access and may explicitly assume only the schema owner for reviewed SQL;
- a separate no-login audit owner protects the append-only migration ledger from both the runner and schema owner;
- exact checksums, migration-ID conflicts, equivalent replay, serialized application, and recorded session identity are enforced;
- contract-preserving migrations leave the digest of customer-table owners, grants, policies, RLS, and `FORCE RLS` unchanged; declared expansion migrations add exactly six remaining-resource tables, one export-request table, and two maintenance tables; and declared tightening removes ordinary-app deletion from organization, canonical-flight, and raw-source roots without changing their owners, policies, or forced-RLS state;
- all twenty-three customer-owned tables enable and force row-level security;
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
- owner/admin member and settings operations preserve historical pilot profiles while denying pilot, viewer, and cross-organization access;
- ownership transfer and organization deletion requests are owner-only, preserve a single-owner invariant, remain reversible, and redact setting values from audits; and
- tag edits enforce manager or pilot-own-flight scope while battery mutations remain manager-only, preserve imported links, and redact values from audits;
- upload declarations create idempotent per-file import records for owner/admin/pilot identities, deny viewers, and limit reads to managers or the uploading pilot;
- the six added resource tables return zero rows after context clears on the reused pooled backend, and composite ownership rejects cross-organization tag, battery, and raw-source links; and
- owner/admin complete-export requests freeze an organization-scoped sanitized data snapshot, replay idempotently, deny pilot/viewer/exact cross-organization IDs, and disappear when pooled context clears;
- durable export jobs carry only schema version, organization ID, and export-request ID, then reapply RLS before the handler receives the manifest; and
- complete-export generation freezes sanitized rows for all nineteen manifest collections, emits byte-stable manifest/JSON/flight-CSV/telemetry-CSV content, recovers from one real queue retry, finalizes one derived artifact, and uniformly hides its download from pilots and other organizations;
- maintenance schedules support flight-hour, flight-count, and one-shot-date definitions with manager-only idempotent creation, all-member reads, derived active-flight usage, append-only completions, redacted audits, pooled clearing, and cross-organization composite ownership; and
- a dedicated no-direct-table deletion worker enforces the 30-day organization grace period, rejects early/cancelled/stale references, removes a synthetic row from every one of the twenty-three customer tables, atomically retains one payload-free operational receipt, clears pooled context, and returns the same receipt after a real post-commit queue retry; and
- the same worker permanently removes an expired flight's canonical payload and telemetry, deletes its exclusively linked raw source, preserves a shared source and retained peer, records only a redacted action reference, rejects early/cross-organization/stale jobs, clears pooled context, and returns the same evidence after post-commit retry; and
- forced RLS still applies after explicitly assuming the migration-owner role.

The repository wrapper opens a transaction and sets `app.organization_id` with transaction-local `set_config(..., true)` before exposing repositories. Repository queries intentionally omit redundant organization predicates so the executable evidence demonstrates database enforcement. Application membership and role authorization must independently validate the selected organization before calling this trusted boundary; RLS does not replace authorization.

The queue proof uses pg-boss's real PostgreSQL persistence and retry state, while ordinary domain loading remains on the RLS application pool and permanent deletion uses its separately restricted pool. Queue ownership does not grant access to customer tables. Flight refresh payloads are restricted to `schemaVersion`, `organizationId`, and `flightId`; complete-export payloads substitute `exportRequestId`; deletion payloads substitute the canonical deletion-request timestamp. They never contain snapshots, object keys, or customer payload. Export generation and permanent deletion both prove effect-idempotent retry.

The export generator emits a deterministic logical JSON archive envelope containing `manifest.json`, `data.json`, `flights.csv`, and `telemetry.csv`. It is executable content-format evidence, not a production ZIP/TAR selection. The injected artifact adapter proves digest confirmation, retry, RLS finalization, and derived-key download authorization without claiming provider-side persistence.

The API proof uses Node's loopback HTTP server and an injected synthetic session-identity adapter so authorization remains independent of the unresolved web-session provider and Fastify shortlist. It emits snake-case JSON success documents and RFC 9457 problem details. The download proof still uses an injected deterministic signer rather than a storage vendor.

The spike does not yet prove atomic API-to-queue dispatch, a production archive container, real provider-side URL expiry and object deletion, cached-secret/log/backup deletion and verification, Drizzle generation, production credential delivery and external audit retention, or queue behavior under worker termination. Those remain P0-05/P0-07 follow-ups documented in [`../../docs/architecture/TENANCY.md`](../../docs/architecture/TENANCY.md).
