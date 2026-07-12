# Drone.Works

> A trustworthy operational flight record for professional drone teams.

Drone.Works turns raw drone flight logs into an explainable history of flights, pilots, aircraft, batteries, and maintenance. The product is designed around transparent imports, reliable fleet records, and portable customer data.

## Project status

Drone.Works is in the product-definition and technical-discovery stage. The repository currently contains the founding product contract; implementation has not started.

The first release is intentionally focused on small professional operators managing approximately 2–20 aircraft:

- supported DJI flight-log import with clear per-file outcomes;
- review and reconciliation of pilots, aircraft, batteries, and ambiguous timestamps;
- flight history, filtering, route replay, and essential telemetry charts;
- manual flight entry and portable exports;
- basic aircraft maintenance schedules;
- strict organization isolation and traceable corrections.

## Documentation

Start with the [documentation index](docs/README.md), then read:

1. [Product definition](docs/product/PRODUCT.md) — customer, promise, scope, and success measures.
2. [Behavioral specification](docs/product/BEHAVIOR.md) — observable domain and product rules.
3. [Phase 1 acceptance specification](docs/product/PHASE-1-ACCEPTANCE.md) — release scenarios and quality gates.
4. [Decision log](docs/product/DECISIONS.md) — accepted and proposed technical decisions.

AI-assisted contributors should also follow the repository instructions in [AGENTS.md](AGENTS.md).

The current delivery sequence and immediate technical-discovery work are defined in the [delivery plan](docs/roadmap/DELIVERY-PLAN.md) and [Phase 0 plan](docs/roadmap/PHASE-0-DISCOVERY.md).

## Product principles

- Preserve source evidence while the customer retains the record.
- Never hide uncertainty behind an automatic decision.
- Keep imported facts, derived values, and human corrections distinguishable.
- Derive operational totals from canonical flight records.
- Make customer data portable.
- Ship a small, reliable supported-format matrix before expanding coverage.

## Contributing

The project is at an early stage. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes. Product behavior changes must include corresponding updates to the behavioral and acceptance specifications.

Security-sensitive reports should follow [SECURITY.md](SECURITY.md).

## License

No open-source license has been selected yet. Until a license is added, copyright law reserves all rights to the repository owner. Third-party dependencies and test fixtures must have documented, compatible terms before they are added.
