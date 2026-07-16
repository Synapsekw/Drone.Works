---
type: session
date: 2026-07-16-2145
branch: main
trigger: wrapup
status: complete
tags: [session, roadmap/phase-1a, decision, local-first]
related:
  - "[[00-north-star]]"
  - "[[roadmap]]"
  - "[[architecture]]"
  - "[[2026-07-16-2128-a04-organization-isolation]]"
---

# Sequence the functional app before auth

## What changed

- Accepted D-015: keep native local PostgreSQL, use a generated local/test-only
  identity source, and defer Better Auth until the functional app passes.
- Replaced A05 auth integration with the provider-neutral identity seam,
  app-owned membership/role checks, and hosted-mode startup interlock.
- Split A13 into A13a functional local acceptance and A13b verified Better Auth
  plus repetition of the same end-to-end and Alpha/Beta paths before AWS.
- Reconciled architecture, security, environment, auth evaluation, delivery,
  risk, and local-development documents; committed the plan as `af0e302`.

## Why

The product workflow can now be assembled and experienced locally before login,
email, cookies, or cloud operations. Authorization and forced RLS remain real
from A05 onward, while the development identity is explicitly not authentication
and cannot satisfy a hosted or release gate.

## Verification

- `corepack pnpm verify` passed, including formatting, lint, strict types, four
  API tests, package boundaries, and source privacy. The first run found stale
  duplicate files in the ignored Next.js cache; removing those generated files
  made the clean rerun pass.
- Confirmed all seventeen revised backlog tasks contain outcome, scope,
  non-goals, acceptance, dependencies, verification, contract, and operational
  fields; stale canonical A05/A13 dependency references were absent.
- Git whitespace and vault integrity checks passed. Database and integrated
  runtime tests were not rerun because this block changed planning documents
  only; the green A04 baseline remains current.
- No Docker, AWS resource or credential, real email, customer data, or private
  fixture content was used.

## Open threads

- A05 now implements only the provider-neutral identity seam, generated persona,
  organization/membership authorization, and hosted-mode rejection tests.
- A09 production DJI gates remain external and disabled. A13b remains mandatory
  before A14 can request AWS account/spend authority or deploy staging.
- The unrelated `.obsidian/app.json` change remains unstaged and untouched.

## Next session entry point

Resume at revised A05. Implement the smallest server-owned generated-persona
adapter and app-owned membership/role APIs, prove it cannot start or register a
route in hosted mode, and stop before Better Auth, uploads, or AWS.
