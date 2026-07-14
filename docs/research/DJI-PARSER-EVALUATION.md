# DJI parser evaluation

Status: in progress; one controlled fixture authorized, live disclosure blocked by host policy
Candidate: `dji-log-parser-js@0.5.7`
Last updated: 2026-07-14

## Scope

Evaluate whether the Rust `dji-log-parser` project and its JavaScript binding can anchor Drone.Works Phase 1A for the authorized local fixtures. This document records only non-sensitive results. It does not contain coordinates, serials, names, original filenames, keychain feature-point values, or decoded flight records.

## Current conclusion

The candidate is suitable for continued local evaluation:

- The project and JavaScript binding identify themselves as MIT-licensed.
- The pinned npm package can initialize all three candidate logs locally.
- All three are detected as DJI format version 14.
- General, non-sensitive details can be read without a keychain.
- Full record/frame decoding requires a DJI keychain for version 14.
- The controlled truncated file still contains enough prefix/detail data for initialization, so its failure behavior cannot be tested fully until a keychain is available.
- The official DJI comparator documents v13 only, so it does not currently displace the candidate for these v14 fixtures.

This is not yet a parser acceptance decision. Frame correctness, corrupt-file isolation, resource limits, normalization coverage, supply-chain remediation, and the DJI API/key terms remain unresolved.

The local prefix/details probe is now reproducible through [`../../spikes/dji-parser/`](../../spikes/dji-parser/). Full frame correctness and record-level truncation behavior remain blocked on an authorized keychain flow.

A trusted keychain broker, encrypted cache, private parser/keychain IPC, disabled-by-default provider adapter, and explicit one-shot research runner are implemented. The provider contract has been exercised against a loopback mock server and the real fixture request path passes a no-network dry run. The host rejected the first live transmission before process creation, so no DJI API call or decoded frame result exists yet.

The detailed [supply-chain review](DJI-PARSER-SUPPLY-CHAIN.md) and [official-library comparison](DJI-OFFICIAL-PARSER-COMPARISON.md) retain the candidate only conditionally. A reproducible private build now supplies an SBOM/notices, replaces the unmaintained target dependency, removes parser-side DJI networking, and passes the Linux containment and target-specific advisory gates in CI. Authorized frame validation and legal/key-service approval remain open.

## Fixture handling

| Fixture | Storage | Bytes | Format | Encryption | Current expected outcome |
|---|---|---:|---:|---|---|
| `dji-log-001` | Local only | 9,120,603 | 14 | Keychain required | `encrypted_key_required` |
| `dji-log-002` | Local only | 6,935,019 | 14 | Keychain required | `encrypted_key_required` |
| `dji-log-003` | Local only | 3,466,091 | 14 | Keychain required | `encrypted_key_required` |
| `dji-log-001-truncated-4m` | Local only | 4,194,304 | 14 prefix detected | Keychain required | `truncated` after key retrieval |

Hashes, provenance, privacy categories, and review state are stored in [`../../fixtures/manifest.json`](../../fixtures/manifest.json). Raw and derived bytes remain under ignored `fixtures/local/` paths and are not committed.

External service processing is explicitly authorized for the first fixture based on the repository owner's 2026-07-14 instruction. It remains false for the other two raw fixtures and the derivative. No call to DJI or another external service was made.

## Non-sensitive source observations

- `dji-log-001` and `dji-log-002` report an Android platform and application version 16.1.6. The specific application and product-type mapping remain unresolved.
- `dji-log-003` reports DJI Fly, application version 16.1.0, and a Mavic 3 Enterprise product type.

These values are parser observations, not yet independently verified source facts.

## Candidate package

### Package identity

- npm: `dji-log-parser-js@0.5.7`
- npm integrity: `sha512-Yx6eE79jgmqzZWoL8LmKXYkdAUwJa5PLJlADkkRvxt276PcTAtrj2sdJMWktmfQ7yIA5xompcGrZGu7idc441A==`
- npm tarball SHA-1 reported by npm: `937a1152d4db686fa4abecb59a26601779e87c4f`
- Package license declaration: MIT
- Runtime declaration: Node.js 18 or later
- Published package contents: README, type declarations, one bundled module, and package metadata

