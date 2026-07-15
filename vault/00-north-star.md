---
type: north-star
status: active
last-updated: 2026-07-15-1158
tags: [project/drone-works, north-star]
related:
  - "[[project-history]]"
  - "[[memory]]"
  - "[[2026-07-15-1158-hosted-native-attestations]]"
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
- **Branch:** clean `main` at `37e7d82`, synchronized with `origin/main`; the SBOM-attestation fix and canonical hosted evidence are published.
- **Completed evidence:** hosted Ubuntu run `29398131979` produced 78 byte-identical native Linux build-output files, a 38-component target SBOM with zero target RustSec findings, an uploaded evidence archive, and verified binary-provenance plus SBOM attestations. Final-head run `29398755562` passed all parser, containment, native, and internal-build jobs again.
- **Verification baseline:** the downloaded evidence matched all 77 inventory hashes; its 1,028,120-byte Linux executable matched the recorded digest, both attestations verified against the exact workflow/source commit/artifact, and privacy scans found no disposable absolute paths or credential markers. Local syntax, workflow YAML, and diff checks pass. No Docker was used locally.
- **Blocking evidence:** representative fixture coverage and duration-threshold validation remain incomplete for fixtures that are not authorized for DJI processing. A privacy-safe representative intermediate output, normalization, process-startup, and output-volume measurements also remain open.
- **Next technical action:** define and validate the sanitized intermediate-output contract and measurements using the already authorized fixture, then begin P0-04 canonical model/provenance mapping.
- **Next external decision:** decide whether the remaining fixtures may use DJI processing; production terms, notice/consent, managed-secret, retention, and deletion gates remain separate under D-012.
- **After representative output:** begin P0-04 canonical model/provenance proof; P0-05 tenancy and P0-06 telemetry work follow the Phase 0 dependency gates.
- **Privacy:** raw fixtures remain ignored and local. No raw values, coordinates, identifiers, keychain feature points, credentials, or generated parser artifacts belong in this vault.

## Workstream status

| Workstream | State | Evidence or blocker |
|---|---|---|
| P0-01 constraints and scorecard | Evidence drafted | Quality attributes and stack scorecard exist; final component choices remain proposed. |
| P0-02 fixture policy and inventory | Local research gate satisfied | Policy, manifest, three private v14 logs, and one controlled truncation exist. |
| P0-03 parser/key feasibility | Active | Native runtime, truncation, hosted Linux reproducibility, strict advisory, evidence upload, and both attestations pass; representative output/measurement and broader-coverage gates remain open. |
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
