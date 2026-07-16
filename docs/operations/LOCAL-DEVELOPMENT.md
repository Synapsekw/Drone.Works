# Local development without Docker

Status: accepted Phase 1A foundation
Last updated: 2026-07-16

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

## Start and check the local foundation

1. Start the generated local database and all loopback services:

   ```sh
   corepack pnpm dev:up
   ```

   The final line prints the local web address. The port is chosen automatically
   so it does not collide with another project. Startup applies the same
   checksum-pinned A04 migration used by the database tests and creates two
   generated organizations.

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

- `web`: the current browser shell;
- `api`: the versioned `/api/v1/health` contract;
- `worker`: the future background-work boundary;
- `objects`: a loopback placeholder for future versioned file storage;
- `email`: a loopback placeholder that never sends a message;
- `PostgreSQL`: a disposable native database with the reviewed A04 schema,
  migration ledger, and generated Alpha/Beta organization records.

The production database schema and row-level organization isolation are now
present locally. Authentication and AWS resources deliberately begin in later
tasks. No AWS help is needed for this foundation. When A14 reaches the cloud
setup, the account-owner steps will be provided one at a time with their
purpose, expected cost/security effect, a verification check, and a safe stop
or rollback step.