The [upstream repository](https://github.com/lvauvillier/dji-log-parser) describes a Rust parser with JavaScript bindings, normalized frames, and support for encrypted logs. Its README states that version 13 and later require a keychain from DJI and that retrieved keychains may be stored for later offline use.

The npm package was downloaded into temporary storage for inspection. It has not been added to the production dependency graph or lockfile.

### Internal source-build proof

[`../../spikes/dji-parser/internal-build/`](../../spikes/dji-parser/internal-build/) rebuilds the tagged source into a private Node/WebAssembly package. It pins the upstream commit and toolchain, replaces `tsify-next` with `tsify`, removes the WebAssembly HTTP implementation and `fetchKeychains` export, verifies artifact hashes and the expected API, and emits a CycloneDX SBOM plus a complete target-specific license bundle.

Two clean builds produced 104 byte-identical output files. Compared with the npm package, the only parser method removed is `fetchKeychains`; no parser method was added. The generated JavaScript and declarations contain no DJI endpoint, API-key header, or fetch binding. The internally built parser still detects each private fixture as version 14 and constructs its local keychain request. No DJI request was made.

### Alternative official library

DJI publishes [FlightRecordParsingLib](https://github.com/dji-sdk/FlightRecordParsingLib), a C/C++ project whose documentation describes version 13 parsing and an App Key requirement. Its composite license covers DJI's MIT code plus bundled curl, LibTom, OpenSSL/SSLeay, and Protobuf terms. The [comparison](DJI-OFFICIAL-PARSER-COMPARISON.md) retains it as a comparator/fallback because there is no documented v14 support or authorized result for these fixtures.

## Local detection method

The pinned JavaScript module was imported from an inspected temporary npm tarball. For each fixture, a separate Node.js process:

1. read local bytes;
2. initialized `DJILog`;
3. returned only the detected format version and selected non-sensitive general fields;
4. did not call `fetchKeychains`, `fetch`, or another network operation;
5. did not print the full `details` object because it contains sensitive identifiers and locations.

The content detector is therefore recorded as `parser_probe`, not extension-based detection.

## Isolation harness evidence

The repository spike pins `dji-log-parser-js@0.5.7` in an npm lockfile and installs it with package scripts disabled. The current npm advisory check reported zero known vulnerabilities on 2026-07-12. This is a point-in-time signal, not a source audit or future safety guarantee.

For each fixture, the supervisor:

- starts a new Node.js process;
- grants read access only to the spike/package directory and that fixture;
- denies filesystem writes, child processes, workers, native add-ons, WASI, FFI, and inspector access through Node permissions;
- wraps the process in a macOS `sandbox-exec` profile that denies network access;
- fails closed with `network_isolation_unavailable` if the host-specific network sandbox is unavailable;
- supplies a minimal environment;
- enforces wall-time, combined-output, and V8 old-space limits;
- never returns child stderr content;
- parses child output through an allowlist that discards unexpected fields.

Node's [permission-model documentation](https://nodejs.org/api/permissions.html) describes it as a defense against unintended access rather than a security boundary for malicious code. The Node 24 runtime used by this spike does not expose a network permission flag, so the harness does not rely on Node permissions for network denial. The macOS profile is research-only; production requires a Linux/container boundary with a disabled network namespace, unprivileged user, read-only filesystem, seccomp/AppArmor, and cgroup limits.

### Isolation test results

Nine parser-isolation tests pass when the outer environment permits the localhost denial test:

| Test | Evidence |
|---|---|
| Sanitized success | Unexpected coordinates and a synthetic serial field do not escape the allowlist |
| Wall-time limit | Hanging child is killed and classified `parser_wall_time_limit` |
| Output limit | Flooding child is killed and classified `parser_output_limit` |
| Memory limit | V8 heap exhaustion is classified `parser_memory_limit` without exposing stderr |
| Crash privacy | Synthetic sensitive stderr remains absent from the result |
| Network denial | Child cannot connect to a reachable parent localhost listener |
| Real parser invalid input | Generated non-DJI bytes return `invalid_or_corrupt_prefix` |
| Batch continuation | A later child succeeds after the preceding child crashes |
| Missing local fixture | Missing private bytes return `fixture_unavailable` without spawning |

The network test may be skipped only when an outer sandbox prevents the test process itself from opening a localhost listener. It was also run outside that outer restriction and passed.

### Authorized fixture probe

The four local-only fixtures completed sequentially through the OS-network-denied harness:

- total batch wall time: approximately 170 ms;
- individual supervised process wall time: approximately 40–47 ms;
- observed post-initialization RSS: approximately 70–87 MB;
- sanitized child output: 435–466 bytes per fixture;
- child stderr: zero bytes;
- result for every fixture: version 14 and `encrypted_key_required`;
- reported network isolation: `macos_sandbox_exec`.

These remain header/details measurements. RSS is an observation after initialization, not a peak-memory proof. A V8 old-space cap is not a substitute for a container RSS limit, and wall time is not a hard CPU quota.

## Mock keychain boundary evidence

The architecture and acceptance gates are documented in [`../architecture/KEYCHAIN-BOUNDARY.md`](../architecture/KEYCHAIN-BOUNDARY.md). The spike implements disabled/mock providers, bounded request/response validation, separate consent gates, an authenticated encrypted cache, sanitized result serialization, and deletion by source or organization.

Nine additional tests pass without using real fixture request values or contacting DJI:

- pre-v13 logs bypass the provider;
- decode use is independently authorized;
- a cache miss cannot construct or transmit a request without external-processing authorization;
- a valid mock response is validated and encrypted;
- a later offline cache hit does not call the provider;
- invalid requests fail before provider access;
- provider outage and rejection remain distinguishable;
- invalid responses are not cached;
- source revocation and organization deletion remove cached entries.

Cached plaintext is available only through an explicit parser method; JSON serialization of the resolution omits keys and IVs. The in-memory AES-256-GCM cache is evidence for the contract, not the production persistence implementation.

## Private parser IPC evidence

The no-network parser worker now supports two supervisor-only operations:

- request extraction returns the raw parser request only to a `PrivateKeychainRequest` accessor, while ordinary serialization contains bounded metadata;
- decode accepts a pre-validated keychain through bounded standard input in a fresh child and returns only an allowlisted validation/capability/metrics summary.

Key material is not passed through arguments, environment variables, temporary files, durable job payloads, or the returned result. Invalid keychains fail before the fixture is opened or a child is spawned. Five IPC tests exercise serialization privacy, invalid request handling, key delivery, pre-spawn validation, and the 256 KiB input bound.

The provider adapter models the documented DJI POST endpoint, `Api-Key` header, and `{ "data": ... }` envelope. Exact endpoint allowlisting, HTTPS enforcement, an explicit external-network authorization flag, pre-credential request validation, redirect rejection, runtime credential injection, end-to-end timeout, bounded response reading, and sanitized failure codes are enforced before integration. Twelve provider scenarios run against configuration checks and a loopback mock HTTP server; no DJI hostname is contacted.

The full spike runner reports 56 passing tests, including broker/cache, IPC, provider, controlled-runner, wire-identifier validation, and parser-isolation evidence. The complete suite passes outside the outer sandbox, including the mock listener and real macOS network-denial checks.

## Controlled one-shot runner evidence

The Phase 0 runner in [`../../spikes/dji-parser/src/keychain/controlled-runner.mjs`](../../spikes/dji-parser/src/keychain/controlled-runner.mjs) requires exactly one fixture ID and defaults to dry-run mode. Dry-run mode does not construct a provider or read the development credential. It builds the request in a macOS-sandboxed no-network child and serializes only request counts, sizes, process metrics, and status.

Live mode additionally requires `--allow-dji-request`, current `approved_local` or `approved_repository` review, commercial-evaluation permission, explicit external-service permission, and a non-expired review date. Only the trusted parent reads the ignored `.env.local`; the parser child receives neither the credential nor ordinary parent environment. Returned keychains would be validated, held only in an encrypted in-memory cache, passed over bounded standard input to a fresh no-network child, and destroyed before process exit.

The first fixture dry run passed with one group, nine allowlisted wire feature points, and a 3,825-byte request. An attempted live run was rejected by the host external-disclosure policy before the runner process started. Therefore provider status, keychain response shape, frame validation, truncation behavior, and decode measurements remain unknown, and no DJI request was made.

## Preliminary constructor timing

Environment:

- Node.js 24.11.1
- macOS 26.5.2
- Darwin arm64
- Parser package loaded once per process
- File bytes read before the measured constructor interval
- Five constructor iterations in one process per fixture

| Fixture | First constructor | Warm constructors 2–5 |
|---|---:|---:|
| `dji-log-001` | 6.201 ms | 1.479–1.681 ms |
| `dji-log-002` | 5.102 ms | 1.133–1.176 ms |
| `dji-log-003` | 3.420 ms | 0.484–0.553 ms |
| Truncated derivative | 3.634 ms | 0.613–0.960 ms |

These measurements cover prefix/details initialization only. They do not measure key retrieval, decryption, full record decoding, normalization, persistence, process startup, or end-to-end import time. They must not be compared with the product's 10-second import target as if the workflows were equivalent.

## Keychain request structure

Calling `keychainsRequest()` locally constructs, but does not transmit, a request object with these top-level fields:

- `version`
- `department`
- `keychainsArray`

Structural observations without feature-point values:

| Fixture | Keychain groups | Feature points | Serialized request size |
|---|---:|---:|---:|
| `dji-log-001` | 1 | 9 | 3,825 bytes |
| `dji-log-002` | 1 | 9 | 3,825 bytes |
| `dji-log-003` | 1 | 10 | 4,244 bytes |

The parser README identifies the keychain endpoint and sends the request with a DJI API key. The exact feature-point meaning, DJI retention/logging, regional processing, acceptable cache scope, revocation behavior, and commercial operating obligations require review before any request.

## DJI API terms risk

DJI's current [Flight Record API License Agreement](https://developer.dji.com/policies/flight_record/) states that API use is governed by a binding, limited, revocable license; API keys must not be shared; services are responsible for required end-user privacy notices and consents; and DJI may update the API and agreement.

Engineering implications:

- Do not embed the API key in web or parser clients.
- Do not use a developer's personal key as an undocumented production dependency.
- Obtain qualified review before commercial API use.
- Record user notice/consent behavior before transmitting keychain request data.
- Treat key retrieval as a replaceable external dependency with outage and revocation states.
- Encrypt retained keychains and bind access/deletion to the organization and raw source.

This section summarizes engineering risk and is not legal advice.

## Failure taxonomy started

The harness should distinguish at least:

- `unsupported_format`
- `unsupported_version`
- `invalid_or_corrupt_prefix`
- `missing_required_details`
- `encrypted_key_required`
- `keychain_use_not_authorized`
- `key_service_not_authorized`
- `key_service_unavailable`
- `key_service_rate_limited`
- `key_rejected`
- `invalid_keychain_request`
- `invalid_keychain_response`
- `truncated_records`
- `parser_wall_time_limit`
- `parser_output_limit`
- `parser_memory_limit`
- `parser_internal_error`

No parser error message may include raw payload, coordinates, serials, or full filenames in customer-visible details or ordinary logs.

## Remaining P0-03 work

- [x] Create a reproducible repository spike with the dependency pinned by integrity/lockfile.
- [x] Run every fixture in an independently terminable child process.
- [x] Add wall-time, output-size, and V8 old-space limits with tested failure classification.
- [x] Add production hard CPU and total-memory limits in the container boundary.
- [x] Define sanitized machine-readable probe output.
- [x] Define and test separate decode-use and external-processing authorization gates.
- [x] Implement disabled/mock providers and bounded request/response validation.
- [x] Prove authenticated encrypted cache, offline hit, source revocation, and organization deletion behavior.
- [x] Implement private parser request/keychain IPC without durable job payloads.
- [x] Implement a mock-server-tested real provider adapter without enabling production DJI access.
- [x] Implement and test a fail-closed one-shot runner with dry-run default, explicit live flag, manifest authorization, local credential injection, in-memory cache destruction, and sanitized output.
- [x] Inspect transitive source/dependency licenses and security posture.
- [x] Build the parser reproducibly from pinned source with maintained dependencies, no parser-side network API, an SBOM, and complete notices.
- [x] Compare the official DJI library on version scope, output, and operational constraints.
- [ ] Decide whether key retrieval can be authorized for all local fixtures. The first fixture is authorized; the other fixtures remain closed.
- [ ] Execute the first controlled live request; the host external-disclosure policy currently blocks process creation.
- [ ] If authorized, decode frames and validate counts, duration, monotonic time, coordinates bounds, battery ranges, and capability coverage without publishing values.
- [ ] Prove that the truncated fixture fails independently and a later valid fixture still processes.
- [ ] Measure process startup, peak memory, key retrieval separately, frame decode, normalization, and output volume.
- [ ] Decide whether the JS binding is acceptable in a Node worker or whether a Rust CLI boundary is safer.
- [ ] Record acceptance, rejection, or a revised D-009 parser-isolation decision.

### Linux containment implementation

The repository now contains a production-shaped Linux containment runner and a GitHub Actions proof job. Each parser operation receives a fresh, unprivileged boundary with a read-only root filesystem and source mount, no network namespace, all Linux capabilities dropped, `no-new-privileges`, bounded temporary storage, and hard CPU, total-memory, PID, wall-time, and output limits. The runner inspects the created boundary and refuses to start parser code if any control is absent or weakened.

The CI proof uses generated bytes only. It tests denied network, write, and child-process attempts; crash isolation; a successful operation after a crash; wall-time and output termination; and cgroup OOM classification. Local development does not require a container runtime.

[GitHub Actions run `29351324096`](https://github.com/Synapsekw/Drone.Works/actions/runs/29351324096) passed on Ubuntu 24.04 at commit `0005750`. The proof validated the boundary, classified wall-time as `timed_out`, bounded output as `output_limited`, and cgroup OOM as `memory_limited`. This closes the Linux hard-container implementation gate for D-009; parser/runtime acceptance still depends on authorized frame correctness and representative decode measurements.

## Stop conditions

Pause parser acceptance if:

- key API terms or consent cannot support the intended service;
- version 14 frames cannot be decoded reliably;
- output correctness cannot be validated from authorized evidence;
- malformed input can escape the proposed process boundary;
- the parser or dependency chain has unresolved incompatible licensing;
- required keychain data cannot be stored and deleted safely.
