---
type: north-star
status: active
last-updated: 2026-07-14-2136
tags: [project/drone-works, north-star]
related:
  - "[[project-history]]"
  - "[[memory]]"
  - "[[2026-07-14-2136-controlled-dji-request-host-blocked]]"
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
- **Branch:** `main` at `f34a614`, three commits ahead of `origin/main`; the controlled-runner source and canonical evidence are committed and the working tree was clean before this vault wrap-up.
- **Completed evidence:** Linux containment and reproducible/advisory CI remain green; a fail-closed one-shot DJI runner now defaults to dry-run, enforces per-fixture authorization, isolates credentials and keychains, destroys its memory cache, and accepts the exact finite wire identifiers.
- **Verification baseline:** all 56 parser/orchestration tests pass outside the outer sandbox with zero skips; the first authorized fixture produces a bounded dry-run request with one group, nine feature points, and 3,825 bytes; four fixtures pass manifest verification and hosted run `29351324096` retains the Linux proof.
- **Blocking evidence:** the host rejected the first live execution before process creation because fixture-derived private data would leave the workspace. No DJI request was made, so decoded frames, truncation behavior, representative measurements, and the final JS-binding-versus-Rust-CLI choice remain open.
- **Next technical action:** once the host permits the authorized disclosure, execute the existing one-shot runner for the first fixture, validate frames and truncation/recovery behavior, measure representative resource/output use, and settle D-009.
- **Next external decision:** permit the single fixture-derived DJI request at the host boundary; production terms, notice/consent, managed-secret, retention, and deletion gates remain separate under D-012.
- **After representative output:** begin P0-04 canonical model/provenance proof; P0-05 tenancy and P0-06 telemetry work follow the Phase 0 dependency gates.
- **Privacy:** raw fixtures remain ignored and local. No raw values, coordinates, identifiers, keychain feature points, credentials, or generated parser artifacts belong in this vault.

## Workstream status

| Workstream | State | Evidence or blocker |
|---|---|---|
| P0-01 constraints and scorecard | Evidence drafted | Quality attributes and stack scorecard exist; final component choices remain proposed. |
| P0-02 fixture policy and inventory | Local research gate satisfied | Policy, manifest, three private v14 logs, and one controlled truncation exist. |
| P0-03 parser/key feasibility | Active | Containment, reproducible build, advisories, one-shot broker wiring, and real-fixture dry-run pass; host-blocked live decode and final runtime selection remain open. |
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
