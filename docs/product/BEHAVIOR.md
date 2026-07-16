# Behavioral Specification — Drone.Works

Status: founding draft
Version: 1.0
Last updated: 2026-07-16

This document defines observable product behavior. Technology choices and internal implementation details belong in `DECISIONS.md`. Acceptance examples for the first release live in `PHASE-1-ACCEPTANCE.md`.

## 1. Tenancy, identity, and authorization

### Organizations and membership

- All customer-owned domain resources belong to exactly one organization.
- A user may belong to multiple organizations and operates in one selected organization at a time.
- Creating an organization generates its identifier on the server, makes the
  creating user its owner, and creates an active pilot profile linked to that
  owner membership.
- Organization boundaries apply to reads, writes, searches, exports, downloads, background jobs, and generated links.
- A user must never infer the existence of another organization's resource from IDs, errors, counts, or timing-sensitive UI behavior.
- An organization has a default timezone and unit preference. A user may override display units and timezone for their own account.

### Pilot profiles

- A pilot profile represents the person who conducted a flight.
- A pilot profile may optionally be linked to a user membership.
- Flights reference pilot profiles, never authentication identities directly.
- Deactivating a pilot prevents new assignment by default but does not alter historical flights.
- A pilot profile linked to a departing member remains in the organization's history.
- Removing a membership takes effect on the next organization operation,
  unlinks but does not delete its pilot profile, and cannot remove or demote the
  organization's last owner.

### Phase 1 role behavior

| Capability                                | Owner | Admin |            Pilot | Viewer |
| ----------------------------------------- | ----: | ----: | ---------------: | -----: |
| View flights and fleet                    |   Yes |   Yes |              Yes |    Yes |
| Create manual flights                     |   Yes |   Yes |              Yes |     No |
| Upload logs                               |   Yes |   Yes |              Yes |     No |
| Edit own assigned flight notes/tags       |   Yes |   Yes |              Yes |     No |
| Reassign pilot or fleet assets            |   Yes |   Yes |               No |     No |
| Manage pilot and fleet records            |   Yes |   Yes |               No |     No |
| Delete/restore flights                    |   Yes |   Yes |               No |     No |
| Export operational data                   |   Yes |   Yes | Own flights only |     No |
| Download raw log files                    |   Yes |   Yes | Own flights only |     No |
| Manage members and organization settings  |   Yes |   Yes |               No |     No |
| Transfer ownership or delete organization |   Yes |    No |               No |     No |

- “Own flights” means flights assigned to the member's linked pilot profile.
- An owner may restrict pilot raw-download and export permissions organization-wide.
- Authorization is checked when an action is performed, not merely when a page is opened or a link is created.
- Permission denials do not reveal whether an out-of-scope resource exists.

## 2. Canonical flight record

### Identity

- One flight represents one operational takeoff-to-landing session.
- An uploaded file is source material and may produce zero, one, or multiple flights depending on the format.
- A manual flight has no telemetry or raw log file.
- Every flight has one pilot profile and one aircraft. It may have zero or more batteries because not every source exposes battery identity.

### Time and location

- The canonical takeoff instant is stored as UTC together with the timezone used to interpret or display the local time.
- If a source does not provide a reliable timezone, the import enters review and shows the assumed organization timezone.
- Correcting a timezone changes the interpreted instant but preserves the original source value in provenance.
- Takeoff coordinates are considered sensitive operational data and follow flight authorization rules.

### Facts, derived values, and corrections

Important flight fields retain provenance:

- `imported`: read directly from source material;
- `derived`: calculated from imported telemetry or other facts;
- `user_override`: deliberately corrected by an authorized user.

- Reprocessing may update imported and derived values but must not silently overwrite a user override.
- A user can remove an override and return a field to the current imported or derived value.
- Changes to pilot, aircraft, batteries, takeoff time, duration, and deletion state create audit events.

### Capabilities

- A flight exposes a machine-readable capabilities list based on the normalized fields actually present.
- Missing telemetry is represented as unavailable, not as zero.
- The UI hides or explains panels that cannot be supported by the source.
- Manual flights have no telemetry capabilities but remain valid operational records.

### Derived totals

- Aircraft, pilot, battery, dashboard, and maintenance totals are derived from active canonical flights.
- Deleted flights do not contribute to totals.
- Reassignment, restoration, and reprocessing update affected totals consistently.
- A displayed total identifies the unit and time basis used.

## 3. Fleet state

### Aircraft

Aircraft state is expressed through separate concepts:

- Lifecycle: `active` or `retired`.
- Airworthiness: `serviceable`, `restricted`, or `grounded`.
- Maintenance condition: derived as `current`, `due_soon`, or `overdue`.
- Assignment eligibility: derived from the preceding states and organization policy.

