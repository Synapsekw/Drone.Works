# Canonical domain model and provenance proof

Status: draft Phase 0 proof
Last updated: 2026-07-15

## Purpose

This model proves that a versioned private parser result can become a source-independent flight revision without losing evidence, inventing missing assets, or overwriting human corrections. It implements the accepted direction in D-003 and D-005; it does not select a database schema or settle duplicate-scoring thresholds.

The executable proof is [`../../spikes/dji-parser/src/normalization/canonical-v1.mjs`](../../spikes/dji-parser/src/normalization/canonical-v1.mjs). Its input and full output are private application data. Ordinary serialization exposes structural counts and capability names only.

## Resource relationships

```mermaid
erDiagram
    ORGANIZATION ||--o{ UPLOAD_BATCH : owns
    UPLOAD_BATCH ||--o{ IMPORT_ITEM : contains
    ORGANIZATION ||--o{ RAW_SOURCE : owns
    RAW_SOURCE ||--o{ IMPORT_ITEM : supplies
    IMPORT_ITEM ||--o{ PROCESSING_ATTEMPT : retries
    PROCESSING_ATTEMPT }o--|| PARSER_REVISION : uses
    IMPORT_ITEM ||--o{ CANONICAL_FLIGHT : yields
    CANONICAL_FLIGHT ||--o{ FLIGHT_REVISION : reprocessed_as
    FLIGHT_REVISION ||--o| TELEMETRY_SERIES : contains
    CANONICAL_FLIGHT }o--|| PILOT : assigned_to
    CANONICAL_FLIGHT }o--|| AIRCRAFT : operated_with
    CANONICAL_FLIGHT }o--o{ BATTERY : uses
    AIRCRAFT ||--o{ ASSET_IDENTIFIER : identified_by
    BATTERY ||--o{ ASSET_IDENTIFIER : identified_by
    FLIGHT_REVISION ||--o{ SOURCE_PROVENANCE : explains
    CANONICAL_FLIGHT ||--o{ USER_OVERRIDE : corrected_by
    ORGANIZATION ||--o{ AUDIT_EVENT : records
```

One import item can yield zero, one, or multiple flight candidates. A candidate becomes an active canonical flight only after it has organization-owned pilot and aircraft assignments. Reprocessing adds a flight revision under the existing canonical flight identity; it does not create another flight.

## Ownership and lifecycle

| Resource | Ownership boundary | Identity and revision rule | Deletion rule |
|---|---|---|---|
| Organization | Root tenant | Stable organization ID | Organization deletion removes all customer-owned descendants. |
| Upload batch | Organization | One request/grouping; never a cross-org aggregate | Removed with organization; ordinary item deletion may retain the batch summary while referenced. |
| Raw source | Organization | Content digest plus immutable object reference | Immutable while retained; delete after its final legitimate reference or organization deletion. |
| Import item | Organization and batch | One source item; retry does not replace it | Removed with batch/organization subject to the documented restoration window. |
| Processing attempt | Organization and import item | New ID for every retry | Customer payload is removed with its parent; sanitized operational evidence follows the logging policy. |
| Parser revision | Product-owned global reference | Immutable parser ID, version, source commit, and contract version | Retained as non-customer release evidence. |
| Canonical flight | Organization | Stable ID across reprocessing | Soft-deleted for restoration, then permanently removed with revisions and telemetry. |
| Flight revision | Organization and canonical flight | Immutable normalization result for one processing revision | Removed when the canonical flight is permanently deleted. |
| Telemetry series | Organization and flight revision | Versioned sample schema; never shared across organizations | Removed with its flight revision; downsampled derivatives follow the same lifecycle. |
| Pilot, aircraft, battery | Organization | Organization-scoped IDs; battery relationship is zero-to-many | Historical assignment remains until affected flights or the organization are permanently deleted. |
| Asset identifier | Organization and asset | Identifier type/value is evidence, not a global identity | Removed with the asset/organization; merge retains provenance and audit history. |
| User override | Organization and canonical flight | One active override per important field, with immutable history in audit events | Removed with the flight/organization according to audit deletion policy. |
| Audit event | Organization | Append-only event identity | Customer values are removed or de-identified when their owning data is permanently deleted. |

Every customer-data query, job, export, aggregate, and object reference must carry organization context. P0-05 will prove the persistence enforcement mechanism.

## Import and revision lifecycle

```mermaid
stateDiagram-v2
    [*] --> Uploaded
    Uploaded --> Queued
    Queued --> Parsing
    Parsing --> Normalizing
    Normalizing --> AwaitingReview: pilot or aircraft unresolved
    Normalizing --> Completed: required assignments already trusted
    AwaitingReview --> Completed: authorized reconciliation
    Parsing --> Failed
    Normalizing --> Failed
    Completed --> Reprocessing
    Reprocessing --> Completed: new flight revision, same flight ID
    Completed --> Deleted
    Deleted --> Completed: restore within window
    Deleted --> PermanentlyDeleted
```

Zero-flight parser output completes the processing attempt with no canonical flight. Multiple parser flights receive distinct canonical flight IDs but retain the same import-item and raw-source evidence.

## Canonical fact envelope

Every important field has the same provenance-aware shape:

