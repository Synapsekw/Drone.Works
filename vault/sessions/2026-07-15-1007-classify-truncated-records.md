---
type: session
date: 2026-07-15-1007
branch: main
trigger: wrapup
status: complete
tags: [session, research/dji, security/isolation, correctness]
related:
  - "[[00-north-star]]"
  - "[[research]]"
  - "[[2026-07-15-0943-select-native-parser-boundary]]"
---

# Classify truncated DJI records

## What changed

- Hardened short reads in the exact pinned native decoder source through a tracked patch, without adding provider networking.
- Added a three-signal classifier that requires an incomplete terminal record, a validated decoded prefix, and decoded time materially short of the source-declared total before returning `truncated_records`.
- Preserved the authorized valid result at 27,228 frames and proved a fresh child returns the same result after the controlled derivative is classified.
- Added four Rust release tests and updated the canonical parser evaluation and D-009 consequences in commit `90f33bd`.

## Why

The native parser boundary needed to distinguish a genuinely truncated record stream from corruption, internal failure, or a valid log with harmless terminal padding. Requiring independent envelope, prefix, and duration evidence prevents both false success and false truncation labels.

## Verification

- Rebuilt from the exact pinned public source; the tracked hardening patch applied, all four Rust release tests passed, and the release artifact built successfully.
- Ran the complete parser/orchestration suite outside the outer sandbox: 57 passed, zero skipped, zero failed.
- Ran the live valid → controlled derivative → valid sequence: 27,228 frames → `truncated_records` with exit code 2 and zero stderr → 27,228 frames, with validation and capabilities unchanged on both valid runs.
- Checked JavaScript syntax, Rust formatting, patch whitespace, repository diff integrity, and vault privacy; no Docker was used.

## Open threads

- Produce native target SBOM/notices, advisory audit, Linux artifact attestation, and CI execution evidence.
- Validate the duration threshold and decoded coverage on the remaining representative fixtures when their DJI-processing approval is available.
- Measure normalization, process startup, and output volume, then settle the remaining D-012 production gates.

## Next session entry point

Resume from commit `90f33bd`. Close the native release gates first, then validate representative intermediate output and continue into P0-04 canonical model and provenance work.
