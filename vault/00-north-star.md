---
type: north-star
status: active
last-updated: 2026-07-15-0943
tags: [project/drone-works, north-star]
related:
  - "[[project-history]]"
  - "[[memory]]"
  - "[[2026-07-15-0943-select-native-parser-boundary]]"
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
- **Branch:** `main` at `58e42a7`, seven commits ahead of `origin/main`; the native parser-boundary proof and accepted D-009 decision are committed.
- **Completed evidence:** the native Rust CLI matches the JS/WASM result at 27,228 frames with the same validation and capabilities, uses approximately 70 MB peak RSS instead of 410 MB, and decodes in approximately 203–207 ms instead of 412–416 ms. Its reproducible build removes provider networking, and valid processing recovers after a guarded malformed-input failure.
- **Verification baseline:** all 57 parser/orchestration tests pass outside the outer sandbox with zero skips; the exact pinned native source builds successfully, the controlled derivative returns structured `parser_internal_error` with zero stderr, and a later fresh child reproduces the valid result. Linux hard-container and JS/WASM reproducibility/advisory CI evidence remain green.
- **Blocking evidence:** upstream record iteration discards its parse-termination reason and contains unchecked reads, so `truncated_records` cannot yet be distinguished honestly from corrupt/internal failure. Remaining fixture coverage, duration, normalization/output-volume measurements, and native SBOM/audit/attestation gates remain open.
- **Next technical action:** patch the pinned parser to expose clean completion versus unexpected EOF/corrupt-record termination, prove `truncated_records` and unchanged valid output, then complete native release gates before starting P0-04 normalization.
- **Next external decision:** decide whether the remaining fixtures may use DJI processing; production terms, notice/consent, managed-secret, retention, and deletion gates remain separate under D-012.
- **After representative output:** begin P0-04 canonical model/provenance proof; P0-05 tenancy and P0-06 telemetry work follow the Phase 0 dependency gates.
- **Privacy:** raw fixtures remain ignored and local. No raw values, coordinates, identifiers, keychain feature points, credentials, or generated parser artifacts belong in this vault.

## Workstream status

| Workstream | State | Evidence or blocker |
|---|---|---|
| P0-01 constraints and scorecard | Evidence drafted | Quality attributes and stack scorecard exist; final component choices remain proposed. |
| P0-02 fixture policy and inventory | Local research gate satisfied | Policy, manifest, three private v14 logs, and one controlled truncation exist. |
| P0-03 parser/key feasibility | Active | D-009 selects the native Rust CLI in the Linux boundary; truncation termination, native release gates, broader coverage, and normalization measurements remain open. |
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
