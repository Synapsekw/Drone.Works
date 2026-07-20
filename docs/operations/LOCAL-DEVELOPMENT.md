# Local development without Docker

Status: accepted Phase 1A foundation
Last updated: 2026-07-20

This workflow runs only on your Mac. It does not create anything in AWS, ask for
cloud credentials, use Docker, send real email, or load customer data. The seed
records and telemetry track are generated, explicitly labeled synthetic, and
safe to delete.

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
   creates two generated organizations with three synthetic flights each,
   including one provider-free capability-aware track, plus a synthetic review
   batch covering supported, unsupported, corrupt, truncated, key-unavailable,
   cancelled, exact-duplicate, and probable-duplicate outcomes, and enables the
   server-owned Alpha/Beta persona control. The
   persona control is not a login and exists only in this local process.

   In the browser, choose **Generated Alpha owner**, select **Enter
   organization**, then use the flight table's **Open flight** action. The
   dashboard, filters, summary, and track work without uploading a fixture.
   The review inbox opens retained/candidate flights and exposes attempt
   history. Use **Use generated test batch** to exercise multi-file selection
   without customer data; ordinary local processing keeps the provider off.

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

- `web`: the local-only persona, organization flight library/dashboard,
  multi-file batch upload, progress, review inbox, retry, flight-summary, and
  provider-free MapLibre path;
- `api`: the versioned `/api/v1/health` contract;
- `dispatcher`: leases payload-free outbox rows and sends stable pg-boss jobs;
- `worker`: the durable import consumer, trusted keychain broker, exact-source
  reader, parser supervisor, normalizer, and persistence boundary;
- `objects`: a loopback versioned-object adapter for immutable raw and telemetry
  objects;
- `email`: a loopback capture service for generated verification, recovery,
  deletion, and invitation links;
- `PostgreSQL`: a disposable native database with the reviewed customer and jobs
  schemas, their separate migration ledgers, and generated Alpha/Beta
  organization records.

Ordinary `dev:up` receives only an opaque token issued for a named server-owned
persona. It resolves the generated user ID on the server, then reloads current
membership and role from PostgreSQL for every organization operation. Set
`DRONE_WORKS_AUTH_ENABLED=true` to build and start the mutually exclusive
verified-session mode; that mode generates an ephemeral local auth secret and
uses the loopback email capture. Neither mode accepts browser user, membership,
or role claims as authorization.

Batch declaration/read, immutable item upload, status, safe retry, flight
summary, and track remain generated-client operations under `/api/v1/`.
Changing persona or organization aborts batch polling and clears selected
files, recent batches, inbox filters, open-flight state, and cached coordinates.

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

Run the immutable upload, atomic batch declaration, outcome vocabulary,
duplicate truth, attempt-history, eligible retry, authorization, and RLS gate
with:

```sh
corepack pnpm test:upload
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

## Run the verified-auth gate

Run the real Better Auth lifecycle, reviewed-schema, secure-control, claim
mismatch, invitation, recovery, revocation, final-owner, deletion, audit, and
hosted-exclusion suite with:

```sh
corepack pnpm test:auth
```

This uses generated users, a native disposable PostgreSQL cluster, and local
email capture. It makes no external email or hosted identity request.

## Run the destructive A13a/A13b functional gates

This separate command uses a policy-approved local-only fixture and, after the
browser records the current notice and terms acceptance, sends its bounded
source-derived keychain request to DJI. The raw log itself stays on loopback.
Do not run this gate for an unapproved fixture, with a hosted credential, or
without understanding that the bounded request contains sensitive
source-derived feature points.

Provide the exact reviewed local parser executable and its SHA-256 reference,
keep the approved credential only in ignored `.env.local` as
`DJI_FLIGHT_RECORD_API_KEY`, then run:

```sh
DRONE_WORKS_LOCAL_PARSER_EXECUTABLE=/absolute/path/to/droneworks-dji-parser-cli \
DRONE_WORKS_LOCAL_PARSER_SHA256=<reviewed-64-character-sha256> \
corepack pnpm test:e2e:functional
```

Use the same reviewed parser inputs with `corepack pnpm test:e2e:local` to
repeat the path under registered, verified HttpOnly-cookie sessions. Both gates
are destructive local evidence commands; the A13b variant creates fresh users
and organizations, signs out between Alpha and Beta, and purges its generated
Alpha organization before shutdown.

The gate verifies the private fixture manifest, builds and starts a disposable
runtime, drives Chromium through key-unavailable and approved paths, kills and
replaces the worker, re-uploads the exact bytes, creates a controlled corrupt
derivative in memory, checks Alpha/Beta isolation and coordinate/network
boundaries, scans generated logs for a canary, deletes exact object versions,
and confirms zero generated Alpha customer rows. It always stops and removes
the runtime. Its ignored machine report contains pass/fail categories only; the
retained sanitized evidence is in
`../testing/A13A-FUNCTIONAL-EVIDENCE.md`.

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

The production database schema, forced organization isolation, app-owned
authorization, and Better Auth identity/session schema are present locally. The
generated identity cannot start or register its control in hosted modes. AWS
remains deferred to A14; no cloud resource or hosted credential is required for
these local gates.

The A13a runtime connects the web, immutable source, durable queue, trusted
keychain broker, parser, normalization, telemetry persistence, summary, and
track slices. The provider remains disabled during ordinary `dev:up`; only the
explicit functional command above enables its generated local/test path.
