# Local product-validation backlog

Status: active under D-016
Last updated: 2026-07-20

## Outcome

Build enough of the accepted Phase 1B and Phase 1C product locally for the
product owner to inspect real workflows before deciding whether to resume A14,
AWS, or additional authentication work. Every slice keeps the existing
organization, privacy, provenance, and generated-contract boundaries.

## Sequence

1. **LP01 — Flight library and dashboard (complete):** organization-scoped
   current-flight list, active totals, search, review-state filter, direct
   detail opening, and clearly synthetic local demo flights with one truthful
   capability-aware track.
2. **LP02 — Batch truth and review inbox (complete):** atomic multi-file batch
   declaration, batch and per-file progress, complete terminal-outcome
   accounting, auditable attempt history, eligible safe retry, direct retained
   or candidate flight opening, and exact/probable duplicate clarity without
   silent discard. The local generated review batch and browser workflow cover
   supported completion, unsupported, corrupt, truncated, key-unavailable,
   cancelled, exact-duplicate, and probable-duplicate results.
3. **LP03 — Fleet and people:** useful aircraft, pilot, and battery registries
   with active-flight totals and visible reconciliation state.
4. **LP04 — Flight workspace:** synchronized replay and essential charts,
   source/derived/override presentation, assignments, notes, tags, and
   correction history.
5. **LP05 — Daily logbook operations:** richer accepted filters, manual entry,
   deletion/restoration, and portable CSV/JSON plus coordinate-conditional
   GPX/KML exports.
6. **LP06 — Maintenance and local acceptance:** flight-hour/count schedules,
   due state, usability pass, performance/accessibility evidence, and a product
   owner decision on hosted rollout.

## Guardrails

- No AWS/RDS provisioning, hosted credentials, external email, production map
  provider, or customer data without a separate accepted decision.
- Generated persona UI remains visibly local-only and excluded from hosted
  builds; Better Auth remains compiled and tested.
- Domain operations remain under `/api/v1/` through the generated client.
- Each slice proves Alpha/Beta isolation, current membership, forced RLS,
  organization-switch clearing, payload/coordinate privacy, and accessible
  loading, empty, success, and error behavior proportional to its scope.
- Completing a local slice does not imply the enclosing Phase 1B/1C gate has
  passed.
