---
type: session
date: 2026-07-19-0827
branch: main
trigger: wrapup
status: complete
tags: [session, roadmap/phase-1a, web, worker, parser, tenancy]
related:
  - "[[00-north-star]]"
  - "[[roadmap]]"
  - "[[architecture]]"
  - "[[2026-07-17-1701-a12-web-vertical-gate]]"
---

# Complete the A13a functional local gate

## What changed

- Connected the generated-persona browser path to the durable worker, trusted
  keychain broker, exact retained object, digest-pinned local native parser,
  canonical normalizer, telemetry persistence, A11 API, and MapLibre renderer.
- Added atomic current-notice approval, restartable processing stages, explicit
  source detection/failure projection, deterministic worker supervision, exact
  duplicate reuse, and local organization/object absence cleanup.
- Added `pnpm test:e2e:functional`, which proves the approved supported path,
  key-unavailable fail-closed behavior, worker kill/retry, controlled corrupt
  isolation, Alpha/Beta denial, API/network/coordinate boundaries,
  accessibility, redaction canaries, and zero generated payload after teardown.
- Updated canonical behavior, acceptance, decision, system, operations, fixture,
  backlog, and sanitized evidence documents. Pushed implementation commit
  `77779a4` to `origin/main`.

## Why

A13a closes the generated-identity walking skeleton before authentication. It
proves the real browser-to-parser path without weakening organization isolation,
fixture privacy, parser containment, or the hosted fail-closed boundary.

## Verification

- `pnpm test:e2e:functional` passed against disposable native PostgreSQL,
  loopback services, Chromium, and the approved local provider path; its
  sanitized teardown reported zero generated customer rows and referenced
  object versions.
- `CI=true pnpm verify` and `pnpm build` passed. Native suites passed with
  database 7, authorization 6, upload 8, jobs 8, normalization 6, and flight API
  6 tests; the browser gate passed 7 tests and the parser gate passed 21.
- Hosted verify run `29673161565` passed workspace/build, web, and native
  PostgreSQL jobs. Parser-evidence run `29673161557` passed parser tests,
  reproducible native/internal builds, Linux containment, OCI proof, audits,
  evidence upload, and attestations.
- Contract snapshot, package boundaries, privacy scan, staged diff check, and
  protected-file audit passed.

## Open threads

- A13b is next: integrate the pinned reviewed Better Auth package and schema,
  verified sessions, recovery, invitations, and revocation, then replay the
  unchanged functional and Alpha/Beta paths.
- Better Auth remains uninstalled, and AWS/RDS, hosted credentials, managed keys,
  and live hosted-data evidence remain gated behind A13b/A14 and later work.
- The unrelated `.obsidian/app.json` change and two untracked `index 2.ts`
  copies remain unstaged and untouched.

## Next session entry point

Start at A13b in the Phase 1A backlog. Preserve app-owned membership/RLS and the
A13a generated functional harness while replacing only the identity source with
verified sessions; do not begin A14 or enable hosted credentials.
