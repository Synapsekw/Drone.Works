# DJI parser supply-chain review

Status: completed for Phase 0 JS/WASM; native hosted-attestation, legal, broader-decode, and upgrade-review gates remain
Candidate: pinned `dji-log-parser@0.5.7` behind JS/WASM and native release-evidence builds
Reviewed: 2026-07-12
Last updated: 2026-07-15

## Conclusion

The candidate can remain in the isolated Phase 0 evaluation, but the published npm artifact is not ready for production acceptance. Drone.Works now has a private, reproducible source-build workflow that addresses the immediate artifact, dependency, and compliance gaps without modifying or republishing the npm package.

The npm package has no npm dependencies and the current npm advisory service reports no known vulnerabilities. That result does not cover the Rust crates compiled into its bundled WebAssembly module. The tagged upstream WebAssembly target resolves to 51 packages: the two local parser crates plus 49 registry crates. Their declared license expressions are permissive-looking and none is missing a license declaration, but the published npm tarball omits the upstream license text and provides no SBOM or reproducible-build attestation.

The tagged target tree contains `tsify-next@0.5.3`, which RustSec classifies as unmaintained. The JS/WASM internal build replaces it with maintained `tsify@0.5.6`, removes the WebAssembly DJI HTTP client and `fetchKeychains` export, and retains local keychain-request construction plus offline decoding. The selected native build removes provider methods and native networking dependencies, emits target-specific release evidence, and passes local repeatability plus strict target advisory checks. Hosted Linux execution and attestations remain open. Production use still requires the unresolved DJI/legal gates, broader fixture evidence, and source review for each upgrade.

This review is engineering evidence, not legal advice.

## Artifact identity

| Item | Verified value |
|---|---|
| npm package | `dji-log-parser-js@0.5.7` |
| npm publication date | 2025-04-26 |
| npm integrity | `sha512-Yx6eE79jgmqzZWoL8LmKXYkdAUwJa5PLJlADkkRvxt276PcTAtrj2sdJMWktmfQ7yIA5xompcGrZGu7idc441A==` |
| npm SHA-1 | `937a1152d4db686fa4abecb59a26601779e87c4f` |
| unpacked size/files | 745,042 bytes / 4 files |
| tagged source commit | `e2e0775670a8391b4f7ecc40fca4cb01ea4a90fa` |
| tag commit date | 2025-04-26 |
| current upstream HEAD reviewed | `88fcfc96d2fcd29c6c69e9643196a37c4feb3888` |
| current HEAD date | 2025-06-07 |

