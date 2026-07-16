---
type: report
status: active
last-updated: 2026-07-16
tags: [project/drone-works, history]
related: ["[[00-north-star]]"]
---

# Drone.Works project history

This timeline summarizes durable milestones. Git and the linked canonical documents remain the evidence.

| Date | Commit | Milestone |
|---|---|---|
| 2026-07-12 | `f008960` | Established the focused Phase 1 product contract, observable behavior, acceptance scenarios, and decision discipline. |
| 2026-07-12 | `ac5181f` | Added the evidence-gated Phase 0 and Phase 1 delivery roadmap. |
| 2026-07-12 | `9a77265` | Proposed the modular TypeScript application stack and recorded its proof obligations. |
| 2026-07-12 | `66d5b94` | Established privacy, consent, provenance, and redistribution rules for flight-log fixtures. |
| 2026-07-12 | `ba6ec32` | Inventoried three private DJI v14 fixtures without committing raw bytes or sensitive values. |
| 2026-07-12 | `485ff36` | Proved isolated per-file parser execution, structured limits, sanitized output, and batch continuation. |
| 2026-07-12 | `bb75abe` | Defined and tested the trusted keychain broker, authorization split, encrypted cache, and deletion behavior. |
| 2026-07-12 | `451140d` | Added bounded private parser request/keychain IPC with no durable key payloads. |
| 2026-07-12 | `1192714` | Hardened the disabled-by-default DJI provider adapter against redirects, timeouts, response growth, and credential leakage. |
| 2026-07-12 | `e48f5ae` | Audited the published parser artifact, Rust dependency graph, licenses, advisories, and production gates. |
| 2026-07-14 | `d641e5f` | Added a reproducible private parser build, replaced the unmaintained dependency, removed parser-side networking, and generated SBOM/license evidence. |
| 2026-07-16 | `068aadb` | Completed Phase 0 with accepted model/isolation/parser/telemetry/stack/security decisions, safe external gates, and an ordered Phase 1A implementation backlog. |

## Current interpretation

Phase 0 is complete and Phase 1A is ready at A01. Production DJI enablement remains fail-closed under A09, and hosted customer data remains fail-closed until A14–A15 pass live AWS object and recovery gates.

Continue from [[00-north-star]] rather than extending this timeline with speculative plans.
