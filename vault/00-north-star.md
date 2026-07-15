---
type: north-star
status: active
last-updated: 2026-07-15-1232
tags: [project/drone-works, north-star]
related:
  - "[[project-history]]"
  - "[[memory]]"
  - "[[2026-07-15-1232-private-parser-intermediate]]"
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

- **Phase:** Phase 0, advancing from P0-03 parser feasibility into P0-04 canonical model and provenance.
- **Branch:** clean `main` at `cc7852c`, synchronized with `origin/main`; the private parser-intermediate proof is published.
- **Completed evidence:** the authorized fixture produced two matching, source-hash-bound private intermediates with 27,228 samples under the bounded IPC limit. Raw telemetry and identifiers stayed behind the trusted normalizer accessor; ordinary output contained only structural metrics and a material digest.
- **Verification baseline:** 64 host parser/orchestration tests pass; two clean native builds produced 86 byte-identical evidence files and a 42-component target graph with zero RustSec findings. Hosted run `29400677885` passed parser tests, Linux containment, native repeat-build/audit, evidence upload, binary/SBOM attestations, and the comparison build. No Docker was used locally.
- **Blocking evidence:** broader fixture coverage remains closed until those fixtures are authorized for DJI processing. Production legal, consent, managed-secret, retention, and deletion gates remain open under D-012, but they do not block the local P0-04 model proof.
- **Next technical action:** implement the smallest P0-04 canonical normalizer and provenance mapping behind the private intermediate accessor, using source-free synthetic tests.
- **Next external decision:** decide whether the remaining fixtures may use DJI processing; production terms, notice/consent, managed-secret, retention, and deletion gates remain separate under D-012.
- **After P0-04 mapping:** use the canonical ownership model to begin P0-05 tenancy proof and the representative telemetry shape to begin P0-06 benchmarks.
- **Privacy:** raw fixtures remain ignored and local. No raw values, coordinates, identifiers, keychain feature points, credentials, or generated parser artifacts belong in this vault.

## Workstream status

| Workstream | State | Evidence or blocker |
|---|---|---|
| P0-01 constraints and scorecard | Evidence drafted | Quality attributes and stack scorecard exist; final component choices remain proposed. |
| P0-02 fixture policy and inventory | Local research gate satisfied | Policy, manifest, three private v14 logs, and one controlled truncation exist. |
| P0-03 parser/key feasibility | Core proof complete; external gates remain | Native containment, truncation, private intermediate, representative measurements, hosted reproducibility, strict audit, evidence upload, and attestations pass; broader fixtures and production D-012 gates remain open. |
| P0-04 canonical model | Active | Representative private intermediate exists; implement canonical field/provenance mapping with source-free tests. |
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
