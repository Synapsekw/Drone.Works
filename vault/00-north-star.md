---
type: north-star
status: active
last-updated: 2026-07-15-1826
tags: [project/drone-works, north-star]
related:
  - "[[project-history]]"
  - "[[memory]]"
  - "[[2026-07-15-1826-postgres-rls-isolation]]"
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

- **Phase:** Phase 0; P0-05 organization isolation is active and its first relational Postgres/RLS slice is complete.
- **Branch:** source commit `ec9d5f6` is local on `main`, which is four commits ahead of `origin/main` before this vault-only closeout commit; nothing was pushed in this working block.
- **Completed evidence:** a native PostgreSQL 18 spike maps the generic ownership graph into seven forced-RLS tables with non-owner/non-`BYPASSRLS` application access, composite organization foreign keys, transaction-local pooled context, and organization-required repository/job operations. Alpha/Beta direct reads, joins, aggregates, exports, writes, missing context, owner behavior, and same-backend pool reuse fail closed.
- **Verification baseline:** 7 native PostgreSQL integration tests and 78 existing host tests pass with zero skips/failures. JavaScript syntax, JSON, Git whitespace, privacy, role/table policy state, loopback provider behavior, and real macOS parser network denial pass. Hosted run `29403024703` remains the latest Linux release-evidence baseline. No Docker or persistent PostgreSQL service was used.
- **Blocking evidence:** D-002 remains proposed because API role authorization, a real queue, object-key/signed-download enforcement and revocation, observable privileged access, remaining resource types, and deletion paths are not yet executable. Broader fixture coverage remains permission-gated; production D-012 gates remain separate.
- **Next technical action:** continue P0-05 with organization-owned raw-source/export references and an object-key/download proof that reauthorizes membership before minting a short-lived URL; then exercise the organization-required job contract through a real queue.
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
| P0-05 organization isolation | Active; relational core proven | Native Postgres forced RLS, composite ownership constraints, pooled context, repositories, jobs, aggregates, and relational exports pass; API roles, real queue, objects/downloads, privileged access, remaining resource types, and deletion remain open. |
| P0-06 telemetry benchmark | Ready | Versioned telemetry shape and representative 27,228-sample evidence are ready for storage/downsampling benchmarks. |
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
