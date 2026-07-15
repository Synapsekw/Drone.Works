---
type: session
date: 2026-07-15-1115
branch: main
trigger: wrapup
status: complete
tags: [session, research/dji, security/supply-chain, operations/ci]
related:
  - "[[00-north-star]]"
  - "[[research]]"
  - "[[2026-07-15-1007-classify-truncated-records]]"
---

# Add native release evidence

## What changed

- Extended the selected native build to pin its Rust/SBOM tools and emit a target-specific CycloneDX SBOM, notice/license bundle, artifact/input manifest, and deterministic evidence inventory.
- Generalized the existing compliance generator for native targets and added an advisory policy that can fail on target-specific maintenance warnings as well as vulnerabilities.
- Added a hosted Ubuntu job that builds twice, compares every evidence file, runs the strict target audit, uploads the bundle, and requests binary-provenance plus SBOM attestations.
- Updated the parser evaluation, supply-chain review, and native-build instructions with the exact local evidence and remaining hosted gate.
- Committed the engineering block as `52db979`.

## Why

D-009 selects a native binary, so the earlier JS/WASM compliance evidence was not sufficient for release. The chosen executable now has a reproducible source-to-binary evidence path and fail-closed target advisory policy; hosted Linux execution remains the final platform-specific proof.

## Verification

- Ran two clean pinned-source host-target builds; each passed four Rust release tests and produced 80 of 80 byte-identical evidence files, including the same 903,232-byte executable digest.
- Verified the SBOM and notice index each cover 39 target components and contain no disposable local build paths or provider-network markers.
- Ran the current strict RustSec target filter: zero target vulnerabilities and zero target warnings; four vulnerabilities and two warnings from unrelated lockfile packages were excluded by exact target membership.
- Ran the complete parser/orchestration suite outside the outer sandbox: 58 passed, zero skipped, zero failed.
- Checked JavaScript syntax, Rust formatting, workflow YAML parsing, diff integrity, and privacy patterns; no Docker was used locally.

## Open threads

- Push the committed workflow and verify the hosted Ubuntu evidence bundle, Linux repeatability result, binary provenance, and SBOM attestation; this working block did not push.
- Validate the duration threshold and decoded coverage on remaining representative fixtures when their DJI-processing approval is available.
- Measure normalization, process startup, and output volume, then settle the remaining D-012 production gates.

## Next session entry point

Resume from `52db979`. After an explicit push instruction and working GitHub authentication, push the local commits and inspect `native-parser-build`; if it passes, record the run and attestations, then continue with representative output and P0-04.
