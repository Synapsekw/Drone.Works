---
type: session
date: 2026-07-14-2100
branch: main
trigger: wrapup
status: complete
tags: [session, research/dji, ci, security/isolation]
related: ["[[00-north-star]]", "[[research]]", "[[2026-07-14-2021-actions-billing-still-blocked]]"]
---

# Complete hosted parser proof

## What changed

- Confirmed the repository is public and restored GitHub-hosted runner execution.
- Fixed the timeout probe so its worker remains alive until the container supervisor terminates it, with a regression test.
- Added explicit Linux and macOS WASM artifact references while preserving strict checksum enforcement.
- Replaced the full-workspace RustSec failure with a tested target-SBOM intersection that still blocks every shipped-component vulnerability.
- Pushed source fixes through `0005750`, obtained green run `29351324096`, and recorded the evidence in the canonical parser research documents.

## Why

P0-03 needed executed Linux namespace, cgroup, reproducibility, and advisory evidence rather than workflow definitions alone. The green hosted run closes those implementation gates without requiring Docker on the development Mac or contacting DJI.

## Verification

- Local parser suite: 41 tests, 39 passed and two listener-dependent checks skipped by the outer sandbox.
- JavaScript syntax, workflow YAML, JSON parsing, and `git diff --check` passed during the fixes.
- GitHub run `29351324096`: `parser-tests`, `linux-containment`, and `internal-parser-build` all completed successfully on Ubuntu 24.04.
- Linux proof validated the boundary and classified wall-time, output, and cgroup OOM termination correctly.
- Two clean internal builds produced 104 byte-identical files; API comparison removed only `fetchKeychains`.
- RustSec found zero vulnerabilities and warnings in 49 shipped target components; 10 vulnerabilities and two warnings outside the target graph were excluded by exact package and version.
- No local container runtime, private fixture content, or DJI request was used.

## Open threads

- Approve or reject controlled DJI key retrieval after terms, consent, credential ownership, retention, and deletion review.
- If authorized, validate decoded frames, independent truncated-file failure, later-operation recovery, and representative resource/output measurements.
- Use that evidence to choose the JS binding or Rust CLI boundary and settle D-009; P0-04 remains waiting for representative parser output.

## Next session entry point

Start from the external key-retrieval decision. If approved, execute the existing disabled-by-default provider path under the documented privacy gates; otherwise record the rejection and reassess the candidate parser.
