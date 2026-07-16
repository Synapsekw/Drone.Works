---
type: moc
status: active
tags: [moc/architecture]
related: ["[[00-north-star]]"]
---

# Architecture — Map of Content

- [Architecture index](../../docs/architecture/README.md)
- [Quality attributes](../../docs/architecture/QUALITY-ATTRIBUTES.md)
- [Stack scorecard](../../docs/architecture/STACK-SCORECARD.md)
- [DJI keychain boundary](../../docs/architecture/KEYCHAIN-BOUNDARY.md)
- [Canonical domain model and provenance proof](../../docs/architecture/DOMAIN-MODEL.md)
- [Organization isolation and Postgres/RLS proof](../../docs/architecture/TENANCY.md)
- [Telemetry storage benchmark and D-008 evidence](../../docs/research/TELEMETRY-BENCHMARK.md)
- [Authentication evaluation and D-013 evidence](../../docs/research/AUTHENTICATION-EVALUATION.md)
- [Accepted Phase 1A system architecture](../../docs/architecture/SYSTEM.md)
- [Security boundaries and hosted-data gates](../../docs/architecture/SECURITY-BOUNDARIES.md)
- [Threat model and privacy flow](../../docs/security/THREAT-MODEL.md)
- [Phase 1A security checklist](../../docs/security/PHASE-1A-SECURITY-CHECKLIST.md)
- [Canonical decision log](../../docs/product/DECISIONS.md)

## Current implementation boundary

- A01–A07 provide the runnable, Docker-free foundation, provider-neutral local
  identity, app-owned authorization, immutable upload, forced organization RLS,
  and atomic payload-free outbox/pg-boss dispatch.
- A08 is the next boundary: package the exact native parser supervisor behind
  strict job validation and ordinary-pool RLS reload without enabling A09
  provider access.
- A13a proves the functional local app; A13b then integrates Better Auth and
  repeats the same path before any hosted deployment.
- Hosted RDS and AWS conformance remain A14–A15 gates.
