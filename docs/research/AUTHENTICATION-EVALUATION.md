# Authentication evaluation

Status: selected for Phase 1A
Last updated: 2026-07-16

## Decision

Use self-hosted Better Auth with PostgreSQL for users, credentials, email
verification, linked accounts, and web sessions. Drone.Works remains the only
authority for organizations, invitations, memberships, and the
owner/admin/pilot/viewer role model.

The application boundary accepts only an immutable `sessionId` and `userId`
from authentication. It deliberately discards provider organization selection
and role claims. The organization in the versioned API route, a current
Drone.Works membership, repository authorization, and PostgreSQL RLS jointly
decide access.

Better Auth must be pinned exactly during repository bootstrap. The evaluated
npm release was `better-auth@1.6.23` (MIT; registry integrity
`sha512-4vOaRd9UiKGKm9R+ej0jjU1es3MiJIiNc9Qq3VCnYqOZ4/nb5272QqTxWYoDxyUXl5x6A2x2we5KZKQO9teTQQ==`).
That is evaluation evidence, not permission to upgrade automatically.

## Comparison

| Candidate | Organization fit | Operations and local development | Portability and exit | Decision |
|---|---|---|---|---|
| Better Auth, self-hosted | Its [organization plugin](https://better-auth.com/docs/plugins/organization) demonstrates members, invitations, roles, hooks, and active-organization sessions. Drone.Works will not use those claims as authorization. | Runs with the application and a [PostgreSQL adapter](https://better-auth.com/docs/adapters/postgresql); no production identity account is required locally. The team owns email delivery, upgrades, abuse controls, and incident response. | Auth rows are in the product database and the package is MIT. The app-owned identity adapter limits replacement cost. | Selected. Use core identity/session capabilities; keep customer organization state in the canonical domain. |
| Clerk Organizations | Mature managed [invitations](https://clerk.com/docs/guides/organizations/add-members/invitations) and [roles/permissions](https://clerk.com/docs/guides/organizations/control-access/roles-and-permissions). | Lower initial auth operations, but local and production behavior depend on a managed tenant and its product limits. | Moving users, linked accounts, sessions, organizations, and role mappings has higher exit effort. Custom-role availability is pricing-plan dependent. | Rejected as the default; viable fallback if operating self-hosted auth becomes disproportionate. |
| First-party credentials and sessions | Complete control. | Drone.Works would own password storage, recovery, account linking, token theft defenses, session administration, and continuing security maintenance. | No vendor exit, but the largest security and maintenance burden. | Rejected for Phase 1. |

## Security and lifecycle contract

- Browser sessions use `HttpOnly`, `Secure`, `SameSite=Lax` cookies in hosted
  environments. State-changing routes retain CSRF protection and strict origin
  checks. Bearer tokens in the Phase 0 proof stand in only for the injected
  server-side session lookup.
- Email/password registration requires verified email before customer data
  access. Invitations are random, single-use, time-bounded domain records; the
  accepting verified email must match the normalized invite address.
- Session lookup is online for authorization-sensitive API calls. Revoked,
  expired, malformed, or unverified sessions fail as unauthenticated.
- Password change, account recovery, suspected compromise, member removal, and
  account deletion revoke relevant sessions. Membership removal independently
  blocks new organization access even if an identity session remains valid.
- Account deletion cannot orphan the final organization owner. Historical
  pilot profiles remain separate from auth users as required by the product
  contract.
- Provider callbacks and auth routes are narrow standing exceptions to the
  first-party `/api/v1/` rule. They cannot read or mutate customer domain data
  except through reviewed application services.
- Better Auth tables live outside the customer-data RLS schema. Reviewed
  migrations are generated in development, pinned, audited, and promoted by
  the migration role; production startup never applies them automatically.
- Logs contain outcome codes and opaque correlation IDs, never passwords,
  reset tokens, invitation tokens, cookies, authorization headers, or provider
  payloads.

## Executable evidence

[`spikes/postgres-rls/src/auth.mjs`](../../spikes/postgres-rls/src/auth.mjs)
implements the provider-neutral identity adapter. The native PostgreSQL suite
proves all of the following through the versioned API and the one-connection
pool:

- a provider-selected Beta organization does not grant an Alpha member access
  to Beta;
- a provider `owner` claim does not elevate a Drone.Works viewer;
- organization and role claims do not cross the identity boundary;
- session revocation immediately returns `401`;
- database membership, repository checks, and RLS continue to hide
  cross-organization resources.

Run the proof without Docker:

```sh
cd spikes/postgres-rls
npm test
```

The 2026-07-16 run passed 34 of 34 tests with no skips or failures.

## Phase 1A integration gates

Selection does not waive implementation verification. Before production use:

1. pin Better Auth and its transitive lockfile, run license/advisory review,
   and review its generated PostgreSQL migration;
2. exercise registration, verification, login, recovery, linking, revocation,
   invitation acceptance, last-owner prevention, and account deletion against
   the real adapter;
3. prove cookie, CSRF/origin, rate-limit, redirect allowlist, and email-link
   behavior in hosted integration tests;
4. document auth schema backup/restore and deletion behavior; and
5. retain the provider-neutral negative tests so replacing Better Auth cannot
   weaken organization isolation.