Primary sources: [upstream repository](https://github.com/lvauvillier/dji-log-parser), [v0.5.7 release](https://github.com/lvauvillier/dji-log-parser/releases/tag/v0.5.7), and [tagged Cargo workspace](https://github.com/lvauvillier/dji-log-parser/blob/v0.5.7/Cargo.toml).

The release tag is more than a year old and the reviewed default branch has no commit after 2025-06-07. This is a maintenance-risk signal, not proof that the project is abandoned.

## Published npm surface

The package contains only:

- `README.md`
- `package.json`
- `dji_log_parser_js.d.ts`
- `dji_log_parser_js.mjs`

The bundled module is 703,418 bytes and includes the compiled WebAssembly payload. The npm lockfile therefore shows only one external package node and cannot enumerate the compiled Rust supply chain.

The package declares MIT and its README points to `LICENSE.txt`, but no license file is present in the four-file tarball. The upstream repository contains an MIT `LICENSE`. Before distribution, Drone.Works must obtain a reviewed notice set and either consume a corrected upstream artifact or build and package its own traceable artifact.

## Target-specific Rust dependency review

The tagged `Cargo.lock` contains 150 packages for the entire Rust workspace. That includes the CLI, native networking, exporters, and platform-specific branches that are not compiled into the Node/WebAssembly binding.

The target-specific command:

```sh
cargo tree --locked -p dji-log-parser-js \
  --target wasm32-unknown-unknown
```

resolves 51 unique packages, including the two local workspace packages and 49 external crates. Their declared license expressions are:

| Count | Declared expression |
|---:|---|
| 37 | `MIT OR Apache-2.0` |
| 6 | `MIT` |
| 2 | `MIT/Apache-2.0` |
| 1 | `(MIT OR Apache-2.0) AND Unicode-DFS-2016` |
| 1 | `Apache-2.0 OR BSL-1.0` |
| 1 | `Apache-2.0 OR MIT` |
| 1 | `BSD-3-Clause` |
| 1 | `Zlib OR Apache-2.0 OR MIT` |

No target-specific crate lacks a license declaration. A production SBOM still needs the selected license for every `OR` expression, copyright notices, source references, and the exact source-to-binary relationship.

## Advisory review

Point-in-time commands on 2026-07-12:

```sh
npm audit --json
cargo audit --file Cargo.lock --json
```

Results:

- npm reported zero known vulnerabilities because it sees the single npm package and no npm transitive dependencies;
- RustSec database commit `6e3286f4efa8c142fb33e5ea4342c8db6693cf34` reported 10 advisories and two unmaintained warnings across the 150-package workspace lockfile;
- none of the 10 advised package/version pairs appears in the resolved WebAssembly target tree;
- `tsify-next@0.5.3`, which is in the WebAssembly target tree, is covered by the unmaintained advisory `RUSTSEC-2025-0048`;
- the other unmaintained warning, `adler@1.0.2`, is outside the WebAssembly target tree.

The 10 workspace advisories affect versions of `bytes`, `idna`, `quick-xml`, `ring`, `rustls`, `rustls-webpki`, and `time`. Their absence from the target-specific tree prevents treating them as findings in the current WASM dependency graph, but it does not prove that the opaque npm bundle was reproducibly produced from that tag.

## Production acceptance gates

- [x] Replace or remove `tsify-next`, or document and approve a maintained fork.
- [x] Produce the npm/WASM artifact from a pinned source commit in Drone.Works CI.
- [x] Prove reproducibility or sign and attest the internally built artifact.
- [x] Generate an SPDX or CycloneDX SBOM for the target-specific build.
- [x] Package the upstream MIT license and all required dependency notices.
- [x] Run npm and RustSec checks on every dependency update and scheduled build.
- [ ] Review source changes between the accepted commit and every upgrade.
- [x] Keep the parser inside the independent no-network, resource-limited boundary.

The repository CI definition implements the three automation gates: it rebuilds the hardened package twice from pinned source, compares the outputs, runs npm and target-specific RustSec advisory checks, and executes the independent Linux containment proof. [GitHub Actions run `29351324096`](https://github.com/Synapsekw/Drone.Works/actions/runs/29351324096) completed all three jobs successfully on Ubuntu 24.04 at commit `0005750`.

## Internal build evidence

The repository workflow in [`../../spikes/dji-parser/internal-build/`](../../spikes/dji-parser/internal-build/) rebuilds exact upstream commit `e2e0775670a8391b4f7ecc40fca4cb01ea4a90fa` using pinned Rust 1.96.1, wasm-pack 0.15.0, and cargo-cyclonedx 0.5.9. Asserted source transformations fail closed if the reviewed upstream layout changes.

Evidence recorded on 2026-07-14:

- the hosted workflow passed parser tests, npm advisories, the Linux containment proof, the internal source build, reproducibility/API comparison, and target-specific RustSec enforcement;
- two independent clean builds produced 104 of 104 byte-identical package and compliance files;
- the generated JavaScript, WebAssembly, and declaration hashes matched their pinned reference hashes;
- the target-specific CycloneDX 1.5 SBOM contains 49 dependency components plus root metadata and stable upstream source references;
- the current RustSec scan reported no vulnerabilities or warnings in those 49 target components; 10 vulnerabilities and two warnings in unrelated native/CLI workspace dependencies were excluded by exact package name and version;
- the license index covers 50 target components, including both local crates, with no component missing a license text;
- the internal API comparison removed only `fetchKeychains` and added no parser methods;
- generated JavaScript and declarations contain no DJI endpoint, `Api-Key`, `fetchKeychains`, or WebAssembly fetch binding;
- all three private local fixtures still initialize as version 14 and construct a keychain request without transmitting it.

The generated package remains ignored and private. License overrides cover only dependency texts omitted from three crate archives; each text is stored locally with its immutable upstream URL and verified SHA-256 checksum.

Until the remaining legal, broader-decode, hosted native attestation, and upgrade-review gates pass, the published `dji-log-parser-js@0.5.7` artifact remains a disposable research dependency. The internally built package is stronger Phase 0 evidence, not yet an accepted production component.

## Native release-evidence build

The selected [`../../spikes/dji-parser/native-cli/`](../../spikes/dji-parser/native-cli/) workflow starts from the same exact upstream commit and pinned Rust 1.96.1 toolchain. It applies the reviewed short-read hardening patch, removes provider methods plus `ureq` and `async-channel`, runs the source-free truncation tests, and fails if provider-network dependencies or markers remain.

The build emits a target-specific CycloneDX 1.5 SBOM, third-party notice file, license index and copied license texts, binary/input SHA-256 manifest, and deterministic evidence inventory. The Drone.Works wrapper crate is excluded from third-party notices; the upstream parser crate and every resolved dependency remain included.

Local evidence recorded on 2026-07-15:

- two independent clean `aarch64-apple-darwin` builds produced 80 of 80 byte-identical evidence files;
- the executable was 903,232 bytes and had the same SHA-256 digest in both builds;
- the target SBOM contains 39 dependency components plus root metadata, and the notice index covers the same 39 third-party components;
- no generated evidence contains a disposable local build path or provider-network marker;
- the current RustSec scan, configured to deny both vulnerabilities and warnings, found zero findings in the 39 target components;
- four vulnerabilities and two warnings elsewhere in the upstream workspace lockfile were excluded by exact package name and version because they do not appear in the generated target SBOM.

The `native-parser-build` CI job performs the equivalent proof twice on Ubuntu 24.04 for `x86_64-unknown-linux-gnu`, uploads the evidence bundle, and uses GitHub's [artifact attestation workflow](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds) for binary provenance and the CycloneDX SBOM on non-PR runs. The job definition is present, but no hosted run of this revision exists yet; Linux reproducibility and published attestations therefore remain open.

### Native release gates

- [x] Pin the upstream source, Rust version, and SBOM generator.
- [x] Remove provider networking from source, dependencies, and the binary surface.
- [x] Generate a normalized target-specific CycloneDX SBOM and complete notice/license bundle.
- [x] Compare two independent clean output trees byte for byte.
- [x] Deny target-specific RustSec vulnerabilities and maintenance warnings.
- [x] Define Ubuntu binary/SBOM attestation and evidence-upload steps in CI.
- [ ] Run the revision on hosted Ubuntu and verify the evidence bundle plus both published attestations.
