---
type: north-star
status: active
last-updated: 2026-07-20-1535
tags: [project/drone-works, north-star]
related:
  - "[[project-history]]"
  - "[[memory]]"
  - "[[2026-07-20-1535-local-batch-review]]"
  - "[[2026-07-20-1125-local-flight-library]]"
---

# Drone.Works — North Star

> The canonical project entry point: where we are, what evidence exists, what is blocked, and where to continue. Product truth lives in `docs/`; this note is a concise live snapshot.

## Product promise

Upload drone flight logs, understand every flight, and maintain a trustworthy operational history of pilots and aircraft.

Drone.Works is an explainable operational record for small professional drone teams. It keeps imported facts, derived values, and human corrections distinct; exposes uncertainty instead of silently guessing; and treats organization isolation, deletion, and data portability as product behavior.

## Delivery position

| Increment | State | Current outcome |
|---|---|---|
| Phase 0 — Technical discovery | Complete | Accepted evidence/decisions, safe external gates, threat model, and implementation-ready backlog. |
| Phase 1A — Walking skeleton | In progress; hosted gate deferred | A01–A13b local/auth work is complete; A14 staging is intentionally paused under D-016. |
| Phase 1B — Trustworthy imports | Initial local slice complete | LP02 adds atomic batches, per-item outcome truth, duplicate review, attempt history, and safe retry; the broader phase gate remains open. |
| Phase 1C — Operational logbook | Initial local slice complete | LP01 adds the flight library, dashboard totals, filters, direct detail opening, and synthetic replay. |
| Phase 1D — Maintenance and hardening | Planned | Basic maintenance plus deletion, recovery, security, and operations gates. |

## Now

- **Phase:** D-016 local product validation is active. A01–A13b, LP01, and LP02 are complete; LP03 is next, while A14/cloud rollout remains intentionally paused.
- **Branch:** `main` is synchronized with `origin/main` through LP02 implementation commit `e4643d7` before this vault closeout. The unrelated `.obsidian/app.json` change and two untracked `index 2.ts` copies remain unstaged and untouched.
- **Completed evidence:** A generated persona can declare and process a multi-file batch, follow batch and item progress, distinguish every accepted LP02 outcome, inspect preserved attempt history, safely retry an eligible failure, and open retained or candidate flight truth from the review inbox. Exact duplicates reuse the canonical flight; probable duplicates remain visible. Generated-client `/api/v1/` access, current membership, forced RLS, hosted persona exclusion, provider-free coordinate privacy, and organization-switch clearing remain enforced.
- **Verification baseline:** Contract 4, database 7, authorization 6, upload 10, jobs 8, flight API 7, auth 7, browser 9, clean local smoke, full `pnpm verify`, and `pnpm build` pass. Hosted verify run `29732988094` passed on `e4643d7`; parser evidence was not triggered because parser inputs did not change.
- **Blocking evidence:** No product blocker exists for LP03. The broader Phase 1B gate remains open; AWS/RDS, hosted credentials, external email, production map services, and customer data remain disabled by D-016.
- **Next technical action:** begin LP03 with useful local aircraft, pilot, and battery registries, active-flight totals, and visible reconciliation state.
- **Next external decision:** evaluate each local product slice for usefulness; resume A14 only after explicit acceptance that the workflow is ready for hosted testing.
- **Privacy:** raw fixtures remain ignored and local. No raw values, coordinates, identifiers, keychain feature points, credentials, or generated parser artifacts belong in this vault.

## Workstream status

| Workstream | State | Evidence or blocker |
|---|---|---|
| P0-01 constraints and scorecard | Complete | Accepted planning assumptions, weighted quality attributes, disqualifiers, profiles, component ownership, and cost thresholds are recorded; external-spend assumptions have reconsideration gates. |
| P0-02 fixture policy and inventory | A09 narrow gate satisfied | Policy, manifest, three approved local-only v14 logs, controlled truncation, and one representative supported-path proof exist. |
| P0-03 parser/key feasibility | Complete for narrow Phase 1A path | D-009/D-012, the native containerized parser, trusted broker, encrypted scoped cache, exact provider interlocks, and the DJI Fly/TXT v14 support row pass; broader variants remain gated. |
| P0-04 canonical model | Complete; initial production slice | A10 promotes the one-flight canonical-v1 adapter, provenance envelopes, stable aircraft evidence, assignment review, exact-normalized fingerprint, and idempotent relational revision into the production packages. |
| P0-05 organization isolation | Complete for Phase 0 | Twenty-three-table forced RLS, pooled context, API/jobs/exports/deletion, auth-claim rejection, object version purge, and backup/log/emergency boundaries support accepted D-002; live AWS conformance and restore are safe Phase 1A hosted-data gates. |
| P0-06 telemetry benchmark | Complete; initial codec and replay selected | D-008's benchmark passes; A10 adds deterministic null-preserving columnar-gzip version 1, and A11 adds exact-object verification, significant-v1 replay, bounded full pages, and payload-free metrics. Hosted provider-inclusive latency remains an A15 gate. |
| P0-07 runtime/deployment selection | Complete | D-011/D-013/D-014 accept the modular TypeScript stack, Better Auth boundary, outbox/pg-boss, S3 lifecycle, AWS UAE environments, recovery/rollback, observability, and cost envelope. |
| P0-08 threat model | Complete | Sensitive-data inventory, privacy flow, 17 critical/high abuse cases, engineering/legal separation, owners, controls, and objective Phase 1A security gates are recorded. |
| P0-09 Phase 1A backlog | Complete; revised | The original sixteen issues passed Phase 0; D-015 now splits A13 into functional-local and verified-auth gates, yielding seventeen reviewable tasks with updated risk and dependencies. |

## Entry points

- [[product]] — product contract and acceptance behavior.
- [[roadmap]] — discovery gates and delivery increments.
- [[architecture]] — quality attributes, stack, and trust boundaries.
- [[research]] — DJI parser evidence and unresolved questions.
- [[operations]] — repository, fixture, build, and verification procedures.
- [[memory]] — how durable project context is organized.
- [[project-history]] — milestone timeline backed by Git.
- [Local product backlog](../docs/roadmap/LOCAL-PRODUCT-BACKLOG.md) — active local-first implementation sequence under D-016.
