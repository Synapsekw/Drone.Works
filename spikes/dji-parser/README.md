# DJI parser isolation spike

This disposable Phase 0 spike evaluates `dji-log-parser-js@0.5.7` against authorized local-only fixtures.

It is not production parser infrastructure. The spike uses one restricted Node.js child process per fixture and records only sanitized output. Node's permission model reduces filesystem/process access, while the current macOS spike additionally uses `sandbox-exec` to deny network access. Production parsing still requires a maintained operating-system or container isolation boundary.

The [`internal-build/`](internal-build/) workflow separately rebuilds the reviewed upstream source into a reproducible private package, removes parser-side DJI networking, replaces the unmaintained derive dependency, and emits target-specific SBOM and license evidence. Generated build outputs remain ignored.

The [`container/`](container/) proof adds the production-shaped Linux boundary. It is intentionally executed by GitHub Actions rather than required for local development: ordinary local work remains `npm test`, with no local container runtime or manual image lifecycle. The Linux job uses a distroless Node runtime and creates one disposable container per operation; it refuses to start parser code unless runtime inspection confirms the no-network, read-only, unprivileged, capability-dropped, CPU/memory/PID-limited configuration.

## Install

```sh
cd spikes/dji-parser
npm ci --ignore-scripts
```

The dependency is pinned exactly in `package-lock.json`. Installation scripts are disabled.

## Test

```sh
npm test
```

Tests use generated temporary bytes and fake workers. They do not need or inspect private fixtures.

## Probe authorized local fixtures

From this directory:

```sh
npm run probe
```

Or from the repository root:

```sh
npm --prefix spikes/dji-parser run probe
```

The default manifest is `fixtures/manifest.json`. Missing local-only fixtures receive `fixture_unavailable`, allowing CI and contributors without private logs to run safely.

Useful options:

```text
--fixture <id>          Probe one fixture; repeatable
--timeout-ms <number>   Per-process wall-time limit (default 5000)
--max-output <number>   Combined stdout/stderr limit (default 65536)
--memory-mb <number>    V8 old-space limit (default 128)
--manifest <path>       Alternate manifest for tests/research
```

The probe command never fetches keychains. Version 13+ logs return `encrypted_key_required` after local prefix/details detection.

## Mock keychain boundary

The `src/keychain/` modules prove the trusted broker contract without contacting DJI:

- separate authorization for decode use and external processing;
- disabled and mock providers only;
- bounded request/response validation;
- AES-256-GCM encrypted in-memory cache;
- sanitized resolution objects;
- source revocation and organization deletion.
- private parser request extraction and bounded keychain delivery through standard input.
- a production-shaped provider adapter that is disabled for external HTTPS by default.

`runIsolatedKeychainRequest()` returns a non-serializing private request accessor for the trusted broker. `runIsolatedDecode()` validates mock/resolved keys before child spawn, passes them only through bounded standard input to a fresh child, and returns an allowlisted summary. Keys are not placed in arguments, environment variables, temporary files, or result JSON.

Run the same test command to exercise parser isolation, keychain behavior, and private IPC. The tests use generated request/key data and never use the real fixture keychains or contact DJI.

`DjiKeychainProvider` is not connected to the ordinary probe. Its integration tests use an explicitly enabled loopback HTTP server. The adapter requires an exact endpoint allowlist, rejects external HTTP, does not follow redirects, obtains its API credential from an injected runtime callback, bounds total request/response time and response bytes, and requires a separate flag before any external HTTPS endpoint can be enabled.

The one-shot controlled runner defaults to a no-network dry run for exactly one fixture:

```sh
npm run keychain -- --fixture dji-log-001
```

It builds the private request in a no-network child and emits only sanitized metadata. Live mode additionally requires the fixture manifest to explicitly permit external processing and reads `DJI_FLIGHT_RECORD_API_KEY` directly from the ignored repository-root `.env.local`; the credential is not inherited by the parser child. The explicit live switch is:

```sh
npm run keychain -- --fixture dji-log-001 --allow-dji-request
```

Live mode uses the exact allowlisted DJI endpoint, holds the returned keychain only in an encrypted in-memory cache for the process lifetime, sends it to a fresh no-network child over bounded standard input, destroys the cache, and emits only the broker and decode summaries. It remains a Phase 0 research command, not a production credential or persistence path.

