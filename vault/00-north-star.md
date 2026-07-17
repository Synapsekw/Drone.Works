---
type: north-star
status: active
last-updated: 2026-07-17-1701
tags: [project/drone-works, north-star]
related:
  - "[[project-history]]"
  - "[[memory]]"
  - "[[2026-07-17-1701-a12-web-vertical-gate]]"
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
| Phase 1A — Walking skeleton | In progress | A01–A12 complete; the local generated persona can enter an organization, upload one file, observe processing, and open the authorized summary with capability-aware provider-free 2D replay. |
| Phase 1B — Trustworthy imports | Planned | Explain every batch outcome and reconcile uncertainty without silent loss. |
| Phase 1C — Operational logbook | Planned | Daily flight, fleet, replay, correction, search, and export workflow. |
| Phase 1D — Maintenance and hardening | Planned | Basic maintenance plus deletion, recovery, security, and operations gates. |

## Now

- **Phase:** Phase 1A implementation is active. A01–A12 are complete. A13a functional local completion is next; A13b then integrates verified authentication, and AWS still begins only at A14.
- **Branch:** `main` is synchronized with `origin/main` through A12 follow-up commit `a465386` before this vault closeout. The unrelated `.obsidian/app.json` change and two untracked `index 2.ts` copies remain unstaged and untouched.
- **Completed evidence:** The generated local persona now enters an organization, performs an immutable single-file upload, polls a redacted processing result, and opens the A11 summary plus capability-aware MapLibre replay entirely through the generated v1 client. Organization/persona switching aborts polling and clears state; forced RLS remains active; nulls and gaps remain truthful; the source-free local map and self-only CSP keep coordinates out of tile, style, analytics, and unrelated requests; hosted artifacts exclude the persona control.
- **Verification baseline:** Local `pnpm verify`, `pnpm build`, contract/jobs gates, the seven-test browser gate, native suites, disposable PostgreSQL/loopback smoke, and browser inspection pass. Native counts are database 7, authorization 6, upload 7, normalization 6, flight API 6, and jobs 7. Hosted verify run `29582068895` passed web, workspace/build, and native PostgreSQL jobs; parser-evidence run `29581781383` passed all four parser jobs.
- **Blocking evidence:** A13a has no external blocker. A13b verified auth must still pass before A14; A14–A15 require AWS authority, hosted secret/KMS deployment, and live hosted-data evidence.
- **Next technical action:** implement A13a's functional local application by connecting the production parser/normalizer worker to the passing A12 browser path and proving supported, corrupt, duplicate, retry, deletion, and privacy cases end to end.
- **Next external decision:** No external decision is needed through A13b. Before A14, confirm an operational approved region and account/spend authority; hosted provider credentials and managed-key activation remain off until their deployment gates pass.
- **Parallel follow-up:** when cloud help becomes necessary, provide the first-time account owner one step at a time with purpose, cost/security effect, verification, and safe stop/rollback; never request secret values.
- **Privacy:** raw fixtures remain ignored and local. No raw values, coordinates, identifiers, keychain feature points, credentials, or generated parser artifacts belong in this vault.

## Workstream status

| Workstream | State | Evidence or blocker |
|---|---|---|
| P0-01 constraints and scorecard | Complete | Accepted planning assumptions, weighted quality attributes, disqualifiers, profiles, component ownership, and cost thresholds are recorded; external-spend assumptions have reconsideration gates. |
| P0-02 fixture policy and inventory | A09 narrow gate satisfied | Policy, manifest, three approved local-only v14 logs, controlled truncation, and one representative supported-path proof exist. |
| P0-03 parser/key feasibility | Complete for narrow Phase 1A path | D-009/D-012, the native containerized parser, trusted broker, encrypted scoped cache, exact provider interlocks, and the DJI Fly/TXT v14 support row pass; broader variants remain gated. |
| P0-04 canonical model | Complete; initial production slice | A10 promotes the one-flight canonical-v1 adapter, provenance envelopes, stable aircraft evidence, assignment review, exact-normalized fingerprint, and idempotent relational revision into the production packages. |
| P0-05 organization isolation | Complete for Phase 0 | Twenty-three-table forced RLS, pooled context, API/jobs/exports/deletion, auth-claim rejection, object version purge, and backup/log/emergency boundaries support accepted D-002; live AWS conformance and restore are safe Phase 1A hosted-data gates. |
| P0-06 telemetry benchmark | Complete; initial codec and replay selected | D-008's benchmark passes; A10 adds deterministic null-preserving columnar-gzip version 1, and A11 adds exact-object verification, significant-v1 replay, bounded full pages, and payload-free metrics. Hosted provider-inclusive latency remains an A15 gate. |
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
