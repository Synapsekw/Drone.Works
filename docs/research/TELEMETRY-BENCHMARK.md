# Telemetry storage and downsampling benchmark

Status: complete; supports accepted D-008
Last updated: 2026-07-16

## Conclusion

Phase 1 will store each immutable flight revision's full normalized telemetry as
one organization-owned, versioned, compressed columnar object, with ownership,
object identity and digest, schema/capability version, sample count, time bounds,
and material summary statistics in PostgreSQL. The default replay is derived from
that object and capped near 1,000 extrema-preserving points. Full delivery is
cursor-bounded to at most 2,000 points per page or an equivalent bounded stream.

Partitioned PostgreSQL rows are not the Phase 1 default. A time-series extension
is also deferred: the object candidate passes the required workload without a
provider-specific database extension. Both alternatives remain reconsideration
paths if later product workloads require cross-flight sample analytics.

The executable proof and retained raw result are in
[`../../spikes/telemetry-benchmark/`](../../spikes/telemetry-benchmark/). The
benchmark codec is a reference implementation of the selected layout, not a
promise that its disposable `DWTC` container becomes the production file format.
Any production codec must preserve the same versioning, privacy, lifecycle,
bounded-read, and compatibility contract and pass the same test vectors.

## Dataset and environment

The full profile physically materialized 100,000 per-flight objects across 100
organizations. Each object contains 6,000 samples: 20 minutes at 5 Hz, or 600
million represented frames. Synthetic tracks use relative metres rather than
geographic coordinates. Every flight includes a short explicit gap, one warning,
a brief altitude maximum, a brief battery minimum, and sparse missing signal.
Ten percent use additive codec version 2; version 1 remains readable.

One hundred deterministic templates limit fixture-generation cost. Every flight
still has a separate physical full-density object and metadata row. Template reuse
makes compression more repeatable than production data, so 5x and 10x byte
sensitivities are required below.

The retained run used:

- Apple M4, 10 logical CPUs, 24 GiB memory, local APFS;
- Node.js 24.11.1;
- native Homebrew PostgreSQL 18.4 with 128 MiB shared buffers, `fsync=on`, and
  `full_page_writes=on`;
- a temporary filesystem object adapter with no provider network;
- no Docker, customer data, private coordinates, credentials, or persistent
  database service.

"First application read" means the first read by the benchmark process after
ingest. The OS cache was not forcibly dropped. Warm values are the median of five
subsequent reads. Parser, provider-network, API authentication, HTTP compression,
backup deletion, and provider caches are outside the timing boundary.

## Measured result

| Measure | Columnar object + PostgreSQL metadata | Partitioned PostgreSQL rows |
|---|---:|---:|
| Actual flights / frames | 100,000 / 600,000,000 | 1,000 / 6,000,000 |
| Actual telemetry bytes | 2.872 GB | 1.418 GB |
| Projected telemetry bytes at 600M frames | 2.872 GB actual | 141.781 GB |
| PostgreSQL metadata | 32.1 MB | 0.2 MB flight rows in cohort |
| Ingest | 5.55 s objects + 1.21 s metadata | 38.06 s for 6M rows |
| First application read | 4.24 ms | 21.16 ms |
| Warm replay to 1,000 points | 2.87 ms | 9.96 ms |
| Five-minute window, 1,501 points | 1.17 ms | 2.79 ms |
| Full 6,000-point JSON delivery | 4.67 ms / 6 pages | 16.73 ms / 7 queries |
| Single-flight active deletion | 1.95 ms | 72.16 ms |
| Organization telemetry deletion | 999 objects in 59.21 ms | 9 cohort flights in 745.11 ms |

The relational byte projection is the measured 236.3 bytes per row multiplied by
600 million. Its schema contains the same route, altitude, speed, battery,
satellite, signal, gap, and warning shape as the object candidate. The projection
does not claim a 600-million-row timing and excludes database headroom, WAL,
replicas, and backup. The object result is physically measured at the full profile.

