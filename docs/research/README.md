# Research notes

Research documents record Phase 0 evidence before a technical choice is accepted.

- [`DJI-PARSER-EVALUATION.md`](DJI-PARSER-EVALUATION.md) tracks parser licensing, local fixture detection, encrypted-key requirements, performance observations, and unresolved gates.
- [`DJI-PARSER-SUPPLY-CHAIN.md`](DJI-PARSER-SUPPLY-CHAIN.md) audits the npm artifact, target-specific Rust dependency graph, licenses, advisories, and production remediation gates.
- [`DJI-OFFICIAL-PARSER-COMPARISON.md`](DJI-OFFICIAL-PARSER-COMPARISON.md) compares the community candidate with DJI's official C/C++ library and records the conditional Phase 1A recommendation.
- [`TELEMETRY-BENCHMARK.md`](TELEMETRY-BENCHMARK.md) records the 100,000-flight storage, replay, bounded-delivery, deletion, evolution, and cost proof supporting D-008.
- [`AUTHENTICATION-EVALUATION.md`](AUTHENTICATION-EVALUATION.md) compares self-hosted and managed identity options and records the tested session-to-authorization boundary supporting D-013.

Research findings are not decisions. Accepted technical commitments belong in [`../product/DECISIONS.md`](../product/DECISIONS.md).
