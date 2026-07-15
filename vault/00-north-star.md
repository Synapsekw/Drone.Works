---
type: north-star
status: active
last-updated: 2026-07-15-1115
tags: [project/drone-works, north-star]
related:
  - "[[project-history]]"
  - "[[memory]]"
  - "[[2026-07-15-1115-native-release-evidence]]"
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
- **Branch:** `main` at `52db979`, eleven commits ahead of `origin/main` before this vault wrap-up; native release-evidence tooling and CI are committed locally.
- **Completed evidence:** the selected native build now emits a normalized target-specific CycloneDX SBOM, complete third-party notices/license texts, SHA-256 artifact/input manifests, and a deterministic evidence inventory. Two clean host-target builds produced 80 byte-identical files; strict target-filtered RustSec checks found zero vulnerabilities and zero warnings across 39 target components. The Ubuntu two-build, evidence-upload, binary-provenance, and SBOM-attestation job is defined.
- **Verification baseline:** each clean pinned-source build passed four Rust release tests and produced the same 903,232-byte executable digest. All 58 parser/orchestration tests pass outside the outer sandbox with zero skips; JavaScript syntax, Rust formatting, workflow YAML parsing, repository diff integrity, local-path/provider-marker scans, and the 80-file repeatability comparison pass. No Docker was used locally.
- **Blocking evidence:** the new native job has not run on hosted Ubuntu because this working block did not push; Linux byte identity, uploaded evidence, and published attestations remain open. Representative fixture coverage and duration-threshold validation, normalization, process-startup, and output-volume measurements also remain open.
- **Next technical action:** push the committed workflow when explicitly requested, verify the hosted `native-parser-build` evidence and both attestations, then validate representative duration/output before starting P0-04 normalization.
- **Next external decision:** decide whether the remaining fixtures may use DJI processing; production terms, notice/consent, managed-secret, retention, and deletion gates remain separate under D-012.
- **After representative output:** begin P0-04 canonical model/provenance proof; P0-05 tenancy and P0-06 telemetry work follow the Phase 0 dependency gates.
- **Privacy:** raw fixtures remain ignored and local. No raw values, coordinates, identifiers, keychain feature points, credentials, or generated parser artifacts belong in this vault.

## Workstream status

| Workstream | State | Evidence or blocker |
|---|---|---|
| P0-01 constraints and scorecard | Evidence drafted | Quality attributes and stack scorecard exist; final component choices remain proposed. |
| P0-02 fixture policy and inventory | Local research gate satisfied | Policy, manifest, three private v14 logs, and one controlled truncation exist. |
| P0-03 parser/key feasibility | Active | Native runtime, truncation, local SBOM/notices, strict advisory, and repeat-build gates pass; hosted Linux attestations, broader coverage, and normalization measurements remain open. |
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