- Retired or grounded aircraft remain visible in historical flights.
- A user must be told why an aircraft cannot be assigned.
- Maintenance becoming overdue does not rewrite lifecycle or airworthiness. It may make the aircraft ineligible when the organization's policy requires it.

### Batteries

- Battery identity is based on organization-scoped serial number when a reliable serial is present.
- A log without a battery serial may be linked manually or left without an identified battery.
- Multi-battery aircraft may associate several batteries with one flight.
- Battery cycle and health metrics state how they were calculated; estimates are not presented as manufacturer-certified facts.

### Asset reconciliation

An imported identifier results in one of four visible outcomes:

1. Confident match to an existing asset.
2. Creation of a new asset from a reliable identifier.
3. Possible match requiring user confirmation.
4. Unknown asset left unresolved.

- The import result explains the outcome for each aircraft and battery.
- Authorized users can merge duplicate assets later.
- A merge preserves flight history, source identifiers, user overrides, and audit events.
- Automatic creation requires a stable identifier. Model name alone is not sufficient.

## 4. Import behavior

### Phase 1 sources

- Supported DJI TXT variants are listed by application and format version in product documentation and automated fixtures.
- Manual entry requires pilot, aircraft, takeoff time, duration, and either a map location or location text.
- File types are detected from contents rather than extension alone.
- Unsupported, encrypted-without-key, corrupt, and truncated files each produce distinguishable user-facing reasons.
- Raw uploaded files are retained even when parsing fails, subject to organization deletion and the retention rules in Section 9.

### Resource model and lifecycle

- Before bytes are accepted, an authorized owner, admin, or pilot declares the
  original display filename, exact byte size, media type, and SHA-256 digest.
- Phase 1A currently accepts one file of `application/octet-stream` content up
  to 32 MiB through the authenticated API. A client-supplied storage key is
  rejected, and the display filename is reduced to a safe leaf name.
- Raw bytes become a retained source only after the immutable stored object's
  exact version, digest, size, and media type match the declaration. Identical
  retries return the same upload/source; an occupied key with different bytes
  is rejected.
- Every declaration, byte write, completion, and status read rechecks current
  organization membership. No public object URL is returned.
- Upload completion moves the import to `queued` only in the same transaction
  that creates its payload-free durable processing reference. The private queue
  payload contains only a schema version, organization ID, and import item ID.
- Owners and admins, or the pilot who uploaded the item, may read its current
  processing state. They may cancel it while its durable reference is still
  pending; once dispatch has begun, cancellation returns a conflict instead of
  racing a worker. Cross-organization exact identifiers disclose no status.

- A batch upload creates one batch and one import item per file.
- Each file shows independent progress and outcome.
- Import item states are:

  `uploaded → queued → detecting → parsing → normalizing → awaiting_review → completed`

- `failed`, `cancelled`, and `skipped_duplicate` are terminal outcomes.
- A batch summarizes completed, awaiting-review, duplicate, failed, and cancelled items without hiding per-file details.
- Failure of one file never prevents other files in the batch from completing.
- Retrying a failed item creates a new processing attempt under the same import item and preserves earlier attempt history.
- Flight availability is not blocked by optional enrichment work.

### Matching and review

- Aircraft and batteries are matched using reliable source identifiers within the current organization only.
- The uploading member's linked pilot profile is the initial pilot candidate, not an unquestioned fact.
- An import enters review when asset, pilot, timezone, or flight-boundary ambiguity could materially change the record.
- Review shows the source values, proposed result, confidence/reason, and available alternatives.
- A user may resolve several compatible import items in bulk.

### Duplicate handling

- Exact file duplicates are identified by a cryptographic content hash within the organization.
- A normalized flight fingerprint may establish an exact operational duplicate when stable identifiers and timing agree.
- Similar time, route, duration, aircraft, or battery values may flag a probable duplicate but must not discard the candidate automatically.
- Probable duplicates enter review and show the existing flight alongside the candidate.
- Authorized users may keep both records or mark one as a duplicate of the other.
- Duplicate relationships remain reversible and auditable.

### Reprocessing

- Parser improvements may trigger reprocessing from the immutable source file.
- Reprocessing creates a new processing revision and preserves prior revision metadata.
- The user can see whether visible values changed.
- User overrides survive unless the user explicitly removes them.
- Reprocessing must not create a second canonical flight for the same import item.

## 5. Flight experience

### Flight list

- Users can filter by date range, aircraft, battery, pilot, tag, import state, and useful numeric ranges.
- Search and filters combine predictably and can be cleared independently.
- Bulk tagging and assignment report how many records changed and which records could not be changed.
- List results use the viewer's display timezone and units while exports can request canonical SI/UTC values.

### Flight detail and replay