Provider request latency is absent from the object timings. The local deletion
proof removes active object bytes before metadata and demonstrates bounded work;
provider-side deletion verification, caches, logs, and backups remain D-002 and
operations responsibilities rather than hidden claims in D-008.

## Replay, gaps, and full access

The algorithm always anchors the first and last points; global and bucket minima
and maxima for altitude, horizontal speed, vertical speed, and battery; every
warning; and both sides plus the explicit samples of each gap. Tests assert that
the downsampled and full summaries have identical material extrema and warning
codes. Missing values remain `null`, never zero or interpolated facts.

The benchmark default response is 1,000 points and 311,648 uncompressed JSON
bytes. The complete 6,000-point flight is 1,881,033 uncompressed JSON bytes and is
delivered in six 1,000-point pages. The reusable API primitive rejects a page over
2,000 points. Production responses may use HTTP compression, but limits are based
on point count and decoded work rather than trusting compressed byte size alone.

Version 2 adds motor temperature. A version-1 object decoded after that addition
without a fictional temperature column, while version 2 exposed the new
capability. Database metadata must record the codec and capability set so clients
can explain absent historical data.

## Planning cost envelope

These are transparent comparison assumptions, not a provider quote or production
budget: object storage and a second copy at $0.025/GB-month each; object writes at
$5/million; reads at $0.50/million; egress at $0.09/GB; and managed database
storage at $0.115/GB-month. Compute, minimum service charges, tax, observability,
and raw source files are excluded.

| Benchmark-profile event | Usage | Planning cost |
|---|---:|---:|
| Active telemetry objects | 2.872 GB-month | $0.07/month |
| Separate backup/copy | 2.872 GB-month | $0.07/month |
| Initial object writes | 100,000 | $0.50 once |
| One replay read per flight | 100,000 | $0.05 |
| One uncompressed replay per flight | 31.165 GB egress | $2.80 |
| One uncompressed full delivery per flight | 188.103 GB egress | $16.93 |
| Projected PostgreSQL row storage | 141.781 GB-month | $16.30/month before backup/compute |

At 10x the measured object bytes, active storage is 28.72 GB and the assumed
active-plus-copy cost is about $1.44/month. This sensitivity is more useful than
the unusually smooth synthetic compression ratio. The largest variables are
actual encoded bytes per frame, source rate and flight duration, and replay/export
egress. HTTP compression can materially lower JSON egress but is not credited in
the table.

## Reconsideration thresholds

Reopen the layout or introduce chunking/row groups when any of these is observed
on representative authorized data or a production-shaped provider:

- p95 encoded object size exceeds 2 MiB or a flight exceeds 50,000 normalized
  samples, making whole-object time-window reads wasteful;
- provider-inclusive p95 default replay exceeds 500 ms or decoded worker memory
  exceeds 25 MiB per ordinary flight;
- measured encoded bytes exceed 50 bytes per frame, roughly 10x this synthetic
  result, without a documented explanation;
- telemetry object requests or egress exceed 20% of the beta infrastructure
  budget;
- organization deletion cannot clear 1,000 telemetry objects within 30 seconds or
  provider rate limits require an unbounded manual process;
- Phase 1 adds cross-flight sample-level analytics, ad-hoc time-series aggregation,
  or frequent partial reads that cannot use PostgreSQL summary metadata; or
- an additive codec version makes an older object unreadable.

If triggered, benchmark chunked columnar objects and a managed PostgreSQL
time-series extension against the same generator and provider-inclusive boundary.

## Reproduction

From `spikes/telemetry-benchmark`:

```sh
npm install --ignore-scripts
npm test
npm run benchmark:smoke
npm run benchmark
```

The final command replaces `results/benchmark.json`. It needs native PostgreSQL 18
and several gigabytes of temporary disk. It never starts Docker.
