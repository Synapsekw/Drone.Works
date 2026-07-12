# DJI parser isolation spike

This disposable Phase 0 spike evaluates `dji-log-parser-js@0.5.7` against authorized local-only fixtures.

It is not production parser infrastructure. The spike uses one restricted Node.js child process per fixture and records only sanitized output. Node's permission model reduces filesystem/process access, while the current macOS spike additionally uses `sandbox-exec` to deny network access. Production parsing still requires a maintained operating-system or container isolation boundary.

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

The harness never fetches keychains. Version 13+ logs return `encrypted_key_required` after local prefix/details detection.

## Mock keychain boundary

The `src/keychain/` modules prove the trusted broker contract without contacting DJI:

- separate authorization for decode use and external processing;
- disabled and mock providers only;
- bounded request/response validation;
- AES-256-GCM encrypted in-memory cache;
- sanitized resolution objects;
- source revocation and organization deletion.

Run the same test command to exercise both parser isolation and keychain behavior. The mock implementation never uses the real fixture keychain requests or keys.

The intended production boundary is documented in [`../../docs/architecture/KEYCHAIN-BOUNDARY.md`](../../docs/architecture/KEYCHAIN-BOUNDARY.md).

## Security boundary

Each parser child starts with Node's permission model and receives only read permission for:

- the spike code and installed parser package;
- its one fixture file.

On the current macOS research host, the supervisor wraps the child with an OS sandbox profile that denies network access. If that sandbox is unavailable, the harness fails with `network_isolation_unavailable`; it does not silently continue. Node permissions separately deny filesystem writes, child processes, workers, native add-ons, WASI, FFI, and the inspector. The supervisor also supplies a minimal environment, enforces a wall-time limit, caps combined output, and does not expose child stderr contents.

These controls protect against accidents and common parser failures. `sandbox-exec` is a host-specific research mechanism, not the production choice. Production still requires a container with an unprivileged user, read-only filesystem, no network namespace, seccomp/AppArmor policy, cgroup CPU/memory limits, output quotas, and explicit termination.
