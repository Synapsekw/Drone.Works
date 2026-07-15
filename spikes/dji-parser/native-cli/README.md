# Native Rust parser boundary proof

This directory builds a minimal native CLI around the exact upstream parser commit pinned by
[`../internal-build/source.json`](../internal-build/source.json). It is a Phase 0 release-evidence
build, not a production release artifact.

The build removes the upstream provider methods and native HTTP dependencies before compilation.
The resulting CLI:

- reads a single source path from its only argument;
- accepts validated keychains only through bounded standard input;
- emits a sanitized JSON summary by default;
- emits a versioned private intermediate with `--output intermediate` for trusted-worker normalization;
- replaces unchecked short-record reads with I/O errors while retaining a panic guard;
- classifies truncation only when an incomplete v13+ record envelope, valid decoded prefix, and source-declared duration gap agree;
- contains no DJI credential or provider-networking path.

The intermediate contract is defined by [`intermediate.schema.json`](intermediate.schema.json). It
contains private imported telemetry and identifiers, so it must remain inside bounded parser-to-worker
IPC and must never be logged, returned from a public API, or placed in a durable job payload. The
trusted wrapper in [`../src/keychain/native-ipc.mjs`](../src/keychain/native-ipc.mjs) verifies the
source digest and schema before making it available through a normalizer-only accessor.

```sh
/path/to/droneworks-dji-parser-cli /path/to/source --output intermediate
```

Validated keychain JSON is still supplied through bounded standard input in either mode.

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
sandbox. The CycloneDX output includes a deterministic UUIDv5-shaped serial number derived from the
normalized BOM, pinned source commit, and target so GitHub can recognize and attest it without making
repeat builds differ.

DJI v13+ logs can end with a partial record even when their declared flight duration is complete. The
wrapper therefore does not treat a short terminal envelope alone as truncation. It returns
`truncated_records` only when the envelope is incomplete, the decoded prefix passes time/coordinate/
battery validation, and decoded flight time remains more than one second short of the source-declared
total. Invalid complete envelopes and invalid decoded prefixes remain generic decode failures.
Six source-free Rust unit tests cover complete, incomplete, corrupt, combined-evidence, output-mode,
and deterministic private-intermediate behavior.

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

For the private-intermediate revision, two clean `aarch64-apple-darwin` evidence builds produced 86
byte-identical files. Their target graph contained 42 SBOM components and 42 notice-covered components;
the strict RustSec target filter found
zero vulnerabilities and zero warnings. Four vulnerabilities and two warnings in unrelated packages
from the upstream workspace lockfile were excluded by exact package name and version. The 981,472-byte
host executable has SHA-256 `53c6d965031d91f4e34e0245a084b599f55f3efe119e5e143b87e43976b95060`.

Two fresh native children produced the same material digest for the authorized fixture. Sanitized
evidence recorded 27,228 samples spanning 2,722,900 ms, a 12,698,658-byte intermediate (approximately
466 bytes per sample), a verified source digest, all seven declared capabilities, zero stderr, and
about 293 ms supervisor wall time for one intermediate operation. Raw samples and identifiers were
neither printed nor persisted.

Hosted Ubuntu run [`29398131979`](https://github.com/Synapsekw/Drone.Works/actions/runs/29398131979)
closed the platform-specific release-evidence gate at commit `6be0f8a`: 78 of 78 Linux build-output
files were byte-identical, all 38 target components passed strict RustSec enforcement, and the
evidence archive uploaded successfully. The 1,028,120-byte binary has SHA-256
`22ea490fb456b080fe50ea1bb25369be68fe318495cb55ed7652a32794ab689a`; its
[provenance](https://github.com/Synapsekw/Drone.Works/attestations/35405520) and
[SBOM](https://github.com/Synapsekw/Drone.Works/attestations/35405526) attestations were independently
verified against the expected workflow, source commit, and artifact digest.
