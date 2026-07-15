# Native Rust parser boundary proof

This directory builds a minimal native CLI around the exact upstream parser commit pinned by
[`../internal-build/source.json`](../internal-build/source.json). It is a Phase 0 release-evidence
build, not a production release artifact.

The build removes the upstream provider methods and native HTTP dependencies before compilation.
The resulting CLI:

- reads a single source path from its only argument;
- accepts validated keychains only through bounded standard input;
- emits one sanitized JSON summary;
- replaces unchecked short-record reads with I/O errors while retaining a panic guard;
- classifies truncation only when an incomplete v13+ record envelope, valid decoded prefix, and source-declared duration gap agree;
- contains no DJI credential or provider-networking path.

Build in disposable directories:

```sh
node spikes/dji-parser/native-cli/build.mjs /tmp/dji-native-work /tmp/dji-native-out
```

The build requires the exact Rust version and `cargo-cyclonedx` version pinned in
[`../internal-build/source.json`](../internal-build/source.json). It defaults to the Rust host target;
CI sets `DRONEWORKS_NATIVE_TARGET=x86_64-unknown-linux-gnu`. The output directory contains:

- the native executable and a SHA-256 artifact/input manifest;
- a normalized target-specific CycloneDX 1.5 SBOM;
- a target-specific license index, copied license texts, and third-party notices;
- a deterministic inventory of all generated evidence files.

Two clean builds can be compared with the existing recursive comparator, and the exact target graph
can be checked against RustSec with warnings denied:

```sh
node spikes/dji-parser/internal-build/compare-builds.mjs /tmp/dji-native-out-1 /tmp/dji-native-out-2
node spikes/dji-parser/internal-build/audit-target.mjs \
  /tmp/dji-native-work-1/source/Cargo.lock \
  /tmp/dji-native-out-1/sbom.cdx.json \
  deny-warnings
```

The `native-parser-build` GitHub Actions job repeats those checks on Ubuntu 24.04, uploads the evidence
bundle, and uses GitHub's `actions/attest` flow for both binary provenance and the SBOM on non-PR runs.
Production execution remains inside the Linux boundary in `../container/`; the CLI itself is not a
sandbox. The hosted Linux job and attestations must pass before this becomes a releasable artifact.

DJI v13+ logs can end with a partial record even when their declared flight duration is complete. The
wrapper therefore does not treat a short terminal envelope alone as truncation. It returns
`truncated_records` only when the envelope is incomplete, the decoded prefix passes time/coordinate/
battery validation, and decoded flight time remains more than one second short of the source-declared
total. Invalid complete envelopes and invalid decoded prefixes remain generic decode failures.
Four source-free Rust unit tests cover complete, incomplete, corrupt, and combined-evidence behavior.

## 2026-07-15 comparison

One authorized local fixture was decoded with one provider response held only in memory. The same
keychain was supplied over standard input to fresh no-network processes. Sanitized results only:

| Observation | JS/WASM child | Native Rust child |
|---|---:|---:|
| Frames | 27,228 | 27,228 |
| Decode time | 416 ms | 207 ms |
| Worker time | 435 ms | 213 ms |
| Peak RSS | 410 MB | 70 MB |

Validation flags and declared capabilities matched. A valid → controlled-truncated → valid native
sequence recovered to the same 27,228 frames. The hardened artifact classified the derivative as
`truncated_records` with exit code 2 and zero stderr; both valid operations reached effectively 100% of
their source-declared duration. The external process/container boundary remains mandatory.

Two clean `aarch64-apple-darwin` evidence builds produced 80 byte-identical files. Their target graph
contained 39 SBOM components and 39 notice-covered components; the strict RustSec target filter found
zero vulnerabilities and zero warnings. Four vulnerabilities and two warnings in unrelated packages
from the upstream workspace lockfile were excluded by exact package name and version. This is a local
tooling/reproducibility check, not a substitute for the pending Linux CI result.