- A telemetry-capable flight shows a 2D track and a shared time cursor across the map and charts.
- Replay supports play, pause, seek, and selectable speed.
- Essential Phase 1 charts are altitude, horizontal/vertical speed, battery state, GPS/satellite count, and signal when supplied by the source.
- Every chart identifies unavailable intervals and source gaps.
- Downsampling preserves the first and last samples and significant extrema needed to understand warnings and summary statistics.
- Users can request the full available telemetry through an authorized API operation, subject to reasonable response limits.

### Editing and deletion

- Authorized users can change pilot, aircraft, batteries, tags, and notes.
- The UI distinguishes user-entered corrections from source-derived values.
- Flight deletion is a soft deletion with a 30-day restoration window.
- After the restoration window, the canonical flight, telemetry, and organization-owned raw source are permanently removed unless another retained flight legitimately references the same source object.
- Audit metadata may retain that an event occurred, but not deleted telemetry, coordinates, notes, or other customer payload.

## 6. Maintenance behavior in Phase 1

- A schedule attaches to one aircraft and uses a flight-hours interval, flight-count interval, or one-shot date.
- Usage-based schedules calculate consumption from active canonical flights after the schedule's baseline.
- `due_soon` thresholds are configurable and default to 80% consumption.
- Completing maintenance records what was done, when, and by whom, and establishes the next baseline for a recurring schedule.
- Correcting or deleting historical flights recalculates schedule consumption.
- Overdue maintenance affects assignment eligibility only when the organization's explicit policy says so.
- The product explains the schedule, current consumption, threshold, due state, and any resulting assignment block.

## 7. Export behavior

- Owners and admins can request a complete organization export.
- Complete exports include documented JSON/CSV domain data, telemetry where present, audit history allowed under retention rules, and a manifest describing raw files.
- A pilot export is limited to flights assigned to that pilot profile and excludes restricted organization administration data.
- Flight and filtered-set exports support CSV and JSON.
- Track exports support GPX and KML when coordinates exist.
- Exports are asynchronous when generation cannot complete within a normal request.
- Download links expire and are re-authorized when issued; possession of an old link must not bypass current membership or role restrictions.

## 8. API behavior

- Core domain capabilities are exposed under `/api/v1/`; the first-party web application uses those same operations.
- Resources use stable opaque identifiers, RFC 3339 timestamps, JSON field names in `snake_case`, cursor pagination, and documented filters.
- Errors use RFC 9457 problem details and include field-specific validation errors when applicable.
- Creation operations accept idempotency keys. Repeating a completed request with the same key and equivalent input returns the original result.
- Breaking contract changes require a new API version. Additive fields may appear in v1, so clients must ignore unknown fields.
- Phase 1 uses web sessions. Public API-key creation and webhook subscriptions are deferred, but authorization is modeled independently of session handling.
- Auth/session and future billing callbacks are the only standing exceptions to the first-party API rule. Any new exception requires an accepted entry in `DECISIONS.md`.

## 9. Privacy, retention, and security behavior

- Raw files are immutable while retained; replacement means creating a new source revision rather than editing bytes.
- Organization deletion begins a 30-day grace period during which the owner may cancel deletion.
- At the end of the grace period, organization records, raw files, telemetry, generated exports, cached organization-linked secrets, and customer payload in audit events are permanently removed from active systems.
- Backups expire deleted customer payload according to a documented maximum backup-retention window.
- Shared technical caches may survive organization deletion only when they cannot be used to identify the organization, user, flight, location, or uploaded file.
- Users are informed before an upload causes metadata to be sent to DJI or another external service.
- Raw files and exports are accessed only through short-lived, authorization-checked downloads.
- All domain mutations create organization-scoped audit events identifying actor, action, time, resource, and changed field names.
- Audit displays avoid duplicating sensitive coordinates, document content, secrets, and full raw payloads.

## 10. Reliability and performance

- A malformed or adversarial file may fail its own processing attempt but must not interrupt other imports.
- Optional geocoding, weather, analytics, and notification failures never make a successfully parsed flight unavailable.
- Controlled parser and persistence performance is measured separately from external key retrieval and queue delay.
- Phase 1 targets for the documented supported fixture set are:
  - controlled processing of a 20-minute DJI flight in 10 seconds or less at p95;
  - first useful flight-detail interaction in 2 seconds or less at p75 on a defined reference connection and device;
  - ordinary list API responses in 300 milliseconds or less at p95 under a defined reference dataset.
- Product metrics state the dataset, environment, and measurement boundary so targets remain testable.

## 11. Future direction, not Phase 1 commitment

Later product phases may add migration importers, richer fleet equipment, compliance documents and reports, missions, checklists, incidents, advanced battery analytics, live telemetry, mobile synchronization, integrations, and public webhooks. Before entering a phase, its customer problem and acceptance criteria must be added to `PRODUCT.md` and a dedicated acceptance specification.
