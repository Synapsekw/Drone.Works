---
type: session
date: 2026-07-15-1309
branch: main
trigger: wrapup
status: complete
tags: [session, architecture/domain-model, architecture/provenance, research/dji]
related:
  - "[[00-north-star]]"
  - "[[architecture]]"
  - "[[roadmap]]"
  - "[[2026-07-15-1232-private-parser-intermediate]]"
---

# Prove canonical provenance mapping

## What changed

- Added the canonical domain-model draft with resource relationships, organization ownership, lifecycle and deletion rules, provenance envelopes, asset reconciliation, capabilities, duplicate evidence, and draft Phase 1A API resources.
- Implemented a private canonical-v1 adapter that consumes only a validated private intermediate and attaches parser, source, attempt, revision, and field-path provenance to important imported facts.
- Preserved unavailable and multi-battery evidence without inventing assets, separated pilot and aircraft assignment provenance, and blocked active flights without both required assignments.
- Defined explicit per-field effective-value precedence and proved that an active user override survives a later parser revision under the same canonical flight ID.
- Connected the authorized one-shot runner to the adapter and published the slice as `a3c5da6`.

## Why

The first P0-04 gate required representative parser output to become a source-independent canonical revision without losing evidence or exposing customer telemetry. This slice establishes that handoff and the core ownership model while leaving database enforcement and duplicate/lifecycle execution to focused follow-ups.

## Verification

- Ran the complete parser and canonical-model suite outside the outer sandbox: 71 passed, zero skipped, zero failed, including real macOS network denial.
- The source-free model tests cover imported provenance, explicit-offset UTC conversion, ambiguous-time review, multiple flights, missing and multiple batteries, private serialization, invalid overrides, cross-organization overrides, assignment validity, and override survival across parser revisions.
- Re-ran the authorized private path: sanitized normalization evidence reported one flight candidate, 27,228 telemetry samples, and all seven canonical capabilities without printing telemetry, identifiers, organization IDs, or source hashes.
- Hosted run `29403024703` passed parser tests, Linux containment, native repeat-build and strict audit, evidence upload, binary/SBOM attestations, and the retained comparison build at `a3c5da6`.
- Checked JavaScript syntax, Git whitespace, ignored credential state, and repository privacy patterns. No Docker was used locally.

## Open threads

- Define a generic canonical schema independent of the DJI adapter and generate a versioned exact-normalized fingerprint from it.
- Add executable deletion, restoration, and reprocessing transition proofs, including zero-flight processing outcomes.
- Use the ownership table as the input to P0-05 database-enforced tenancy proof and the telemetry shape as the input to P0-06 benchmarking.
- Keep broader fixture processing and production D-012 legal/consent/secret/retention gates separate.

## Next session entry point

Resume from the vault-only closeout commit above published source baseline `a3c5da6`. Continue P0-04 by extracting a generic canonical schema from the executable adapter, then add exact-normalized fingerprint evidence and lifecycle transition tests before starting P0-05 or P0-06.
