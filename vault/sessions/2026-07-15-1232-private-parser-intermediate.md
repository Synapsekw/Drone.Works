---
type: session
date: 2026-07-15-1232
branch: main
trigger: wrapup
status: complete
tags: [session, research/dji, security/isolation, architecture/provenance]
related:
  - "[[00-north-star]]"
  - "[[research]]"
  - "[[2026-07-15-1158-hosted-native-attestations]]"
---

# Validate private parser intermediate

## What changed

- Defined a versioned private DJI parser-intermediate schema and added deterministic native output for imported details, source identifiers, capabilities, and telemetry samples.
- Added a trusted IPC wrapper that independently hashes and counts source bytes, validates the complete intermediate contract and telemetry bounds, enforces input/output/time limits, and exposes raw values only to a normalizer accessor.
- Extended the controlled runner to execute one sanitized native summary plus two fresh private intermediates while returning only structural metrics and a repeatability digest.
- Validated the authorized fixture without persisting raw output: both fresh results matched across 27,228 samples, remained below the 32 MiB cap, and verified the authorized source identity.
- Recorded the refined D-009 boundary and research evidence, then committed and pushed the implementation as `cc7852c`.

## Why

P0-04 could not begin until representative parser output had a privacy-safe, deterministic handoff. The trusted worker now has a bounded and source-bound contract that preserves imported facts while keeping customer telemetry and identifiers out of logs, public errors, durable jobs, and project notes.

## Verification

- Ran the complete parser/orchestration suite outside the outer sandbox: 64 passed, zero skipped, zero failed, including real macOS network denial and trusted-source mismatch rejection.
- Ran two clean pinned-source native builds: all six Rust release tests passed in each build, 86 of 86 evidence files were byte-identical, and the 42-component target graph had zero RustSec vulnerabilities and zero warnings.
- Re-ran the authorized one-shot path after trusted-side hashing was added; the source identity, contract, bounds, capability set, duration span, output limit, zero-stderr behavior, and repeat material match all passed without printing or persisting raw telemetry.
- Hosted workflow `29400677885` passed parser tests, Linux containment, selected native repeat-build and strict audit, binary/SBOM attestations, evidence upload, and the retained JS/WASM comparison build at `cc7852c`.
- Checked JavaScript syntax, schema JSON, Rust formatting, Git whitespace, and ignored credential-file status. No Docker was used locally.

## Open threads

- Begin P0-04 by mapping the validated private intermediate into the canonical flight/provenance model with source-free synthetic tests.
- Validate broader duration and decoded coverage only when the remaining fixtures are authorized for DJI processing.
- Keep production DJI terms, notice/consent, managed-secret, retention, and deletion gates separate under D-012.

## Next session entry point

Resume from clean, synchronized `main` at `cc7852c`. Read the canonical model requirements, then implement the smallest P0-04 normalizer slice behind `PrivateIntermediate.valueForNormalizer()`, preserving imported facts, derived values, and user overrides as distinct provenance classes.
