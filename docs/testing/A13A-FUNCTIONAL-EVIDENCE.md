# A13a functional local evidence

Status: passed
Date: 2026-07-19

## Boundary

`corepack pnpm test:e2e:functional` ran on macOS with native disposable
PostgreSQL, loopback API/object/email services, the generated local identity,
an approved local-only DJI Fly v14 fixture, the reviewed digest-pinned native
parser, and the existing ignored local credential reference. Docker, Better
Auth, AWS, RDS, hosted credentials, tile/style providers, and analytics were not
used.

The uploader explicitly accepted the current encrypted-processing notice. The
trusted worker sent one bounded source-derived keychain request to the exact
allowlisted DJI endpoint; the raw log never left loopback. Private request,
response, keychain, feature-point, identifier, coordinate, digest, and fixture
values are intentionally absent from this report.

## Sanitized result matrix

| Proof                                                                                   | Result |
| --------------------------------------------------------------------------------------- | ------ |
| Generated identity browser → API → database/object → worker/parser → flight             | Passed |
| Browser domain mutations use generated `/api/v1/` client                                | Passed |
| Unapproved encrypted processing fails key-unavailable without provider access           | Passed |
| Worker killed after claim is recovered by a replacement worker                          | Passed |
| Exact byte re-upload reuses one retained flight                                         | Passed |
| Controlled corrupt derivative fails independently                                       | Passed |
| Beta cannot infer the Alpha flight by exact identifier                                  | Passed |
| MapLibre uses the provider-free style and sends no coordinate-bearing unrelated request | Passed |
| Accessible loading, terminal success, and error states                                  | Passed |
| Generated service logs contain no redaction canary                                      | Passed |
| Generated Alpha customer rows after teardown                                            | Zero   |
| Referenced Alpha raw and telemetry object versions after teardown                       | Zero   |
| Hosted local-parser and generated-identity rejection tests                              | Passed |

This evidence closes A13a only. A13b must replace the generated identity with
verified sessions and repeat the same functional and Alpha/Beta paths before
any AWS staging work begins.
