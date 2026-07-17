---
type: session
date: 2026-07-17-1701
branch: main
trigger: wrapup
status: complete
tags: [session]
related: ["[[00-north-star]]", "[[roadmap]]", "[[architecture]]", "[[2026-07-17-1448-a11-flight-api-gate]]"]
---

# A12 web vertical gate

## What changed

- Completed A12's local-only generated-persona path through organization entry, one-file upload, processing polling, flight summary, and capability-aware MapLibre replay using only the generated `/api/v1/` client.
- Added redacted import outcomes (`result_flight_id` and bounded public failure categories), forced-RLS/API coverage, organization/persona switch cancellation and state clearing, and distinct unsupported, corrupt, key-unavailable, and authorization states.
- Kept replay coordinates in memory behind a provider-free local MapLibre style, preserved null/gap and bounded-track behavior, added a self-only CSP plus payload-free report endpoint, and proved that hosted artifacts exclude the persona control.
- Added seven Playwright browser/security/accessibility tests, expanded native API/job coverage, and updated the canonical behavior, acceptance, decision, architecture, operations, and backlog documents.
- Pushed implementation commit `1402604` and clean-checkout browser-gate fix `a465386` to `origin/main`.
- Confirmed hosted verify run `29582068895` and parser-evidence run `29581781383` passed.

## Why

A12 establishes the smallest truthful browser journey over A11 without creating a second domain boundary or weakening local identity, authorization, privacy, and replay semantics. The local worker remains health-only, so an actual parser-to-browser import is intentionally the next A13a gate rather than being overstated here.

## Verification

- `pnpm test:web` — 7 Playwright tests passed, including the upload/poll/map path, `/api/v1/` mutation boundary, coordinate privacy, persona exclusion, organization switching, distinct failures, null capability handling, axe, and CSP behavior.
- `pnpm verify`, `pnpm build`, `pnpm test:contract`, and `pnpm test:jobs` passed; native suites passed with database 7, authorization 6, upload 7, normalization 6, flight API 6, and jobs 7 tests.
- `pnpm dev:up`, `pnpm smoke:local`, and `pnpm dev:down` passed against disposable native PostgreSQL and loopback services; the live browser check showed the local identity warning and organization-entry state with no browser errors.
- Hosted verify run `29582068895` passed the web, workspace/build, and native PostgreSQL jobs; parser-evidence run `29581781383` passed all four parser jobs.
- `git diff --check` and the repository privacy scan passed before the implementation commits.

## Open threads

- A13a must connect the production parser/normalizer worker to the local browser path and prove supported, corrupt, duplicate, retry, deletion, and privacy behavior end to end.
- A13b still owns verified authentication and repeated end-to-end authorization evidence; Better Auth remains uninstalled until then.
- AWS/RDS, hosted credentials, managed keys, and live hosted-data evidence remain gated behind A14 and later milestones.
- The unrelated `.obsidian/app.json` change and two untracked `index 2.ts` copies remain unstaged and untouched.

## Next session entry point

Resume at A13a in the Phase 1A backlog. Start from the passing A12 browser gate and replace the health-only local worker path with the approved production parser/normalizer flow while retaining the generated API boundary, forced RLS, fixture privacy, and every A12 browser/security assertion.
