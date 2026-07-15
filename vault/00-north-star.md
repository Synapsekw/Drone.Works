---
type: north-star
status: active
last-updated: 2026-07-15-1007
tags: [project/drone-works, north-star]
related:
  - "[[project-history]]"
  - "[[memory]]"
  - "[[2026-07-15-1007-classify-truncated-records]]"
---

# Drone.Works — North Star

> The canonical project entry point: where we are, what evidence exists, what is blocked, and where to continue. Product truth lives in `docs/`; this note is a concise live snapshot.

## Product promise

Upload drone flight logs, understand every flight, and maintain a trustworthy operational history of pilots and aircraft.

Drone.Works is an explainable operational record for small professional drone teams. It keeps imported facts, derived values, and human corrections distinct; exposes uncertainty instead of silently guessing; and treats organization isolation, deletion, and data portability as product behavior.

## Delivery position

| Increment | State | Current outcome |
|---|---|---|
| Phase 0 — Technical discovery | Active | Retire parser, key-service, model, tenancy, telemetry, stack, and security uncertainties with evidence. |
| Phase 1A — Walking skeleton | Planned | Organization → upload → asynchronous parse → canonical flight → 2D track. |
| Phase 1B — Trustworthy imports | Planned | Explain every batch outcome and reconcile uncertainty without silent loss. |
| Phase 1C — Operational logbook | Planned | Daily flight, fleet, replay, correction, search, and export workflow. |
| Phase 1D — Maintenance and hardening | Planned | Basic maintenance plus deletion, recovery, security, and operations gates. |

## Now

- **Phase:** Phase 0, workstream P0-03 — DJI parser and key feasibility.
- **Branch:** `main` at `90f33bd`, nine commits ahead of `origin/main` before this vault wrap-up; evidence-based native truncation classification is committed.
- **Completed evidence:** the native Rust CLI still decodes the authorized valid fixture to 27,228 frames with unchanged validation and capabilities. The controlled derivative now returns structured `truncated_records`, based on an incomplete terminal record, a validated decoded prefix, and decoded time materially short of the source-declared total; a fresh valid child then reproduces all 27,228 frames.
- **Verification baseline:** the exact pinned native source applies the tracked hardening patch, passes four Rust release tests, and builds cleanly. All 57 parser/orchestration tests pass outside the outer sandbox with zero skips; the live valid → derivative → valid sequence returns 27,228 frames → `truncated_records` → 27,228 frames with zero derivative stderr. Linux hard-container and JS/WASM reproducibility/advisory CI evidence remain green.
- **Blocking evidence:** native target SBOM/notices, advisory audit, Linux artifact attestation, and CI execution remain open. Representative fixture coverage and duration-threshold validation, normalization, process-startup, and output-volume measurements also remain open.
- **Next technical action:** add native target SBOM/notices, advisory audit, Linux artifact attestation, and CI execution; then validate the duration threshold and representative intermediate output before starting P0-04 normalization.
- **Next external decision:** decide whether the remaining fixtures may use DJI processing; production terms, notice/consent, managed-secret, retention, and deletion gates remain separate under D-012.
- **After representative output:** begin P0-04 canonical model/provenance proof; P0-05 tenancy and P0-06 telemetry work follow the Phase 0 dependency gates.
- **Privacy:** raw fixtures remain ignored and local. No raw values, coordinates, identifiers, keychain feature points, credentials, or generated parser artifacts belong in this vault.

## Workstream status

| Workstream | State | Evidence or blocker |
|---|---|---|
| P0-01 constraints and scorecard | Evidence drafted | Quality attributes and stack scorecard exist; final component choices remain proposed. |
| P0-02 fixture policy and inventory | Local research gate satisfied | Policy, manifest, three private v14 logs, and one controlled truncation exist. |
| P0-03 parser/key feasibility | Active | D-009 selects the native Rust CLI in the Linux boundary and controlled truncation classification is proven; native release gates, broader coverage, and normalization measurements remain open. |
| P0-04 canonical model | Waiting | Requires representative intermediate parser output. |
| P0-05 organization isolation | Not started | Requires ownership model and executable Postgres/RLS proof. |
| P0-06 telemetry benchmark | Not started | Requires representative telemetry shape. |
| P0-07 runtime/deployment selection | Proposed | TypeScript/Next/Fastify/worker/Postgres shortlist needs remaining proofs. |
| P0-08 threat model | Not started | Parser/key boundaries provide initial inputs. |
| P0-09 Phase 1A backlog | Not started | Final Phase 0 synthesis. |

## Entry points

- [[product]] — product contract and acceptance behavior.
- [[roadmap]] — discovery gates and delivery increments.
- [[architecture]] — quality attributes, stack, and trust boundaries.
- [[research]] — DJI parser evidence and unresolved questions.
- [[operations]] — repository, fixture, build, and verification procedures.
- [[memory]] — how durable project context is organized.
- [[project-history]] — milestone timeline backed by Git.
