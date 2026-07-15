# DJI official parser comparison

Status: completed for Phase 0
Compared: 2026-07-12

## Recommendation

Continue evaluating `dji-log-parser-js@0.5.7` for Phase 1A. Do not select DJI `FlightRecordParsingLib@v1.0.6` as the primary parser on current evidence.

This is a conditional feasibility recommendation, not production acceptance of the community parser. The first authorized v14 fixture now passes bounded frame validation and truncation recovery, while broader fixture coverage, memory/runtime packaging, and the production key-service/legal gates remain open.

## Comparison

| Criterion | Community Rust/JS candidate | DJI official library |
|---|---|---|
| Ownership | Community project by Luc Vauvillier | DJI SDK repository |
| Reviewed release | `v0.5.7`, 2025-04-26 | `v1.0.6`, 2024-04-12 |
| Documented format scope | Claims all versions, including encrypted v13+ | Explicitly documents flight-record version 13 |
| Local fixture evidence | Initializes all three local v14 candidates; the first authorized fixture decodes 27,228 bounded frames and survives a valid-truncated-valid recovery sequence | No documented v14 support and not run because it requires an App Key |
| Output model | Normalized Rust `Frame` exposed through JS/WASM | 10 Hz standardized C++/Protobuf frame model |
| Key-service boundary | Can construct a request locally and accept offline keychains; Drone.Works isolates provider access | Library architecture includes curl/OpenSSL communication with DJIService and accepts an App Key |
| Runtime integration | ESM/Node binding around bundled WASM | Native C/C++, CMake, platform builds, Protobuf, and bundled native libraries |
| Process isolation fit | Already proven in the no-network child harness | Would require a new native build, wrapper, and equivalent container proof |
| Published dependency visibility | Opaque npm/WASM artifact; 49 target-specific external Rust crates in tagged source | Source/vendors curl 7.65.1, OpenSSL 1.1.1, LibTomCrypt 1.18.0, LibTomMath 1.0.1, and Protobuf 3.21.12 |
| Licensing | Upstream MIT; npm tarball omits referenced license text; dependency notices still required | Composite notice: DJI MIT plus curl, LibTom, OpenSSL/SSLeay, and BSD-3-Clause Protobuf terms |
| Current fit | Best available candidate for continued v14 evaluation | Comparator/fallback only until DJI documents or demonstrates v14 support |

Primary sources: [community parser](https://github.com/lvauvillier/dji-log-parser), [DJI official README](https://github.com/dji-sdk/FlightRecordParsingLib), [DJI v1.0.6 release notes](https://github.com/dji-sdk/FlightRecordParsingLib/blob/v1.0.6/ReleaseNote.md), and [DJI composite license](https://github.com/dji-sdk/FlightRecordParsingLib/blob/v1.0.6/LICENSE.txt).

## Why official ownership is not sufficient

The official repository is valuable evidence and may provide better protocol fidelity for its supported scope. It does not currently close the Phase 1A feasibility gap:

- its README states version 13 rather than version 14;
- the local fixtures are detected as version 14;
- its documented entry point requires an App Key, so there is no authorized fixture result;
- its networking and credential behavior would have to be separated or contained to preserve D-009;
- the native build and vendored third-party versions create a separate supply-chain and patching obligation.

The v1.0.6 notes include fixes for Mavic 3 Enterprise and M350 RTK fields, which is relevant to the fleet domain, but they do not expand the documented file-version scope beyond v13.

## Deployment direction if the candidate succeeds

The current Node/WASM child is acceptable for continued research because it is independently terminable, no-network, bounded, and produces sanitized output. It should not automatically become the production distribution.

Now that authorized v14 decoding succeeds, compare two production packaging options from the same reviewed source:

1. an internally built and attested WASM binding with a complete SBOM; or
2. a minimal Rust executable/library wrapper with all provider networking removed and the native dependency graph upgraded and re-audited.

Choose between them using measured startup/RSS/throughput, patchability, SBOM quality, and isolation—not language preference.

## Reconsideration triggers

Re-evaluate the official library if DJI:

- documents v14 support;
- supplies an authorized way to test these fixtures;
- separates local parsing from external key retrieval; or
- releases a maintained package with a clearer, current dependency and platform story.
