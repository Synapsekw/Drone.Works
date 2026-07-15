# Native Rust parser boundary proof

This directory builds a minimal native CLI around the exact upstream parser commit pinned by
[`../internal-build/source.json`](../internal-build/source.json). It is a Phase 0 comparator, not a
production release artifact.

The build removes the upstream provider methods and native HTTP dependencies before compilation.
The resulting CLI:

- reads a single source path from its only argument;
- accepts validated keychains only through bounded standard input;
- emits one sanitized JSON summary;
- converts unchecked upstream decoder panics into `parser_internal_error`;
- contains no DJI credential or provider-networking path.

Build in disposable directories:

```sh
node spikes/dji-parser/native-cli/build.mjs /tmp/dji-native-work /tmp/dji-native-out
```

Production execution remains inside the Linux boundary in `../container/`; the CLI itself is not a
sandbox. Before release, the native target still needs target-specific SBOM/notices, advisory audit,
repeatable Linux artifact verification, and a parser patch that reports clean record completion versus
unexpected EOF. Without that termination signal, a controlled truncated file can be contained and
sanitized but cannot be honestly classified as `truncated_records`.

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
sequence recovered to the same 27,228 frames. The unpatched comparator exited with Rust panic code 101
for the derivative, confirming that the production wrapper must retain the panic guard and external
process/container boundary.
