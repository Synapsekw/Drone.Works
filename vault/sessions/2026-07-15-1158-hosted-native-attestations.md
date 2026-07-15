---
type: session
date: 2026-07-15-1158
branch: main
trigger: wrapup
status: complete
tags: [session, research/dji, security/supply-chain, operations/ci]
related:
  - "[[00-north-star]]"
  - "[[research]]"
  - "[[roadmap]]"
  - "[[2026-07-15-1115-native-release-evidence]]"
---

# Verify hosted native attestations

## What changed

- Pushed the accumulated P0-03 work and executed the native release-evidence workflow on hosted Ubuntu without using Docker on the development Mac.
- Added a deterministic CycloneDX serial number so GitHub accepts the normalized SBOM, and made evidence upload run even when an earlier release step fails.
- Verified the downloaded Linux evidence, binary digest, target-specific RustSec result, provenance signature, and SBOM signature independently.
- Updated the canonical parser evaluation, supply-chain review, and native-build instructions with the exact hosted result.
- Committed the SBOM fix as `6be0f8a` and the canonical evidence as `37e7d82`; `main` and `origin/main` now agree.

## Why

D-009 requires executed platform evidence, not only a local build or CI definition. The successful hosted proof closes the native Linux reproducibility, evidence-upload, strict target advisory, provenance, and SBOM-attestation gates while keeping private fixture material out of GitHub.

## Verification

- GitHub Actions run `29398131979` passed parser tests, Linux containment, two native Linux builds, the internal comparator, strict advisory enforcement, both attestations, and evidence upload.
- The native Linux comparison reported 78 of 78 build-output files byte-identical; the 38-component target graph had zero target vulnerabilities and zero target warnings.
- The downloaded 591,415-byte evidence archive matched all 77 hashes in its deterministic inventory and contained no disposable absolute paths or credential markers.
- The 1,028,120-byte executable matched its manifest digest, and GitHub CLI verification bound both signed claims to the exact workflow, source commit, and artifact digest.
- Final-head run `29398755562` passed all four jobs again after the canonical evidence commit.

## Open threads

- Define and validate a privacy-safe representative intermediate parser output using the already authorized fixture, including process-startup and output-volume measurements.
- Validate duration and decoded coverage on the remaining fixture matrix only if their DJI-processing permission is opened.
- Resolve the remaining production D-012 legal, notice/consent, managed-secret, retention, and deletion gates.

## Next session entry point

Resume from `37e7d82` on clean `main`. Use the authorized fixture to settle the sanitized intermediate-output contract and measurements, then begin P0-04 canonical model and provenance mapping without waiting for UI implementation.
