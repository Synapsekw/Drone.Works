# DJI parser evaluation

Status: in progress; external key retrieval not authorized
Candidate: `dji-log-parser-js@0.5.7`
Last updated: 2026-07-12

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

This is not yet a parser acceptance decision. Frame correctness, corrupt-file isolation, resource limits, normalization coverage, and the DJI API/key terms remain unresolved.

The local prefix/details probe is now reproducible through [`../../spikes/dji-parser/`](../../spikes/dji-parser/). Full frame correctness and record-level truncation behavior remain blocked on an authorized keychain flow.

A mock trusted keychain broker, encrypted cache, and provider boundary are also implemented. The real DJI provider and parser/keychain private IPC remain intentionally absent.

## Fixture handling

| Fixture | Storage | Bytes | Format | Encryption | Current expected outcome |
|---|---|---:|---:|---|---|
| `dji-log-001` | Local only | 9,120,603 | 14 | Keychain required | `encrypted_key_required` |
| `dji-log-002` | Local only | 6,935,019 | 14 | Keychain required | `encrypted_key_required` |
| `dji-log-003` | Local only | 3,466,091 | 14 | Keychain required | `encrypted_key_required` |
| `dji-log-001-truncated-4m` | Local only | 4,194,304 | 14 prefix detected | Keychain required | `truncated` after key retrieval |

Hashes, provenance, privacy categories, and review state are stored in [`../../fixtures/manifest.json`](../../fixtures/manifest.json). Raw and derived bytes remain under ignored `fixtures/local/` paths and are not committed.

External service processing is false for every fixture. No call to DJI or another external service was made.

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

### Alternative official library

DJI publishes [FlightRecordParsingLib](https://github.com/dji-sdk/FlightRecordParsingLib), an MIT-licensed C/C++ project whose documentation describes version 13 parsing and an App Key requirement. It remains an evaluation comparator, but its documented version scope does not yet establish support for these version 14 fixtures.

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

The combined spike suite contains 18 passing tests. Cached plaintext is available only through an explicit parser method; JSON serialization of the resolution omits keys and IVs. The in-memory AES-256-GCM cache is evidence for the contract, not the production persistence implementation.

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
- [ ] Add production hard CPU and total-memory limits in the container boundary.
- [x] Define sanitized machine-readable probe output.
- [x] Define and test separate decode-use and external-processing authorization gates.
- [x] Implement disabled/mock providers and bounded request/response validation.
- [x] Prove authenticated encrypted cache, offline hit, source revocation, and organization deletion behavior.
- [ ] Implement private parser request/keychain IPC without durable job payloads.
- [ ] Implement a mock-server-tested real provider adapter without enabling production DJI access.
- [ ] Inspect transitive source/dependency licenses and security posture.
- [ ] Compare the official DJI library on version scope, output, and operational constraints.
- [ ] Decide whether key retrieval can be authorized for these local fixtures.
- [ ] If authorized, decode frames and validate counts, duration, monotonic time, coordinates bounds, battery ranges, and capability coverage without publishing values.
- [ ] Prove that the truncated fixture fails independently and a later valid fixture still processes.
- [ ] Measure process startup, peak memory, key retrieval separately, frame decode, normalization, and output volume.
- [ ] Decide whether the JS binding is acceptable in a Node worker or whether a Rust CLI boundary is safer.
- [ ] Record acceptance, rejection, or a revised D-009 parser-isolation decision.

## Stop conditions

Pause parser acceptance if:

- key API terms or consent cannot support the intended service;
- version 14 frames cannot be decoded reliably;
- output correctness cannot be validated from authorized evidence;
- malformed input can escape the proposed process boundary;
- the parser or dependency chain has unresolved incompatible licensing;
- required keychain data cannot be stored and deleted safely.
