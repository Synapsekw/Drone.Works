---
type: north-star
status: active
last-updated: 2026-07-19-0827
tags: [project/drone-works, north-star]
related:
  - "[[project-history]]"
  - "[[memory]]"
  - "[[2026-07-19-0827-a13a-functional-local-gate]]"
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
| Phase 1A — Walking skeleton | In progress | A01–A13a complete; the generated local application now passes browser-to-parser processing, worker recovery, duplicate/corrupt isolation, tenancy, privacy, and destructive cleanup. |
| Phase 1B — Trustworthy imports | Planned | Explain every batch outcome and reconcile uncertainty without silent loss. |
| Phase 1C — Operational logbook | Planned | Daily flight, fleet, replay, correction, search, and export workflow. |
| Phase 1D — Maintenance and hardening | Planned | Basic maintenance plus deletion, recovery, security, and operations gates. |

## Now

- **Phase:** Phase 1A implementation is active. A01–A13a are complete. A13b now integrates verified authentication and repeats the functional gate; AWS still begins only at A14.
- **Branch:** `main` is synchronized with `origin/main` through A13a implementation commit `77779a4` before this vault closeout. The unrelated `.obsidian/app.json` change and two untracked `index 2.ts` copies remain unstaged and untouched.
- **Completed evidence:** The generated local persona now drives the real immutable upload, durable worker, trusted key broker, exact source, no-network parser, canonical flight, A11 summary/track, and provider-free MapLibre path. The gate proves explicit consent/fail-closed key handling, worker kill/retry, exact duplicate reuse, independent corrupt failure, Alpha/Beta isolation, API and coordinate-network boundaries, accessible states, redaction, and zero generated database/object payload after teardown.
- **Verification baseline:** `pnpm test:e2e:functional`, `CI=true pnpm verify`, `pnpm build`, contract/privacy/boundary checks, browser/hosted exclusion, and every native suite pass. Counts are database 7, authorization 6, upload 8, jobs 8, normalization 6, flight API 6, web 7, and parser 21. Hosted verify run `29673161565` and parser-evidence run `29673161557` passed on `77779a4`.
- **Blocking evidence:** A13b verified auth must pass before A14. A14–A15 require AWS authority, hosted secret/KMS deployment, and live hosted-data evidence; none is enabled now.
- **Next technical action:** implement A13b by pinning/reviewing Better Auth, adding its schema and verified session/recovery/invitation/revocation flows, excluding the generated adapter from hosted startup, and replaying the unchanged A13a functional plus Alpha/Beta gates.
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