```json
{
  "imported": {
    "value": 1200,
    "provenance": {
      "origin": "imported",
      "raw_source_id": "source-synthetic",
      "processing_revision_id": "revision-2",
      "intermediate_path": "flights[0].imported.declared_duration_ms",
      "source_value": 1200
    }
  },
  "derived": null,
  "user_override": {
    "value": 900,
    "provenance": {
      "origin": "user_override",
      "audit_event_id": "audit-synthetic"
    }
  },
  "base_preference": ["imported"],
  "effective": {
    "origin": "user_override",
    "value": 900
  }
}
```

The effective-value rule is:

1. An active `user_override` wins, including an intentional `null` value.
2. Otherwise use the first available value in that field's explicit `base_preference`.
3. If no preferred value exists, return `origin: unavailable` and `value: null`.

There is deliberately no global “derived beats imported” rule. A future derived field must declare its own preference based on documented semantics. A parser revision replaces imported and derived evidence in a new flight revision while the active override record is reapplied.

The initial executable mapping covers takeoff time, duration, distance, maximum height, horizontal and vertical speed, aircraft name/model, and source application platform/version. Telemetry uses one series-level provenance record plus a versioned field map rather than repeating identical provenance on every sample.

## Time interpretation

- A source RFC 3339 offset produces a reliable UTC instant. The original source string and offset remain in imported provenance.
- The canonical value is an ISO UTC instant.
- The display timezone is supplied by trusted organization context and records whether it came from the organization default or a later user correction.
- A source without a reliable offset is marked `assumed: true` and `review_required: true`; the original value is retained.
- A later timezone correction creates an audit event and override rather than replacing source evidence.

## Asset evidence and reconciliation

- Parser serials become organization-scoped identifier evidence with `asset_id: null` and `match_status: unresolved` until reconciliation.
- Aircraft model alone never creates or matches an aircraft.
- Missing battery identity is an empty battery-evidence list, not a fictional battery and not a zero identifier.
- Multiple distinct battery identifiers remain distinct list members.
- The uploader is not assumed to be the pilot.
- An `active` canonical flight requires both a pilot ID and aircraft ID plus separate assignment provenance for each. User selections cite an audit event and actor; automatic stable-identifier matches cite versioned match evidence. Otherwise the candidate remains `awaiting_review`.

## Capabilities and missing values

Canonical capability contract version 1 maps parser capability names to:

- `telemetry.altitude`
- `telemetry.attitude`
- `telemetry.battery`
- `telemetry.gps`
- `telemetry.position`
- `telemetry.signal`
- `telemetry.velocity`

Capabilities describe fields actually present in normalized data. Missing scalar or sample values remain `null`; zero is retained only when the source actually reports zero. Manual flights use an empty telemetry-capability list.

## Duplicate evidence draft

Duplicate classification remains separate from normalization:

| Class | Evidence | Automatic effect |
|---|---|---|
| Exact file | Same organization and immutable source digest | May reuse/skip the identical import according to batch behavior. |
| Exact normalized | Same versioned normalized fingerprint and explainable match fields | May avoid a second canonical flight while retaining the import result. |
| Probable | Versioned reasons such as time, track, aircraft, or duration similarity | Never discard automatically; create a reversible review item. |

Battery absence is never positive match evidence. Fingerprint versions and reasons must be retained.

## Draft Phase 1A API resources

All routes are versioned and organization-scoped; authorization is rechecked on every operation.

| Method and resource | Purpose |
|---|---|
| `POST /v1/organizations/{organizationId}/import-batches` | Create upload intent and item records. |
| `GET /v1/organizations/{organizationId}/import-batches/{batchId}` | Read batch and per-item progress/outcome. |
| `GET /v1/organizations/{organizationId}/import-items/{itemId}` | Read parser, normalization, review, or failure evidence. |
| `GET /v1/organizations/{organizationId}/flights/{flightId}` | Read effective facts, provenance summaries, assignments, and capabilities. |
| `GET /v1/organizations/{organizationId}/flights/{flightId}/track` | Read authorized canonical track data with bounded resolution. |
| `PATCH /v1/organizations/{organizationId}/flights/{flightId}/overrides/{field}` | Create or replace an audited field override. |
| `DELETE /v1/organizations/{organizationId}/flights/{flightId}/overrides/{field}` | Remove the active override and reveal the current base value. |

Private parser/intermediate structures are never returned by these resources. Public response schemas will be defined with the walking-skeleton API and must preserve the imported/derived/override distinction where the product exposes provenance.

## Executable evidence and remaining work

Source-free tests currently prove:

- imported fact provenance and UTC conversion;
- unavailable values remain `null`;
- private canonical serialization does not reveal identifiers or telemetry;
- one import item can yield multiple distinct flight identities;
- multi-battery and missing-battery evidence remain truthful;
- an active override survives a simulated parser revision under the same canonical flight ID;
- raw intermediate objects, invalid override values, cross-organization overrides, invalid active assignments, and identity-count mismatches fail closed.

The next P0-04 slices are a generic normalized schema independent of the DJI adapter, exact-normalized fingerprint evidence, deletion/restoration transition tests, and a persistence-oriented ownership model that P0-05 can enforce.
