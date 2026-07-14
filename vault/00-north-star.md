---
type: north-star
status: active
last-updated: 2026-07-14-1439
tags: [project/drone-works, north-star]
related:
  - "[[project-history]]"
  - "[[memory]]"
  - "[[2026-07-14-1439-linux-parser-containment]]"
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
- **Branch:** `main` at `67ee158`; the working tree contains the uncommitted Linux containment and CI implementation, while Obsidian state remains clean.
- **Completed evidence:** fixture governance and a private three-log DJI v14 inventory; per-file parser isolation; mock keychain broker/cache; private parser IPC; hardened provider boundary; official-parser comparison; supply-chain audit; reproducible internal WASM build with parser-side networking removed; local fail-closed orchestration tests for the proposed Linux boundary.
- **Verification baseline:** 36 parser/orchestration tests ran locally with 34 passing and two listener-dependent checks skipped by the outer sandbox; the four-record fixture manifest, JavaScript syntax, workflow YAML, diff checks, and live npm audit passed with zero vulnerabilities; the vault verifier passes for 18 notes.
- **Blocking evidence:** the new Linux namespace/cgroup job and CI internal rebuild have not run, so the container and automation checklists remain open. Real DJI key retrieval is also unauthorized, leaving decoded-frame correctness, truncation behavior, and the supported v14 matrix unproven.
- **Next technical action:** review and commit the containment source, run the `DJI parser evidence` workflow, record a green Linux result, and then reconsider the JS binding versus a Rust CLI under D-009.
- **Next external decision:** approve or reject a controlled DJI key-retrieval path after legal/terms, consent, credential ownership, retention, and deletion review.
- **After representative output:** begin P0-04 canonical model/provenance proof; P0-05 tenancy and P0-06 telemetry work follow the Phase 0 dependency gates.
- **Privacy:** raw fixtures remain ignored and local. No raw values, coordinates, identifiers, keychain feature points, credentials, or generated parser artifacts belong in this vault.

## Workstream status

| Workstream | State | Evidence or blocker |
|---|---|---|
| P0-01 constraints and scorecard | Evidence drafted | Quality attributes and stack scorecard exist; final component choices remain proposed. |
| P0-02 fixture policy and inventory | Local research gate satisfied | Policy, manifest, three private v14 logs, and one controlled truncation exist. |
| P0-03 parser/key feasibility | Active | Linux containment and CI gates are implemented but unexecuted; authorized frame decode also remains blocking. |
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