The selected native CLI can also be exercised through the same controlled runner:

```sh
npm run keychain -- --fixture dji-log-001 --allow-dji-request --memory-mb 256 \
  --native-executable /path/to/droneworks-dji-parser-cli --normalize-proof
```

That mode runs one sanitized native summary and two fresh private-intermediate operations. It prints
only structural metrics, a material digest, source-hash verification, and whether the two results
match. The validated raw intermediate remains behind the trusted worker's `valueForNormalizer()`
accessor and is never included in ordinary JSON serialization.

`--normalize-proof` additionally feeds the first matching private intermediate to the canonical-v1
adapter. It returns only flight/sample counts, the count of eligible exact-normalized fingerprints,
and capability names; the private canonical revision remains behind `valueForPersistence()`.
`--display-timezone` can supply the trusted organization display timezone for the Phase 0 proof and
defaults to `UTC`.

An authorized primary request can drive additional offline decodes before the cache is destroyed. Each follow-up fixture must independently permit controlled local keychain use, but its metadata is not sent to DJI:

```sh
npm run keychain -- --fixture dji-log-001 --allow-dji-request --memory-mb 256 \
  --follow-up-fixture dji-log-001-truncated-4m \
  --follow-up-fixture dji-log-001
```

This sequence supports valid → truncated → valid recovery evidence with one provider call and a fresh no-network parser child for every decode.

The intended production boundary is documented in [`../../docs/architecture/KEYCHAIN-BOUNDARY.md`](../../docs/architecture/KEYCHAIN-BOUNDARY.md).

## Canonical normalization proof

[`src/normalization/canonical-v1.mjs`](src/normalization/canonical-v1.mjs) consumes only a validated
private intermediate accessor and returns a private canonical import revision. It attaches parser,
source, attempt, revision, and intermediate-path provenance to important imported fields; preserves
missing and multi-battery evidence; requires explicit organization context; and reapplies active user
overrides after parser revisions. An active canonical flight additionally requires trusted pilot and
aircraft assignments. Ordinary JSON serialization contains counts and capability names, not customer
telemetry, identifiers, organization IDs, or source hashes.

[`src/normalization/canonical.schema.json`](src/normalization/canonical.schema.json) is the generic,
vendor-neutral revision contract. [`src/normalization/canonical-model.mjs`](src/normalization/canonical-model.mjs)
validates cross-resource invariants, creates versioned exact-normalized SHA-256 evidence from
source-independent operational material, and supplies the executable import/reprocess/delete/restore/
permanent-delete state proof. The tests also cover zero-flight completion and a later parser revision
creating the first canonical flight without inventing one during the original attempt.

The model and draft Phase 1A resource shape are documented in
[`../../docs/architecture/DOMAIN-MODEL.md`](../../docs/architecture/DOMAIN-MODEL.md).

## Security boundary

Each parser child starts with Node's permission model and receives only read permission for:

- the spike code and installed parser package;
- its one fixture file.

On the current macOS research host, the supervisor wraps the child with an OS sandbox profile that denies network access. If that sandbox is unavailable, the harness fails with `network_isolation_unavailable`; it does not silently continue. Node permissions separately deny filesystem writes, child processes, workers, native add-ons, WASI, FFI, and the inspector. The supervisor also supplies a minimal environment, enforces a wall-time limit, caps combined output, and does not expose child stderr contents.

These controls protect against accidents and common parser failures. `sandbox-exec` is a host-specific research mechanism, not the production choice. Production still requires a container with an unprivileged user, read-only filesystem, no network namespace, seccomp/AppArmor policy, cgroup CPU/memory limits, output quotas, and explicit termination.

## Linux containment evidence

The `DJI parser evidence` workflow builds only the files allowlisted by `container/Containerfile.dockerignore`; private fixtures and the rest of the checkout are excluded from the build context. Its generated proof worker attempts network access, filesystem writes, and child-process creation, then exercises crash, wall-time, output, and total-memory failures. A fresh success after the crash proves that one failed operation cannot poison the next.

Before each operation, `container/run.mjs` inspects the created runtime boundary and fails closed unless all expected controls are present. It does not return child stderr content. The proof uses generated bytes and never calls DJI.

The local unit suite tests the argument construction and fail-closed inspection logic without a container runtime. The actual namespace and cgroup assertions run only on the Linux CI host.
