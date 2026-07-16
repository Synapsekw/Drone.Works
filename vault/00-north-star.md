---
type: north-star
status: active
last-updated: 2026-07-16-1403
tags: [project/drone-works, north-star]
related:
  - "[[project-history]]"
  - "[[memory]]"
  - "[[2026-07-16-1403-organization-export-isolation]]"
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

- **Phase:** Phase 0; P0-05 organization isolation is active, with relational RLS, derived downloads, real-queue retry, reviewed migration isolation, and versioned flight, administration, remaining-resource, and organization-export request APIs proven.
- **Branch:** source commit `09613e0` is local on `main`, which is twenty commits ahead of `origin/main` before this vault-only closeout commit; nothing was pushed in this working block.
- **Completed evidence:** twenty-one customer tables run under forced RLS. Owner/admin complete-export requests produce an immutable organization-scoped manifest, replay idempotently, deny pilot/viewer and cross-organization access uniformly, clear on pooled reuse, and persist only strict queue references. Prior signer, flight, administration, remaining-resource, migration, and real-queue retry evidence remains passing.
- **Verification baseline:** 26 native PostgreSQL integration tests and 78 existing host tests pass with zero skips/failures. JavaScript syntax, four pinned migration checksums, declared contract preservation/expansion, Git whitespace, role and cross-organization denials, contextless pooled reuse, strict queue payloads, loopback provider behavior, and real macOS parser network denial pass. Hosted run `29403024703` remains the latest Linux release-evidence baseline. No Docker, persistent PostgreSQL service, real object provider, or customer data was used.
- **Blocking evidence:** D-002 remains proposed because complete-export archive/artifact generation, additional Phase 1 resources such as maintenance records, real provider-side URL/object/deletion behavior, and permanent deletion paths are not yet executable. Production credential delivery, externally retained database audit logs, and emergency operations remain P0-07 concerns. D-011 remains proposed pending atomic dispatch, worker termination, cancellation, queue-age, and idempotent worker-mutation evidence. Broader fixture coverage remains permission-gated; production D-012 gates remain separate.
- **Next technical action:** continue P0-05 with the smallest maintenance-resource proof: organization-owned schedules and completion records under forced RLS, owner/admin mutation, allowed member reads, derived aircraft-usage scope, pooled reuse, and uniform cross-organization denial.
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
| P0-05 organization isolation | Active; relational, signer, queue, core API, organization-export request, and reviewed migration boundaries proven | Twenty-one-table forced RLS, composite ownership, pooled context, derived keys, bounded downloads, retry isolation, role-scoped `/api/v1/` behavior, idempotency, audit redaction, imported/user association origins, upload/import scope, immutable export manifests, strict queue references, historical unlink, reversible deletion requests, single-owner enforcement, explicit migration elevation, independently owned migration audit, and declared isolation-contract preservation/expansion pass; export archive generation, maintenance resources, real provider, and permanent deletion remain open. |
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
