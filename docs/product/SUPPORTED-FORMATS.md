# Supported flight-log formats

Last updated: 2026-07-17

Drone.Works enables only variants that have passed the contained parser,
key-service, normalization, privacy, and fixture-provenance gates. File contents,
not filename extensions, determine support.

| Application | Source family | Format version | Encryption | Tested aircraft class | Status |
|---|---|---:|---|---|---|
| DJI Fly | DJI TXT | 14 | DJI keychain required | Mavic 3 Enterprise | Phase 1A supported |

This row is deliberately narrow. The accepted Phase 1 product boundary includes
DJI Fly, DJI GO 4, and DJI Pilot 2, but no other application/version combination
is enabled until its exact variant passes the same gate. An unsupported family,
an unsupported version, unavailable or unauthorized key retrieval, corrupt
content, and truncated content remain distinct processing outcomes.

For encrypted v14 logs, the user must accept the versioned
[`DJI-KEYCHAIN-NOTICE.md`](DJI-KEYCHAIN-NOTICE.md) before Drone.Works may send the
bounded keychain request to DJI. The raw flight log is not sent by this step.
