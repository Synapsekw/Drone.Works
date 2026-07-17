---
type: north-star
status: active
last-updated: 2026-07-17-1009
tags: [project/drone-works, north-star]
related:
  - "[[project-history]]"
  - "[[memory]]"
  - "[[2026-07-17-1009-a09-v14-keychain-gate]]"
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
| Phase 1A — Walking skeleton | In progress | A01–A09 complete; the narrow DJI Fly/TXT v14 path is supported and A10 normalization/persistence is next. |
| Phase 1B — Trustworthy imports | Planned | Explain every batch outcome and reconcile uncertainty without silent loss. |
| Phase 1C — Operational logbook | Planned | Daily flight, fleet, replay, correction, search, and export workflow. |
| Phase 1D — Maintenance and hardening | Planned | Basic maintenance plus deletion, recovery, security, and operations gates. |

## Now

- **Phase:** Phase 1A implementation is active. A01–A09 are complete. A10 normalization/persistence, A11 flight APIs, A12 web, and A13a functional local completion follow; A13b then integrates verified authentication, and AWS still begins only at A14.
- **Branch:** `main` is synchronized with `origin/main` at canonical A09 completion commit `7136bd8` before this vault-only closeout commit. The unrelated `.obsidian/app.json` change remains unstaged and untouched.
- **Completed evidence:** The approved narrow DJI Fly/TXT v14 path now has a provider-neutral broker, exact provider interlocks, versioned notice/consent, encrypted organization/source-scoped PostgreSQL cache, forced RLS and pooled isolation, fresh no-network native parsing, deterministic normalization evidence, and a public support row. No browser/provider control route was added.
- **Verification baseline:** Hosted parser promotion `29558470922` and branch-tip rerun `29558887448` are green, including reproducibility, strict target audit, pinned release verification, OCI execution/cleanup, evidence upload, and three attestations. Hosted verify runs `29558470853` and `29558887491`, local workspace verify/build, seven database tests, six authorization/upload/jobs tests each, 20 production parser tests, 78 retained spike tests, and twice-six native Rust tests pass.
- **Blocking evidence:** A10 has no remaining A09 external blocker. A13b verified auth must still pass before A14; A14–A15 require AWS authority, hosted secret/KMS deployment, and live hosted-data evidence.
- **Next technical action:** implement A10's idempotent normalize-and-persist path by composing the completed job, parser/keychain, canonical-v1, relational revision, and telemetry object boundaries with Alpha/Beta, duplicate, assignment-review, rollback, and retry tests.
- **Next external decision:** No external decision is needed through A13b. Before A14, confirm an operational approved region and account/spend authority; hosted provider credentials and managed-key activation remain off until their deployment gates pass.
- **Parallel follow-up:** when cloud help becomes necessary, provide the first-time account owner one step at a time with purpose, cost/security effect, verification, and safe stop/rollback; never request secret values.
- **Privacy:** raw fixtures remain ignored and local. No raw values, coordinates, identifiers, keychain feature points, credentials, or generated parser artifacts belong in this vault.

## Workstream status

| Workstream | State | Evidence or blocker |
|---|---|---|
| P0-01 constraints and scorecard | Complete | Accepted planning assumptions, weighted quality attributes, disqualifiers, profiles, component ownership, and cost thresholds are recorded; external-spend assumptions have reconsideration gates. |
| P0-02 fixture policy and inventory | A09 narrow gate satisfied | Policy, manifest, three approved local-only v14 logs, controlled truncation, and one representative supported-path proof exist. |
| P0-03 parser/key feasibility | Complete for narrow Phase 1A path | D-009/D-012, the native containerized parser, trusted broker, encrypted scoped cache, exact provider interlocks, and the DJI Fly/TXT v14 support row pass; broader variants remain gated. |
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
