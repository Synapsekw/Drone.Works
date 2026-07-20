# A13b verified-auth evidence

Status: passed
Date: 2026-07-20

## Boundary

`corepack pnpm test:auth` and `corepack pnpm test:e2e:local` ran on macOS with
native disposable PostgreSQL, loopback API/object/email services, generated
users and organizations, exact `better-auth@1.6.23`, and the reviewed migration.
The functional replay used the same policy-approved ignored fixture and
digest-pinned native parser as A13a. Docker, AWS, RDS, hosted credentials,
external email, tile/style providers, and analytics were not used.

Passwords, emails beyond synthetic example-domain addresses, cookies, auth
secrets, verification/recovery/invitation tokens, private coordinates,
feature-point values, source/object identifiers, and provider payloads are
intentionally absent from this report.

## Sanitized result matrix

| Proof                                                                       | Result |
| --------------------------------------------------------------------------- | ------ |
| Exact provider version, integrity, MIT license, and generated-schema drift  | Passed |
| Production dependency vulnerability audit after patched transitive pin      | Passed |
| Registration, verification, login, online session, recovery, and revocation | Passed |
| Matching-email single-use invitation and app-owned role assignment          | Passed |
| Provider organization/role claim mismatch cannot elevate access             | Passed |
| Membership removal blocks access while identity session remains live        | Passed |
| Final-owner deletion blocks; eligible account deletion removes memberships  | Passed |
| Hosted Secure/HttpOnly/SameSite cookie and CSRF/origin/redirect controls    | Passed |
| Sensitive-route rate limit and payload-free auth/domain audit checks        | Passed |
| Hosted API/web artifacts exclude generated-persona route and controls       | Passed |
| Verified-session browser → API → object/job/parser → summary/track          | Passed |
| Browser domain mutations remain under `/api/v1/`                            | Passed |
| Worker recovery, exact duplicate, corrupt failure, and Alpha/Beta isolation | Passed |
| Provider-free coordinate/network boundary and accessible terminal states    | Passed |
| Redaction-canary scan and generated Alpha organization/object purge         | Passed |
| Unchanged generated-persona A13a regression replay                          | Passed |

A13b closes the verified-identity-before-hosting gate. It does not prove AWS
deployment, hosted email delivery, trusted-proxy rate-limit configuration,
backup restore, customer-data readiness, or release readiness; those remain
A14/A15 and later gates.
