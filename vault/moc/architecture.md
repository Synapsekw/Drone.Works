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

- A01–A03 promote the accepted stack into a runnable, Docker-free foundation.
- A04 is the next boundary: production-named PostgreSQL migrations and forced
  organization RLS, still on native local PostgreSQL with generated data.
- Hosted RDS and AWS conformance remain A14–A15 gates.
