---
type: north-star
status: active
last-updated: 2026-07-20-0943
tags: [project/drone-works, north-star]
related:
  - "[[project-history]]"
  - "[[memory]]"
  - "[[2026-07-19-0827-a13a-functional-local-gate]]"
  - "[[2026-07-20-0943-a13b-verified-auth-gate]]"
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
| Phase 1A — Walking skeleton | In progress | A01–A13b complete; verified sessions now repeat the browser-to-parser, recovery, tenancy, privacy, and destructive-cleanup path without weakening app-owned authorization. |
| Phase 1B — Trustworthy imports | Planned | Explain every batch outcome and reconcile uncertainty without silent loss. |
| Phase 1C — Operational logbook | Planned | Daily flight, fleet, replay, correction, search, and export workflow. |
| Phase 1D — Maintenance and hardening | Planned | Basic maintenance plus deletion, recovery, security, and operations gates. |

## Now

- **Phase:** Phase 1A implementation is active. A01–A13b are complete. AWS begins only at A14 and remains externally gated.
- **Branch:** `main` is synchronized with `origin/main` through A13b implementation commit `4a86db4` before this vault closeout. The unrelated `.obsidian/app.json` change and two untracked `index 2.ts` copies remain unstaged and untouched.
- **Completed evidence:** Exact pinned Better Auth now supplies verified registration, email verification, HttpOnly-cookie sessions, recovery, revocation, and deletion safeguards. App-owned invitations and current membership remain authoritative under forced RLS; hosted artifacts exclude the generated-persona endpoint and control. Both verified-session and generated-persona replays pass the real immutable upload, durable worker, parser, canonical flight, bounded MapLibre track, Alpha/Beta isolation, API/coordinate privacy, redaction, and destructive cleanup gates.
- **Verification baseline:** `pnpm test:auth`, both functional replays, `CI=true pnpm verify`, `pnpm build`, contract/privacy/boundary checks, browser hosted-exclusion, migration integrity, and the production dependency audit pass. Counts are auth 7, database 7, authorization 6, upload 8, jobs 8, normalization 6, flight API 6, web 7, and parser 21. Hosted verify run `29719523125` and parser-evidence run `29719523112` passed on `4a86db4`.
- **Blocking evidence:** A14–A15 require AWS account/region/spend authority, hosted secret/KMS deployment, real email/proxy policy, and live synthetic hosted-data evidence; none is enabled now.
- **Next technical action:** after external authority is confirmed, begin A14 with the pre-provision regional health/service-availability gate and reviewed synthetic-only staging IaC, then prove exact-digest promotion, rollback, and destroy/recreate.
- **Next external decision:** Confirm the operational AWS account, approved region, and spend authority before A14 creates any paid resource. Hosted credentials and managed-key activation remain off until that gate passes.
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
