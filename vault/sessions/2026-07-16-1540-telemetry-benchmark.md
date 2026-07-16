---
type: session
date: 2026-07-16-1540
branch: main
trigger: wrapup
status: complete
tags: [session, architecture/telemetry, research/benchmark, product/decision]
related:
  - "[[00-north-star]]"
  - "[[architecture]]"
  - "[[research]]"
  - "[[roadmap]]"
  - "[[2026-07-16-1517-permanent-flight-deletion]]"
---

# Complete the telemetry benchmark

## What changed

- Added a reproducible native-PostgreSQL benchmark that physically materializes 100,000 synthetic per-flight objects representing 600 million 5 Hz frames across 100 organizations.
- Added a deterministic versioned columnar reference codec, extrema/warning/gap-preserving replay, bounded full pages, additive capability evolution, active object deletion, and retained raw results.
- Compared the complete object profile with a like-for-like six-million-row partitioned PostgreSQL cohort and documented measurement boundaries and cost sensitivities.
- Accepted D-008: Phase 1 uses versioned per-flight columnar objects with PostgreSQL metadata; committed the source and canonical documentation as `373d2df`.

## Why

P0-06 was the last critical storage uncertainty before final stack selection. The full-profile evidence shows the object layout is viable for replay, export, deletion, and early cost without requiring a database time-series extension.

## Verification

- Ran two complete 100,000-flight/600-million-frame profiles and retained the final like-for-like result; the selected layout used 2.872 GB plus 32.1 MB metadata and produced a 1,000-point warm replay in 2.87 ms locally.
- Ran five telemetry correctness/result tests, 31 native PostgreSQL tenancy tests, and 78 parser/containment tests with zero skips or failures.
- Verified PostgreSQL `fsync` and full-page writes, bounded pages, summary preservation, old-codec reads, single-flight and 999-object organization deletion, syntax, dependency audit, whitespace, and privacy patterns.
- No Docker, persistent PostgreSQL service, provider network, customer data, private coordinate, credential, or raw fixture was used. The unrelated `.obsidian/app.json` change remained unstaged and untouched.

## Open threads

- Complete P0-07 stack acceptance, including authentication, job fault behavior, real object-provider selection/evidence, environments, recovery, deployment, and current cost envelope.
- Keep provider-side deletion, caches/logs/backups, production retention, and D-012 legal/terms gates explicit rather than attributing them to D-008.
- Rebenchmark D-008 only at its documented object-size, latency, memory, byte-density, budget, deletion, compatibility, or cross-flight-analytics thresholds.

## Next session entry point

Resume from `373d2df` plus this vault-only closeout. Audit D-010 and D-011 plus the stack scorecard, then close P0-07 with the smallest provider-shaped auth/job/storage/deployment/recovery evidence and accepted decisions before writing the threat model.
