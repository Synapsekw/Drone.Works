---
type: north-star
status: active
last-updated: 2026-07-16-2145
tags: [project/drone-works, north-star]
related:
  - "[[project-history]]"
  - "[[memory]]"
  - "[[2026-07-16-2145-local-first-auth-sequence]]"
---

# Drone.Works — North Star

> The canonical project entry point: where we are, what evidence exists, what is blocked, and where to continue. Product truth lives in `docs/`; this note is a concise live snapshot.

## Product promise

Upload drone flight logs, understand every flight, and maintain a trustworthy operational history of pilots and aircraft.

Drone.Works is an explainable operational record for small professional drone teams. It keeps imported facts, derived values, and human corrections distinct; exposes uncertainty instead of silently guessing; and treats organization isolation, deletion, and data portability as product behavior.

## Delivery position

| Increment | State | Current outcome |
|---|---|---|
| Phase 0 — Technical discovery | Complete | Accepted evidence/decisions, safe external gates, threat model, and implementation-ready backlog. |
| Phase 1A — Walking skeleton | In progress | A01–A04 foundation and PostgreSQL/RLS boundary complete; revised A05 local identity seam and authorization is next. |
| Phase 1B — Trustworthy imports | Planned | Explain every batch outcome and reconcile uncertainty without silent loss. |
| Phase 1C — Operational logbook | Planned | Daily flight, fleet, replay, correction, search, and export workflow. |
| Phase 1D — Maintenance and hardening | Planned | Basic maintenance plus deletion, recovery, security, and operations gates. |

## Now

- **Phase:** Phase 1A implementation is active. A01–A04 are complete. D-015 revises the remaining sequence so A05–A13a build a functional local app before A13b integrates verified authentication; AWS still begins only at A14.
- **Branch:** plan commit `af0e302` is local on `main`, which is forty-six commits ahead of `origin/main` before this vault-only closeout commit; nothing was pushed. An unrelated `.obsidian/app.json` change remains unstaged and untouched.
- **Completed evidence:** the A04 database boundary remains green, and the seventeen-task backlog now separates generated local identity, app-owned authorization, functional local acceptance, verified Better Auth, and hosted deployment with explicit fail-closed gates.
- **Verification baseline:** `pnpm verify` passes with four API tests, package boundaries, and privacy checks; all seventeen backlog tasks contain every required planning field and canonical dependency references are reconciled. The prior six-test native PostgreSQL and integrated local-runtime A04 baseline remains current. No Docker, AWS credential/resource, real email, customer data, or private fixture was used.
- **Blocking evidence:** A05 has no external blocker and requires neither Better Auth nor AWS. A09 production DJI gates remain external and disabled. A13b verified auth must pass before A14; A14–A15 still require AWS account/spend authority and live hosted-data evidence.
- **Next technical action:** implement A05's provider-neutral identity interface, server-owned generated personas, organization/membership authorization, last-owner and Alpha/Beta tests, plus startup and route-inventory rejection in hosted mode. Do not install Better Auth or provision RDS.
- **Next external decision:** no AWS action is needed while building through A13b. Before A14, confirm an operational approved region and account/spend authority; Frankfurt is synthetic-only while UAE is not operationally suitable, and customer residency remains an explicit gate.
- **Parallel follow-up:** when cloud help becomes necessary, provide the first-time account owner one step at a time with purpose, cost/security effect, verification, and safe stop/rollback; never request secret values.
- **Privacy:** raw fixtures remain ignored and local. No raw values, coordinates, identifiers, keychain feature points, credentials, or generated parser artifacts belong in this vault.

## Workstream status

| Workstream | State | Evidence or blocker |
|---|---|---|
| P0-01 constraints and scorecard | Complete | Accepted planning assumptions, weighted quality attributes, disqualifiers, profiles, component ownership, and cost thresholds are recorded; external-spend assumptions have reconsideration gates. |
| P0-02 fixture policy and inventory | Local research gate satisfied | Policy, manifest, three private v14 logs, and one controlled truncation exist. |
| P0-03 parser/key feasibility | Complete for Phase 0 | D-009/D-012 accept the native containerized parser and trusted broker boundary; production provider and broader fixtures are safe A09 enablement gates. |
| P0-04 canonical model | Complete | Generic schema/validator, ownership/lifecycle, canonical-v1 adapter, provenance, asset evidence, capabilities, override survival, exact-normalized fingerprint, totals, deletion/restoration, and zero-flight transitions pass. |
| P0-05 organization isolation | Complete for Phase 0 | Twenty-three-table forced RLS, pooled context, API/jobs/exports/deletion, auth-claim rejection, object version purge, and backup/log/emergency boundaries support accepted D-002; live AWS conformance and restore are safe Phase 1A hosted-data gates. |
| P0-06 telemetry benchmark | Complete | Full 100,000-flight/600-million-frame object profile, six-million-row comparison, downsampling, bounded delivery, deletion, additive evolution, retained results, and cost sensitivity pass; D-008 is accepted. |
| P0-07 runtime/deployment selection | Complete | D-011/D-013/D-014 accept the modular TypeScript stack, Better Auth boundary, outbox/pg-boss, S3 lifecycle, AWS UAE environments, recovery/rollback, observability, and cost envelope. |
| P0-08 threat model | Complete | Sensitive-data inventory, privacy flow, 17 critical/high abuse cases, engineering/legal separation, owners, controls, and objective Phase 1A security gates are recorded. |
| P0-09 Phase 1A backlog | Complete; revised | The original sixteen issues passed Phase 0; D-015 now splits A13 into functional-local and verified-auth gates, yielding seventeen reviewable tasks with updated risk and dependencies. |

## Entry points

- [[product]] — product contract and acceptance behavior.
- [[roadmap]] — discovery gates and delivery increments.
- [[architecture]] — quality attributes, stack, and trust boundaries.
- [[research]] — DJI parser evidence and unresolved questions.
- [[operations]] — repository, fixture, build, and verification procedures.
- [[memory]] — how durable project context is organized.
- [[project-history]] — milestone timeline backed by Git.
- [Phase 1A backlog](../docs/roadmap/PHASE-1A-BACKLOG.md) — exact next implementation sequence.
