# Organization isolation

Status: draft Phase 0 proof
Last updated: 2026-07-16

## Purpose

P0-05 must make cross-organization access difficult to express and easy to test. The first executable slice translates the generic ownership and identity rules from [`DOMAIN-MODEL.md`](DOMAIN-MODEL.md) into PostgreSQL constraints, forced row-level security (RLS), and an organization-required repository boundary.

The native PostgreSQL spike lives in [`../../spikes/postgres-rls/`](../../spikes/postgres-rls/). It validates PostgreSQL as a viable relational isolation mechanism and exercises pg-boss as the provisional real-queue candidate without yet accepting D-002 or selecting Drizzle, pg-boss, a database host, or a production administration model.

## Relational ownership slice

The proof includes the smallest connected resource graph needed to exercise the canonical model:

```mermaid
erDiagram
    ORGANIZATION ||--o{ MEMBERSHIP : owns
    ORGANIZATION ||--o{ PILOT_PROFILE : owns
    ORGANIZATION ||--o{ AIRCRAFT : owns
    ORGANIZATION ||--o{ TAG : owns
    ORGANIZATION ||--o{ BATTERY : owns
    PILOT_PROFILE ||--o{ CANONICAL_FLIGHT : assigned_to
    AIRCRAFT ||--o{ CANONICAL_FLIGHT : operated_with
    TAG }o--o{ CANONICAL_FLIGHT : classifies
    BATTERY }o--o{ CANONICAL_FLIGHT : powered
    CANONICAL_FLIGHT ||--o{ FLIGHT_REVISION : revised_as
    FLIGHT_REVISION ||--o{ TELEMETRY_SAMPLE : contains
    ORGANIZATION ||--o{ RAW_SOURCE : owns
    ORGANIZATION ||--o{ EXPORT_ARTIFACT : owns
    RAW_SOURCE }o--o{ CANONICAL_FLIGHT : contains
    EXPORT_ARTIFACT }o--o{ CANONICAL_FLIGHT : includes
    ORGANIZATION ||--o{ IMPORT_BATCH : owns
    IMPORT_BATCH ||--|{ IMPORT_ITEM : contains
    RAW_SOURCE o|--o{ IMPORT_ITEM : retained_as
```

Every child has a non-null `organization_id`. Parent keys and foreign keys include that organization identifier, so a Beta flight cannot reference an Alpha pilot, aircraft, battery, tag, import batch, raw source, revision, or telemetry parent even if an application mutation supplies exact resource IDs. Raw-source and export-artifact references are also organization-owned RLS rows; their physical object keys are derived only after authorization and are not accepted as client input. Imported and user-added flight tag/battery links retain distinct origins. This relational slice persists generic flight facts and capability names; source-specific parser structures remain outside it.

The full canonical schema still validates provenance, effective facts, sample counts, and fingerprint integrity before persistence. This spike does not duplicate that complete validator as database constraints.

## Roles and RLS

The migration defines five deliberately separate roles:

| Role | Use | Relevant properties |
|---|---|---|
| `droneworks_migrator` | Owns the schema and tables | `NOLOGIN`, `NOINHERIT`, non-superuser, `NOBYPASSRLS` |
| `droneworks_migration_runner` | Applies checksum-pinned reviewed migrations | login, `NOINHERIT`, non-superuser, `NOBYPASSRLS`; may explicitly `SET ROLE` only to `droneworks_migrator` |
| `droneworks_migration_auditor` | Owns the operational migration ledger and its narrow functions | `NOLOGIN`, `NOINHERIT`, non-superuser, `NOBYPASSRLS`; no membership granted to the runner or schema owner |
| `droneworks_app` | Ordinary repository, job, and export access | login, `NOINHERIT`, non-owner, non-superuser, `NOBYPASSRLS` |
| `droneworks_queue` | Owns only the pg-boss infrastructure schema | login, `NOINHERIT`, non-superuser, `NOBYPASSRLS`; no customer-table grants |

Every customer-owned table enables RLS and uses `FORCE ROW LEVEL SECURITY`, including the organization root. One policy permits a row only when its organization matches the transaction's `app.organization_id`; missing or empty context resolves to no organization and therefore no rows. The same expression is used for `USING` and `WITH CHECK`, so writes cannot move or create rows outside the selected organization.

The bootstrap superuser exists only inside the temporary test cluster to create roles, apply the baseline, seed synthetic evidence, and assert the explicit bypass case. It is not an ordinary application or proposed production maintenance path.

## Privileged migration boundary

The candidate deployment path has no login for the customer-schema owner. A non-inheriting migration runner can assume that owner only inside the transaction that applies an exact repository migration whose SHA-256 digest is pinned in code. A transaction advisory lock serializes migration attempts. The same transaction records the migration ID, digest, time, session identity, and application name; equivalent replay is a no-op, changed bytes fail checksum validation, and reuse of an applied ID with another reviewed digest fails as a conflict.

