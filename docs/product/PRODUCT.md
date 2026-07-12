# Product Definition — Drone.Works

Status: founding draft
Last updated: 2026-07-12

## Product promise

> Upload your drone flight logs, understand every flight, and maintain a trustworthy operational history of pilots and aircraft.

Drone.Works is not simply a log-file viewer. It is an explainable operational record: users can see what was imported, how assets were matched, what the source log actually contained, and what was later corrected by a person.

## First customer

The initial customer is a small professional drone operator with approximately 2–20 aircraft and multiple pilots. Typical work includes inspection, surveying, media, construction, security, or infrastructure operations.

This customer:

- primarily flies DJI aircraft;
- currently uses spreadsheets, vendor apps, or an incumbent logbook;
- needs reliable flight and fleet records without enterprise implementation work;
- cares about maintenance readiness and data portability;
- may employ pilots who do not need a Drone.Works login.

Individual hobbyists may use the product, but their needs do not determine the first release. Large-enterprise requirements such as SSO, custom roles, procurement controls, and regional hosting are not Phase 1 commitments.

## Jobs to be done

1. When I return from flying, help me turn my raw logs into a complete and trustworthy operational record.
2. When I investigate a flight, show the route, telemetry, warnings, and source limitations without hiding uncertainty.
3. When I manage a fleet, show who flew which aircraft and battery and keep totals consistent when records change.
4. When I leave the product, let me export my operational data in useful, documented formats.

## Differentiation

Drone.Works competes on trust and operational clarity:

- Every failed, skipped, matched, or ambiguous import has an understandable reason.
- Imported facts, calculated values, and human corrections remain distinguishable.
- Questionable matches are reviewed rather than silently accepted.
- The first-party web application uses the same versioned API available to integrations.
- Export and audit capabilities are core product behavior, not artificial upgrade traps.

The intended position is:

> A trustworthy, integration-friendly operational record for professional drone fleets, built around transparent imports and explainable compliance.

## Phase 1 outcome

A team can create an organization, upload supported DJI logs, reconcile pilots and fleet assets, inspect flights, replay routes and essential telemetry, enter flights manually, and export its records.

### Included

- Organization membership with owner, admin, pilot, and viewer roles.
- Separate pilot profiles, including profiles for people without accounts.
- Aircraft and battery registries.
- DJI TXT import for explicitly tested DJI Fly, GO 4, and Pilot 2 versions.
- Batch upload with per-file progress and results.
- Exact and probable duplicate handling.
- Import review for uncertain asset or pilot matches.
- Manual flight entry.
- Flight list, filters, tags, notes, and bulk assignment/tagging.
- Flight detail with 2D route replay and synchronized essential charts.
- CSV and JSON data export; GPX and KML track export where coordinates exist.
- Basic dashboard totals derived from flight records.
- Basic flight-hours and flight-count maintenance schedules for aircraft.
- Organization export and deletion workflow.
- Versioned REST API used by the web application.

### Explicitly deferred

- Public API-key self-service and third-party webhooks.
- AirData, DroneLogbook, Litchi, ArduPilot, PX4, and GUTMA importers.
- Documents, licenses, expiry alerts, configurable PDF reports, and regulator presets.
- Equipment/components, battery degradation analytics, and advanced airworthiness rules.
- Missions, checklists, risk assessments, incidents, and approvals.
- Historical weather enrichment and automatic telemetry tags.
- 3D replay, mobile sync apps, live telemetry, mapping, and video.
- Billing automation. Early pilots may be provisioned manually.

Deferred behavior remains directional, not promised. It should not shape Phase 1 architecture unless doing so is inexpensive and supported by a recorded decision.

## Explicit non-goals

- LAANC or flight authorization.
- Photogrammetry and mapping processing.
- Live video streaming.
- Native mission-control or aircraft-control software.
- White-label deployments.

## Success measures

Before expanding the scope, Phase 1 should demonstrate:

- At least 95% of logs in the supported fixture set complete without manual intervention.
- Every unsuccessful import presents an actionable reason; no unexplained failures.
- At least 90% of confidently identified aircraft and batteries match the correct existing asset in validation testing.
- A new customer can upload a batch and reach a useful flight page without assistance.
- Imported totals remain correct after reassignment, deletion, restoration, and reprocessing.
- Five active pilot organizations use Drone.Works as their primary flight record for four consecutive weeks.
- At least three pilot customers report that import transparency or reconciliation is meaningfully better than their previous workflow.

These are learning gates, not vanity metrics. The team should not begin the full compliance and mission roadmap solely because the software shipped.

## Product principles

1. Preserve source evidence while the customer retains the record.
2. Never hide uncertainty behind an automatic decision.
3. Make destructive actions reversible during a defined grace period.
4. Derive totals from canonical flight records rather than maintaining competing counters.
5. Keep customer data portable.
6. Prefer a small, reliable supported-format matrix to a long list of unreliable import claims.
