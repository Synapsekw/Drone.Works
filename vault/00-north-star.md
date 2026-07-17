---
type: north-star
status: active
last-updated: 2026-07-17-0851
tags: [project/drone-works, north-star]
related:
  - "[[project-history]]"
  - "[[memory]]"
  - "[[2026-07-17-0851-a08-hosted-gate]]"
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
| Phase 1A — Walking skeleton | In progress | A01–A08 complete; A09 is blocked on qualified provider/key approval or an authorized supported unencrypted variant. |
| Phase 1B — Trustworthy imports | Planned | Explain every batch outcome and reconcile uncertainty without silent loss. |
| Phase 1C — Operational logbook | Planned | Daily flight, fleet, replay, correction, search, and export workflow. |
| Phase 1D — Maintenance and hardening | Planned | Basic maintenance plus deletion, recovery, security, and operations gates. |

## Now

- **Phase:** Phase 1A implementation is active. A01–A08 are complete. A09 is the current external enablement gate; A10–A13a follow only after one authorized supported parsing path exists, A13b then integrates verified authentication, and AWS still begins only at A14.
- **Branch:** `main` is synchronized with `origin/main` at canonical A08 completion commit `3499031` before this vault-only closeout commit. The unrelated `.obsidian/app.json` change remains unstaged and untouched.
- **Completed evidence:** The exact A08 Linux binary and rootless production OCI path passed hosted parser tests, retained containment, reproducibility, target-only RustSec, release verification, execution/cleanup, three attestations, and evidence upload. Clean-checkout workspace verify/build and disposable PostgreSQL database, authorization, upload, and jobs suites also pass after CI dependency/setup corrections.
- **Verification baseline:** Hosted parser run `29555481380` and verify run `29555765264` are green. The shipped Linux SBOM contains 41 target components with zero target RustSec vulnerabilities or warnings; eleven parser host tests, four API contract tests, and six tests in each native authorization/upload/jobs suite pass. No private fixture, customer data, Better Auth, provider access, AWS/RDS resource, or credential was used.
- **Blocking evidence:** A09 production DJI support remains disabled until qualified D-012 provider/key approval or an authorized supported unencrypted variant exists. A13b verified auth must pass before A14; A14–A15 still require AWS authority and live hosted-data evidence.
- **Next technical action:** enter A09 only after confirming one authorized path, then prove its representative contained decode and public support matrix before A10 normalization. If neither path is available, record A09 as externally blocked and keep support disabled.
- **Next external decision:** A09 needs either qualified D-012 provider/key approval or an authorized supported unencrypted variant before the walking skeleton can claim parsing support. No AWS action is needed through A13b; before A14, confirm an operational approved region and account/spend authority.
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
