---
type: session
date: 2026-07-14-1439
branch: main
trigger: wrapup
status: blocked
tags: [session, research/dji, security/isolation, ci]
related: ["[[00-north-star]]", "[[research]]", "[[2026-07-14-1312-clean-vault-handoff]]"]
---

# Implement Linux parser containment

## What changed

- Added a fail-closed parser runner that creates one disposable Linux boundary per operation and inspects every required runtime limit before starting code.
- Added a distroless proof target and generated probes for network, filesystem, process, crash, wall-time, output, and total-memory containment.
- Added GitHub CI jobs for the Linux proof, parser tests, npm advisories, reproducible internal builds, API comparison, and RustSec auditing.
- Added eight orchestration tests and updated the research records without claiming that the unexecuted CI job is evidence.
- Preserved the no-DJI-contact boundary and kept private fixtures outside the image build context.

## Why

P0-03 needs operating-system evidence beyond the existing macOS research sandbox before D-009 can settle the production parser boundary. The implementation keeps ordinary local work free of container tooling while making the Linux proof repeatable and fail-closed in CI.

## Verification

- `npm --prefix spikes/dji-parser test`: 36 tests, 34 passed and 2 local-listener checks skipped by the outer sandbox.
- Live `npm audit --omit=dev --audit-level=high`: zero vulnerabilities.
- `node scripts/fixtures/verify-manifest.mjs`: four fixture records passed without reading raw fixture content.
- New JavaScript syntax checks, workflow YAML parsing, and `git diff --check` passed.
- The workstation has no container runtime, so the Linux namespace/cgroup proof and the CI internal rebuild were not executed locally; no DJI request was made.

## Open threads

- Review and commit the source changes, push them, and observe the first `DJI parser evidence` workflow run.
- Keep the container and CI checklist items open until that Linux run passes; then record the evidence and reconsider the JS binding versus a Rust CLI under D-009.
- Real DJI key retrieval remains unauthorized, so decoded-frame correctness, truncation behavior, and the supported v14 matrix remain blocked.

## Next session entry point

Start from [[research]], review the containment diff, then commit and run the GitHub workflow. If all three jobs pass, update the parser evaluation and supply-chain checklists with the run evidence before making any D-009 acceptance decision.