The operational ledger lives outside the customer schema and is owned by a separate no-login audit role. The runner has execute access only to security-definer read/append functions and has no direct table privileges. The migrator cannot read or rewrite the ledger, and the runner cannot assume the audit owner. Application and queue roles cannot assume the migrator or access the operational schema. This is operational metadata only: migration IDs and digests must never contain organization or customer payload.

The runner snapshots a deterministic customer-isolation contract around every reviewed migration. The contract covers every customer table's owner, grants, RLS and `FORCE RLS` flags, and policy expressions. The audit-index and organization-administration migrations are checksum-pinned, ledger-recorded, and leave the isolation-contract digest unchanged. The next reviewed migration explicitly expands the contract by exactly six declared tables for tags, batteries, their flight links, import batches, and import items; the runner rejects changes to existing table isolation, unexpected added tables, or any added table without migrator ownership plus enabled and forced RLS. In this candidate model, routine privileged maintenance must ship as a reviewed migration; there is no separate standing ad-hoc DML role. Production credential delivery, CI identity, externally retained database audit logs, and emergency procedure remain deployment/operations decisions rather than authority granted to ordinary processes.

## Pooled-connection contract

Organization context is always transaction-local:

```text
pool.connect()
  -> BEGIN
  -> set_config('app.organization_id', authorizedOrganizationId, true)
  -> repository queries
  -> COMMIT or ROLLBACK
  -> release connection
```

The third argument to `set_config` makes the setting local to the transaction. The executable pool test fixes the pool at one connection, records its backend PID, runs Alpha, releases the connection, proves a contextless read on the same PID returns zero rows, and then proves Beta sees only Beta data on that same PID.

Repository methods do not accept an optional organization filter. They can run only inside `withOrganization()`, which rejects missing/invalid context before acquiring a client. Background job enqueue and execution both require the exact versioned payload `{ schemaVersion, organizationId, flightId }`; a flight ID alone or additional private material is invalid. The queue role owns only pg-boss infrastructure, while the worker resolves domain rows through the ordinary RLS application pool. The organization passed here must already have been authorized by the application membership/role layer.

## Executable evidence

The integration suite currently proves, with synthetic Alpha and Beta records:

- ordinary-role attributes and table ownership;
- explicit reviewed-migration elevation, independent ledger ownership, checksum/replay controls, and declared isolation-contract preservation or expansion;
- RLS enabled and forced on all twenty tables;
- missing-context read and write denial;
- direct-ID, join, aggregate, export, and mutation isolation;
- cross-organization relationship rejection through composite foreign keys;
- transaction-safe reuse of the same pooled backend;
- fail-closed job lookup, durable payload validation before enqueue and execution, and real queue retry isolation;
- versioned HTTP flight reads and download issuance with membership, role, pilot ownership, and organization-policy checks;
- versioned flight creation and mutation with idempotency, audit redaction, reversible deletion, role checks, and uniform IDOR denial;
- versioned organization administration with owner/admin member and settings operations, owner-only ownership transfer and deletion requests, historical pilot retention, and uniform IDOR denial;
- versioned tag, battery, and upload/import operations with pilot-own versus manager roles, idempotency, payload-redacted audits, uploader scope, composite ownership, and uniform IDOR denial;
- imported pilot/aircraft assignments retained as a separate baseline while an organization-owned override row supplies the effective reassignment;
- organization-derived raw-source/export keys, bounded link lifetime, uniform denial, and membership-revocation checks; and
- forced RLS behavior for the table owner, alongside explicit superuser bypass evidence.

Run it with native PostgreSQL 18:

```sh
npm --prefix spikes/postgres-rls test
```

The runner creates and destroys an ephemeral socket-only cluster. It does not start a persistent service or use Docker.

## Background queue boundary

The pg-boss proof keeps queue infrastructure and customer data permissions separate. A dedicated `droneworks_queue` role owns only the `droneworks_jobs` schema. Durable flight-refresh jobs contain only a payload version, organization ID, and flight ID; raw sources, coordinates, parser results, cached secrets, and user authorization material are rejected as unexpected fields.

The test fails an Alpha job once, lets pg-boss place the same job into retry state, and then succeeds it. Both attempts load only Alpha through the one-connection RLS pool. A Beta-scoped job containing the Alpha flight ID completes with `not_found` and never reaches the domain handler. A malformed ID-only job inserted by bypassing the enqueue adapter is rejected again during execution and reaches terminal failed state. This proves the organization contract survives durable storage, connection reuse, and retry; it does not imply exactly-once domain effects, so handlers must remain idempotent.

## Versioned API authorization boundary

The proof exposes real loopback HTTP operations under `/api/v1/` while keeping authentication behind an injected identity adapter. The harness therefore tests API authorization independently of the unresolved Phase 1 session provider and does not select a web framework. Client input cannot supply a user ID; only the authenticated identity reaches the membership query.

