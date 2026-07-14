---
type: north-star
status: active
last-updated: 2026-07-14-2100
tags: [project/drone-works, north-star]
related:
  - "[[project-history]]"
  - "[[memory]]"
  - "[[2026-07-14-2100-green-parser-ci-proof]]"
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
- **Branch:** `main` at `f9ce540`, one documentation commit ahead of `origin/main`; source fixes through `0005750` are pushed and the working tree and Obsidian state are clean.
- **Completed evidence:** GitHub run `29351324096` passed parser tests/advisories, Linux containment, two reproducible internal builds, API comparison, and target-specific RustSec enforcement; the hard-container and CI gates are now closed.
- **Verification baseline:** 41 local parser/orchestration tests ran with 39 passing and two listener-dependent checks skipped by the outer sandbox; the hosted Linux proof classified wall-time, output, and cgroup OOM limits correctly; 104 build files were byte-identical and 49 target components had no RustSec findings; the vault verifier passes for 22 notes.
- **Blocking evidence:** real DJI key retrieval remains unauthorized, so decoded-frame correctness, truncated-record behavior, representative decode measurements, and the final JS-binding-versus-Rust-CLI choice remain open. D-009 is still proposed.
- **Next technical action:** after explicit external authorization, run the controlled key-retrieval path, validate frames and truncation/recovery behavior, measure representative resource/output use, and settle the parser/runtime boundary under D-009.
- **Next external decision:** approve or reject a controlled DJI key-retrieval path after legal/terms, consent, credential ownership, retention, and deletion review.
- **After representative output:** begin P0-04 canonical model/provenance proof; P0-05 tenancy and P0-06 telemetry work follow the Phase 0 dependency gates.
- **Privacy:** raw fixtures remain ignored and local. No raw values, coordinates, identifiers, keychain feature points, credentials, or generated parser artifacts belong in this vault.

## Workstream status

| Workstream | State | Evidence or blocker |
|---|---|---|
| P0-01 constraints and scorecard | Evidence drafted | Quality attributes and stack scorecard exist; final component choices remain proposed. |
| P0-02 fixture policy and inventory | Local research gate satisfied | Policy, manifest, three private v14 logs, and one controlled truncation exist. |
| P0-03 parser/key feasibility | Active | Linux containment, reproducible build, and advisory gates pass in hosted CI; authorized frame decode and final runtime selection remain blocking. |
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
