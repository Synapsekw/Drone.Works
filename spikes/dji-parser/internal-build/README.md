# Internal parser build

This workflow rebuilds the reviewed `dji-log-parser-js@0.5.7` source as a private Drone.Works package. It verifies the upstream commit, applies narrowly asserted hardening transformations, locks the resulting graph by checksum, builds the Node/WebAssembly package, and emits compliance evidence.

The generated package is intentionally not committed.

## Hardening

- replaces `tsify-next@0.5.3` with maintained `tsify@0.5.6`;
- removes the WebAssembly DJI HTTP client and `fetchKeychains` export;
- retains `keychainsRequest` and offline `frames(keychains)` decoding;
- verifies the generated JS, WASM, and type-declaration checksums;
- packages the upstream MIT license;
- generates a target-specific CycloneDX 1.5 SBOM with stable source references;
- bundles target-specific dependency license texts and a checksum index.

## Pinned prerequisites

- Rust 1.96.1 with `wasm32-unknown-unknown`
- wasm-pack 0.15.0
- cargo-cyclonedx 0.5.9
- Node.js 22.13 or later

Example temporary tool installation:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --version 0.15.0 --locked
cargo install cargo-cyclonedx --version 0.5.9 --locked
```

## Build

From the repository root:

```sh
node spikes/dji-parser/internal-build/build.mjs \
  spikes/dji-parser/internal-build/work \
  spikes/dji-parser/internal-build/out
```

The script refuses to overwrite either directory. Delete or archive an earlier local result explicitly before rebuilding.

Optional tool paths:

```sh
WASM_PACK_BIN=/path/to/wasm-pack \
CARGO_CYCLONEDX_BIN=/path/to/cargo-cyclonedx \
node spikes/dji-parser/internal-build/build.mjs /tmp/dji-work /tmp/dji-out
```

To prove reproducibility, build twice with distinct work/output directories and compare every emitted file:

```sh
node spikes/dji-parser/internal-build/compare-builds.mjs \
  /tmp/dji-out-1 \
  /tmp/dji-out-2
```

## Compare with the published package

```sh
node spikes/dji-parser/internal-build/compare-artifacts.mjs \
  spikes/dji-parser/node_modules/dji-log-parser-js/dji_log_parser_js.mjs \
  /tmp/dji-out/dji_log_parser_js.js
```

The expected API difference is the deliberate removal of `fetchKeychains`. Binary identity with the published npm artifact is not expected because the maintained derive/wasm-bindgen chain and network-removal patch change the compiled module.

## Output

- private Node package files;
- `artifact-manifest.json` with source, tool, API, file hashes, and sizes;
- `sbom.cdx.json`;
- `THIRD_PARTY_NOTICES.md`;
- `license-index.json`;
- `licenses/` containing the target-specific license bundle.

This remains Phase 0 evidence. It does not authorize a DJI request and does not replace the parser process/container boundary.

## CI gate

`.github/workflows/dji-parser.yml` rebuilds the internal package twice from the pinned upstream commit, compares every emitted package and compliance file, checks the deliberate API difference from the published package, and audits the hardened lockfile against the current RustSec database. The same scheduled workflow runs the npm advisory check and the separate Linux containment proof. Generated parser packages are not uploaded or committed.
