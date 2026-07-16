---
type: north-star
status: active
last-updated: 2026-07-16-1555
tags: [project/drone-works, north-star]
related:
  - "[[project-history]]"
  - "[[memory]]"
  - "[[2026-07-16-1555-atomic-outbox-dispatch]]"
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

- **Phase:** Phase 0; P0-06 is complete and D-008 is accepted after the full 100,000-flight telemetry benchmark. P0-05's local relational proof remains complete; P0-07 stack, provider, recovery, and cost acceptance is now the critical path.
- **Branch:** source commit `d7664ce` is local on `main`, which is thirty-two commits ahead of `origin/main` before this vault-only closeout commit; nothing was pushed. An unrelated `.obsidian/app.json` change remains unstaged and untouched.
- **Completed evidence:** job creation now commits atomically through a payload-free outbox, while app and dispatcher roles have only narrow functions and no direct queue/customer reads. Stable queue IDs prevent duplicate jobs after a post-send crash; abandoned leases retry, queued cancellation is unclaimable, stale claims fail, and aggregate queue age/counts are observable without resource values. Prior D-008 telemetry and P0-05 isolation evidence remains passing.
- **Verification baseline:** 33 native PostgreSQL/pg-boss integration tests, five telemetry tests, and 78 parser/containment tests pass with zero skips/failures across the current checkpoints. No Docker or persistent database service was used; syntax, strict payloads, RLS reloading, retry/idempotency, role grants, metrics redaction, Git whitespace, and privacy patterns pass.
- **Blocking evidence:** D-002 still needs real provider-side URL/object deletion plus cached-secret/log/backup deletion and verification. D-011's job-fault obligations are now locally complete; authentication/provider choices, production archive container, maximum backup retention, restore/rollback proof, deployment/observability/cost acceptance, and D-012 terms remain open.
- **Next technical action:** continue P0-07 with authentication selection, a production-shaped S3-compatible lifecycle proof, deployment environments/secrets/migrations/observability, backup restore/rollback responsibilities, and current development/beta/benchmark cost envelope; then accept or reject D-011.
- **Next external decision:** decide whether the remaining fixtures may use DJI processing; production terms, notice/consent, managed-secret, retention, and deletion gates remain separate under D-012.
- **Parallel follow-up:** carry D-008's provider-inclusive latency/deletion thresholds into P0-07 object-storage evaluation and the P0-08 threat model.
- **Privacy:** raw fixtures remain ignored and local. No raw values, coordinates, identifiers, keychain feature points, credentials, or generated parser artifacts belong in this vault.

## Workstream status

| Workstream | State | Evidence or blocker |
|---|---|---|
| P0-01 constraints and scorecard | Evidence drafted | Quality attributes and stack scorecard exist; final component choices remain proposed. |
| P0-02 fixture policy and inventory | Local research gate satisfied | Policy, manifest, three private v14 logs, and one controlled truncation exist. |
| P0-03 parser/key feasibility | Core proof complete; external gates remain | Native containment, truncation, private intermediate, representative measurements, hosted reproducibility, strict audit, evidence upload, and attestations pass; broader fixtures and production D-012 gates remain open. |
| P0-04 canonical model | Core proof complete | Generic schema/validator, ownership/lifecycle, canonical-v1 adapter, provenance, asset evidence, capabilities, override survival, exact-normalized fingerprint, totals, deletion/restoration, and zero-flight transitions pass. |
| P0-05 organization isolation | Local relational proof complete; non-relational provider/operations evidence remains | Twenty-three-table forced RLS, composite ownership, pooled context, role-scoped `/api/v1/`, deterministic exports, derived maintenance, reversible requests, grace-bound organization and flight deletion, exclusive/shared raw-source handling, independently owned organization receipt, redacted flight action, retry idempotency, explicit migration elevation, independent migration audit, and declared contract preservation/expansion/tightening pass; real provider plus cache/log/backup deletion verification remain open. |
| P0-06 telemetry benchmark | Complete | Full 100,000-flight/600-million-frame object profile, six-million-row comparison, downsampling, bounded delivery, deletion, additive evolution, retained results, and cost sensitivity pass; D-008 is accepted. |
| P0-07 runtime/deployment selection | Active | Transactional outbox, deduplicated dispatch, worker lease recovery, cancellation, and queue-age evidence pass; auth, provider, environments, recovery, observability, and cost acceptance remain. |
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
