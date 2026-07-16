---
type: north-star
status: active
last-updated: 2026-07-16-1517
tags: [project/drone-works, north-star]
related:
  - "[[project-history]]"
  - "[[memory]]"
  - "[[2026-07-16-1517-permanent-flight-deletion]]"
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

- **Phase:** Phase 0; P0-05 local relational isolation evidence is complete enough to unblock P0-06, with forced RLS, deterministic exports, active-database organization/flight deletion, derived downloads and maintenance, real-queue retry, reviewed migration isolation, and versioned core APIs proven.
- **Branch:** source commit `3addfc4` is local on `main`, which is twenty-eight commits ahead of `origin/main` before this vault-only closeout commit; nothing was pushed. An unrelated `.obsidian/app.json` change remains unstaged and untouched.
- **Completed evidence:** the dedicated deletion worker now also enforces the expired flight-restoration timestamp, removes canonical payload/revisions/telemetry, deletes only exclusively referenced raw sources, preserves shared sources and peer flights, retains one UTC payload-redacted action reference, clears pooled context, rejects early/cross-organization/stale jobs, and returns the same evidence after a post-commit pg-boss retry. Prior twenty-three-table organization deletion and all earlier P0-05 evidence remains passing.
- **Verification baseline:** 31 native PostgreSQL integration tests and 78 existing host tests pass with zero skips/failures. JavaScript syntax, seven pinned migration checksums, declared contract preservation/expansion/privilege-tightening, Git whitespace, role and cross-organization denials, strict queue payloads, exclusive/shared source lifecycle, payload redaction, pooled clearing, loopback provider behavior, and real macOS parser network denial pass. No Docker, persistent PostgreSQL service, real object provider, or customer data was used.
- **Blocking evidence:** D-002 remains proposed only for real provider-side URL/object deletion plus cached-secret/log/backup deletion and verification. D-011 remains proposed pending atomic dispatch, worker termination, cancellation, and queue-age evidence; export and both deletion paths are retry-idempotent. The production archive container and maximum backup-retention value remain undecided. Production operations and D-012 gates remain separate.
- **Next technical action:** execute P0-06: build a reproducible synthetic telemetry benchmark representing at least 100,000 flights, measure ingest/replay/export/single-flight and organization deletion, prove extrema/gap-preserving downsampling and bounded full delivery, estimate cost, and record the D-008 selection/reconsideration thresholds.
- **Next external decision:** decide whether the remaining fixtures may use DJI processing; production terms, notice/consent, managed-secret, retention, and deletion gates remain separate under D-012.
- **Parallel follow-up:** use the versioned telemetry shape and representative sample count to begin P0-06 benchmarks after the P0-05 harness boundary is clear.
- **Privacy:** raw fixtures remain ignored and local. No raw values, coordinates, identifiers, keychain feature points, credentials, or generated parser artifacts belong in this vault.

## Workstream status

| Workstream | State | Evidence or blocker |
|---|---|---|
| P0-01 constraints and scorecard | Evidence drafted | Quality attributes and stack scorecard exist; final component choices remain proposed. |
| P0-02 fixture policy and inventory | Local research gate satisfied | Policy, manifest, three private v14 logs, and one controlled truncation exist. |
| P0-03 parser/key feasibility | Core proof complete; external gates remain | Native containment, truncation, private intermediate, representative measurements, hosted reproducibility, strict audit, evidence upload, and attestations pass; broader fixtures and production D-012 gates remain open. |
| P0-04 canonical model | Core proof complete | Generic schema/validator, ownership/lifecycle, canonical-v1 adapter, provenance, asset evidence, capabilities, override survival, exact-normalized fingerprint, totals, deletion/restoration, and zero-flight transitions pass. |
| P0-05 organization isolation | Local relational proof complete; non-relational provider/operations evidence remains | Twenty-three-table forced RLS, composite ownership, pooled context, role-scoped `/api/v1/`, deterministic exports, derived maintenance, reversible requests, grace-bound organization and flight deletion, exclusive/shared raw-source handling, independently owned organization receipt, redacted flight action, retry idempotency, explicit migration elevation, independent migration audit, and declared contract preservation/expansion/tightening pass; real provider plus cache/log/backup deletion verification remain open. |
| P0-06 telemetry benchmark | Active | Versioned telemetry shape and representative 27,228-sample evidence are ready; next build/run the reproducible 100,000-flight benchmark and close D-008. |
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
