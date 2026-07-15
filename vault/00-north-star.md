---
type: north-star
status: active
last-updated: 2026-07-15-1309
tags: [project/drone-works, north-star]
related:
  - "[[project-history]]"
  - "[[memory]]"
  - "[[2026-07-15-1309-canonical-provenance-proof]]"
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

- **Phase:** Phase 0, workstream P0-04 — canonical model and provenance proof.
- **Branch:** published source baseline `a3c5da6` on `main` is synchronized with `origin/main`; this wrap-up adds one local vault-only closeout commit above it.
- **Completed evidence:** the private canonical-v1 adapter maps representative parser output into provenance-aware flight revisions, preserves missing and multi-battery evidence, requires truthful pilot/aircraft assignments, and reapplies active user overrides across parser revisions. The authorized proof produced one private flight candidate with 27,228 samples and all seven canonical capabilities.
- **Verification baseline:** 71 host tests pass with zero skips/failures. Hosted run `29403024703` passed parser tests, Linux containment, native reproducibility/audit/evidence/attestations, and the comparison build. Syntax, diff, credential-ignore, and privacy checks pass. No Docker was used locally.
- **Blocking evidence:** P0-04 still needs a generic canonical schema, exact-normalized fingerprint evidence, and executable deletion/restoration/reprocessing transitions. Broader fixture coverage remains permission-gated; production D-012 gates remain separate.
- **Next technical action:** extract the generic canonical schema, then prove exact-normalized fingerprints and lifecycle transitions, including zero-flight outcomes.
- **Next external decision:** decide whether the remaining fixtures may use DJI processing; production terms, notice/consent, managed-secret, retention, and deletion gates remain separate under D-012.
- **After P0-04 mapping:** use the canonical ownership model to begin P0-05 tenancy proof and the representative telemetry shape to begin P0-06 benchmarks.
- **Privacy:** raw fixtures remain ignored and local. No raw values, coordinates, identifiers, keychain feature points, credentials, or generated parser artifacts belong in this vault.

## Workstream status

| Workstream | State | Evidence or blocker |
|---|---|---|
| P0-01 constraints and scorecard | Evidence drafted | Quality attributes and stack scorecard exist; final component choices remain proposed. |
| P0-02 fixture policy and inventory | Local research gate satisfied | Policy, manifest, three private v14 logs, and one controlled truncation exist. |
| P0-03 parser/key feasibility | Core proof complete; external gates remain | Native containment, truncation, private intermediate, representative measurements, hosted reproducibility, strict audit, evidence upload, and attestations pass; broader fixtures and production D-012 gates remain open. |
| P0-04 canonical model | Active; first slice passes | Domain relationships, ownership/lifecycle draft, private canonical-v1 adapter, representative normalization, provenance, asset evidence, capabilities, and override survival pass; schema/fingerprint/transition proofs remain. |
| P0-05 organization isolation | Ready after P0-04 schema | Ownership model exists; executable Postgres/RLS proof should consume the finalized generic resource schema. |
| P0-06 telemetry benchmark | Ready after P0-04 schema | Representative 27,228-sample telemetry shape exists; benchmark should consume the finalized generic series schema. |
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