All four Phase 1 roles may view active flights in their selected organization. Owner and admin identities may download organization raw-source and export artifacts. Pilot identities may download an artifact only when organization policy permits it and every flight linked to that artifact is assigned to the membership's linked pilot profile; a mixed-pilot raw source or export is denied in full. Viewers cannot download either type. Missing membership, insufficient role, another pilot's artifact, mixed ownership, disabled pilot policy, cross-organization exact IDs, and unknown IDs return the same RFC 9457 `404` problem without signer access.

The mutation slice requires complete manual-flight timing, timezone, duration, and location-text fields and persists no invented telemetry or raw source. Owner, admin, and pilot roles may create; viewers may not. Creation requires an idempotency key scoped to organization, authenticated user, and operation. Equivalent replay returns the original `201` result without a second flight or audit event, while different input under the same key returns `409`.

Owner/admin may edit notes, reassign assets, delete, and restore; pilots may edit notes only while the flight is assigned to their linked pilot profile; viewers cannot mutate. Reassignment is constrained to organization-visible pilot and aircraft rows. Soft deletion preserves the prior active/review state and excludes the flight from lists and derived totals. Restore succeeds only when fewer than 30 days have elapsed. Every successful mutation writes an organization-owned audit event with actor, action, time, resource, and changed field names; note content and other customer payload are not copied into audit metadata.

The administration slice exposes manager-only membership listing and idempotent `PUT`/delete operations plus partial organization-settings updates. Owner/admin identities may manage non-owner memberships and settings; pilots, viewers, missing members, and cross-organization identities receive the same not-found response. The ordinary member endpoint cannot grant, demote, or remove an owner. Removing a linked member clears only the pilot profile's login link and preserves the historical pilot and flights.

Ownership transfer is a separate owner-only transaction: it locks both memberships, demotes the current owner, promotes an existing organization member, and relies on a partial unique index to prevent two owners. Organization deletion is likewise owner-only and records a reversible `pending_deletion` request timestamp; cancellation restores `active` state. Repeated equivalent requests do not create duplicate audit events. Administration audits retain action/resource/changed-field information but omit organization setting values.

All members may list organization tag and battery definitions. Owners/admins may update battery records and add or remove user-origin battery links on active flights; imported battery links remain immutable through that endpoint. Owners/admins may likewise add or remove user-origin flight tags, while a pilot may do so only for a flight currently assigned to the membership's linked pilot profile. Viewers cannot mutate either resource. Exact IDs from another organization, missing membership, wrong role, and unknown IDs return the same not-found response.

Owner, admin, and pilot identities may create an upload/import batch with one item per declared file; viewers may not. Creation requires organization/user/operation-scoped idempotency, validates bounded unique client file IDs, and stores no client-supplied object key. Equivalent replay returns the original batch and items without duplicate rows or audits. Owners/admins may read any organization batch; a pilot may read only a batch they uploaded. Audit metadata records only the item count, not filenames. The proof stops at durable `uploaded` records and does not claim object transfer, detection, parsing, retry, or review-state transitions.

## Object and download boundary

Object paths are derived only after an organization-owned database row is authorized. The executable shape is:

```text
organizations/{organization_id}/raw-sources/{raw_source_id}/revisions/{source_revision_id}
organizations/{organization_id}/exports/{export_id}/{artifact_id}
```

The path is defense-in-depth metadata, not authority. The executable boundary selects the raw-source or export row inside current organization context, joins current membership and organization policy, applies owner/admin or pilot-own-flight scope, derives and escapes every object-key segment from the authorized row, and calls an injected signer with a maximum 15-minute lifetime. Client-supplied object keys are rejected. Missing, cross-organization, viewer, other-pilot, mixed-pilot, disabled-policy, deleted, expired, revoked, and unknown resources return one indistinguishable denial and never invoke the signer.

The authorization query holds a row lock on the membership and artifact until signing completes. The revocation test proves a previously authorized one-second link expires and that the removed admin cannot mint a replacement. The signer is deliberately a deterministic test adapter: real object-storage URL expiry, provider-side object access, deletion, and revocation still require production-shaped evidence.

## Remaining P0-05 proof obligations

- Extend the API role matrix across complete organization export and permanent organization deletion.
- Exercise worker termination, cancellation, queue-age observability, and idempotent domain mutation under retry before accepting pg-boss.
- Exercise object-key derivation, URL expiry, membership revocation, and deletion against real object-storage artifacts rather than the signer adapter alone.
- Extend isolation tests across cached organization-linked secrets and permanent deletion paths as those schemas become executable.

D-002 remains proposed until the remaining API/resource, non-relational, and deletion obligations above are closed. Production credentials, external audit retention, and emergency operations remain P0-07 deployment proof obligations.
