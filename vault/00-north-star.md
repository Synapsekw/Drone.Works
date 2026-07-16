---
type: north-star
status: active
last-updated: 2026-07-16-1622
tags: [project/drone-works, north-star]
related:
  - "[[project-history]]"
  - "[[memory]]"
  - "[[2026-07-16-1622-deployment-stack-acceptance]]"
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

- **Phase:** Phase 0; P0-07 is complete and D-002, D-008, D-011, D-013, and D-014 are accepted. P0-08 threat/privacy closure and P0-09 implementation backlog are the remaining local critical path.
- **Branch:** source commit `1ae513f` is local on `main`, which is thirty-six commits ahead of `origin/main` before this vault-only closeout commit; nothing was pushed. An unrelated `.obsidian/app.json` change remains unstaged and untouched.
- **Completed evidence:** the accepted stack now covers auth, atomic jobs, versioned object lifecycle, AWS UAE deployment, environments, security boundaries, migration/rollback, 35-day backup retention, restore/deletion replay, observability, and cost alerts. Live S3/restore checks are explicit hosted-data gates rather than claimed Phase 0 cloud execution.
- **Verification baseline:** 34 native PostgreSQL/pg-boss, five telemetry, 78 parser/containment, and three object lifecycle tests pass with zero skips/failures. No Docker, persistent database, cloud credential, paid resource, or customer data was used; syntax, whitespace, and privacy patterns pass.
- **Blocking evidence:** no local P0-07 architecture blocker remains. D-012 production DJI terms/consent/managed-secret gates and broader representative-fixture authorization remain external; the provider stays disabled. Live AWS S3 and restore drills block hosted customer data in Phase 1A.
- **Next technical action:** complete P0-08 threat/privacy flows and security checklist, then P0-09's ordered walking-skeleton backlog and final Phase 0 gate reconciliation.
- **Next external decision:** decide whether the remaining fixtures may use DJI processing; production terms, notice/consent, managed-secret, retention, and deletion gates remain separate under D-012.
- **Parallel follow-up:** carry D-008's provider-inclusive latency/deletion thresholds into P0-07 object-storage evaluation and the P0-08 threat model.
- **Privacy:** raw fixtures remain ignored and local. No raw values, coordinates, identifiers, keychain feature points, credentials, or generated parser artifacts belong in this vault.

## Workstream status

| Workstream | State | Evidence or blocker |
|---|---|---|
| P0-01 constraints and scorecard | Complete | Accepted planning assumptions, weighted quality attributes, disqualifiers, profiles, component ownership, and cost thresholds are recorded; external-spend assumptions have reconsideration gates. |
| P0-02 fixture policy and inventory | Local research gate satisfied | Policy, manifest, three private v14 logs, and one controlled truncation exist. |
| P0-03 parser/key feasibility | Core proof complete; external gates remain | Native containment, truncation, private intermediate, representative measurements, hosted reproducibility, strict audit, evidence upload, and attestations pass; broader fixtures and production D-012 gates remain open. |
| P0-04 canonical model | Core proof complete | Generic schema/validator, ownership/lifecycle, canonical-v1 adapter, provenance, asset evidence, capabilities, override survival, exact-normalized fingerprint, totals, deletion/restoration, and zero-flight transitions pass. |
| P0-05 organization isolation | Complete for Phase 0 | Twenty-three-table forced RLS, pooled context, API/jobs/exports/deletion, auth-claim rejection, object version purge, and backup/log/emergency boundaries support accepted D-002; live AWS conformance and restore are safe Phase 1A hosted-data gates. |
| P0-06 telemetry benchmark | Complete | Full 100,000-flight/600-million-frame object profile, six-million-row comparison, downsampling, bounded delivery, deletion, additive evolution, retained results, and cost sensitivity pass; D-008 is accepted. |
| P0-07 runtime/deployment selection | Complete | D-011/D-013/D-014 accept the modular TypeScript stack, Better Auth boundary, outbox/pg-boss, S3 lifecycle, AWS UAE environments, recovery/rollback, observability, and cost envelope. |
| P0-08 threat model | Next | Accepted system, security, parser, key, object, and recovery boundaries provide complete inputs. |
| P0-09 Phase 1A backlog | Not started | Final Phase 0 synthesis. |

## Entry points

- [[product]] — product contract and acceptance behavior.
- [[roadmap]] — discovery gates and delivery increments.
- [[architecture]] — quality attributes, stack, and trust boundaries.
- [[research]] — DJI parser evidence and unresolved questions.
- [[operations]] — repository, fixture, build, and verification procedures.
- [[memory]] — how durable project context is organized.
- [[project-history]] — milestone timeline backed by Git.
