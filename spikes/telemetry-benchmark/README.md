# Telemetry storage benchmark

This disposable Phase 0 proof compares PostgreSQL partitioned sample rows with a
versioned per-flight columnar object and PostgreSQL metadata. It uses only clearly
artificial relative tracks. The benchmark profile materializes 100,000 objects,
each containing 6,000 samples: 600 million 5 Hz frames over 100 organizations.
Deterministic template reuse is disclosed in the result and reduces fixture
generation time without reducing the physical object count or represented frames.

No Docker, network service, customer data, private coordinate, or production
credential is used. PostgreSQL 18 is initialized in a temporary native data
directory and stopped and removed after the run. Object storage is represented by
a temporary local filesystem adapter, so provider latency, consistency, cache,
and request authorization remain outside this benchmark.

Run the fast correctness and smoke profiles:

```sh
npm test
npm run benchmark:smoke
```

Run and retain the full benchmark artifact:

```sh
npm run benchmark
```

The full run writes `results/benchmark.json`. It can require several gigabytes of
temporary disk while active. The row-per-sample candidate is measured on a dense
cohort and its byte size is projected linearly to 600 million rows; projected
timings are deliberately not claimed. The selected candidate and cost assumptions
belong in `docs/research/TELEMETRY-BENCHMARK.md`, not in this executable spike.
