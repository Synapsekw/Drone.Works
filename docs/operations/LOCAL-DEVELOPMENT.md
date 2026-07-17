# Local development without Docker

Status: accepted Phase 1A foundation
Last updated: 2026-07-17

This workflow runs only on your Mac. It does not create anything in AWS, ask for
cloud credentials, use Docker, send real email, or load customer data. The seed
record is generated and safe to delete.

## One-time setup

1. Open Terminal and go to the repository:

   ```sh
   cd /path/to/Drone.Works
   ```

2. Confirm the pinned Node version:

   ```sh
   node --version
   ```

   It must print `v24.11.1`. If it does not, stop and install/select the version
   in `.node-version` with your Node version manager.

3. Confirm native PostgreSQL 18 is present:

   ```sh
   /opt/homebrew/opt/postgresql@18/bin/postgres --version
   ```

   On an Apple Silicon Mac, if that file is missing, install it with:

   ```sh
   brew install postgresql@18
   ```

   Intel Homebrew normally uses `/usr/local/opt/postgresql@18/bin`. The local
   script checks both locations. PostgreSQL is started with a private Unix
   socket and does not listen on the network.

4. Install the exact reviewed dependencies:

   ```sh
   corepack pnpm install --frozen-lockfile
   ```

5. Verify and build the clean workspace:

   ```sh
   corepack pnpm verify
   corepack pnpm build
   ```

6. Verify the production PostgreSQL/RLS boundary separately:

   ```sh
   corepack pnpm test:database
   ```

   This creates a temporary socket-only PostgreSQL cluster, runs generated
   Alpha/Beta isolation tests, and removes the cluster. It does not use your
   Homebrew service database.

7. Verify the production parser host boundary without Docker:

   ```sh
   corepack pnpm test:parser:host
   ```

   This builds the parser supervisor, runs generated boundary/failure/private
   intermediate tests, and verifies the pinned release inputs. It does not run
   an OCI container. The exact production image and retained hard-containment
   suite run only in hosted Linux CI; a local pass cannot promote an image.

## Start and check the local application

1. Start the generated local database and all loopback services:

   ```sh
   corepack pnpm dev
   ```

   `corepack pnpm dev:up` is the equivalent explicit lifecycle command.

   The final line prints the local web address. The port is chosen automatically
   so it does not collide with another project. Startup applies the same
   checksum-pinned customer and jobs migrations used by the database tests,
   creates two generated organizations, and enables the server-owned Alpha/Beta
   persona control. The
   persona control is not a login and exists only in this local process.

2. In the same or another Terminal window, check web, API, worker, object,
   email, and PostgreSQL together:

   ```sh
   corepack pnpm smoke:local
   ```

3. Stop everything when finished:

   ```sh
   corepack pnpm dev:down
   ```

   This stops the processes and removes `.drone-works/local`, including the
   generated database. Running the stop command again is safe.

## What is running

- `web`: the A12 local-only persona, organization, single-file upload/status,
  flight-summary, and provider-free MapLibre path;
- `api`: the versioned `/api/v1/health` contract;
- `dispatcher`: leases payload-free outbox rows and sends stable pg-boss jobs;
- `worker`: the future parser/background-work boundary;
- `objects`: a loopback placeholder for future versioned file storage;
- `email`: a loopback placeholder that never sends a message;
- `PostgreSQL`: a disposable native database with the reviewed customer and jobs
  schemas, their separate migration ledgers, and generated Alpha/Beta
  organization records.

The API receives only an opaque token issued for a named server-owned persona.
It resolves the generated user ID on the server, then reloads the current
membership and role from PostgreSQL for every organization operation. The
browser cannot provide a user ID, organization, membership, or role claim to the
persona control. `smoke:local` exercises this identity-to-membership path.

Run the complete A05 configuration, role, membership, Alpha/Beta, exact-ID, and
pooled-connection gate against another disposable native cluster with:

```sh
corepack pnpm test:authorization
```

Run the complete A07 atomic dispatch, retry, cancellation, tenant-swap, metrics,
and pooled-context gate with:

```sh
corepack pnpm test:jobs
```

Run the A12 hosted-exclusion, production-browser, accessibility, CSP, API
boundary, organization-switch, failure wording, and coordinate-privacy gate
with:

```sh
corepack pnpm test:web
```

This command builds both hosted and explicitly local web variants, then uses
Chromium against generated API responses. It never uses a tile/style provider,
customer file, cloud credential, or external analytics endpoint. Install the
pinned Playwright Chromium runtime once with
`corepack pnpm --filter @drone-works/web exec playwright install chromium` if
the local browser binary is absent.

Run the A10 canonical normalization, assignment, exact-duplicate, telemetry
checksum, object/transaction retry, real job retry, and Alpha/Beta gate with:

```sh
corepack pnpm test:normalize
```

This gate uses another disposable native PostgreSQL cluster, the real pg-boss
queue boundary, generated private intermediate values, and an in-memory
immutable-object adapter. It uses no Docker, provider request, private fixture,
or hosted resource.

The A07 test creates its own socket-only PostgreSQL cluster and loopback object
service. A growing pending count or oldest-pending age means the dispatcher is
not completing leases; repeated retry or dead-letter growth means the worker or
its dependency is failing. Stop claiming new work, preserve the payload-free
aggregate counts, and inspect error names and deployment/migration health—never
copy durable job payloads, filenames, hashes, object keys, or customer content
into incident logs. Restarting is safe: expired dispatcher leases are reclaimed,
and stable queue IDs suppress a duplicate after a post-send crash.

The production database schema, row-level organization isolation, and A05
app-owned authorization boundary are now present locally. The generated
identity cannot start or register its control in hosted modes. Better Auth is
deliberately deferred to A13b, after the functional local application passes,
and AWS remains deferred to A14. No AWS help is needed for this foundation. When
A14 reaches the cloud setup, the account-owner steps will be provided one at a
time with their purpose, expected cost/security effect, a verification check,
and a safe stop or rollback step.

The A12 web can upload to the local immutable-source and queue boundaries and
can open the generated retained A11 flight when given its flight ID. The local
worker remains a health-only process until A13a connects the already proven
parser, normalization, and persistence slices into one functional runtime; a
new local upload therefore remains queued at A12 rather than claiming a false
end-to-end completion.
