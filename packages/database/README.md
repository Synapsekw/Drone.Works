# Database boundary

This package owns Drone.Works PostgreSQL access. Other packages use its
transaction helper instead of importing `pg` directly.

## Local proof

Run the complete organization-isolation proof against a disposable native
PostgreSQL 18 cluster:

```sh
corepack pnpm test:database
```

The test creates two generated organizations, exercises every customer-owned
table through a one-connection pool, checks cross-organization reads and
writes, verifies role privileges, and removes the cluster when it finishes.
It does not use Docker, AWS, or persistent customer data.

Run the provider-neutral identity and app-owned organization authorization gate
against a separate disposable cluster with:

```sh
corepack pnpm test:authorization
```

That suite keeps the same ordinary application role, forced RLS, and
one-connection pool while exercising Alpha/Beta exact-ID denial, current
membership roles and removal, last-owner protection, audit redaction, and the
local/test-versus-hosted identity configuration matrix.

## Migration roles

- `droneworks_migration_runner` can assume only the migration owner role.
- `droneworks_app` is the API's restricted customer-data role.
- `droneworks_queue` owns the future job schema but cannot read customer data.
- `droneworks_dispatcher` has no customer-table access; A07 will add only the
  narrow lease and dispatch functions it needs.
- `droneworks_migration_auditor` owns the protected migration ledger.

`bootstrap.sql` is a provider-administrator operation used to establish these
roles and schemas. Normal application startup must never run as an
administrator or migration owner.

## Applying migrations

After an administrator has applied `sql/bootstrap.sql`, provide a PostgreSQL
connection string for `droneworks_migration_runner` and run:

```sh
DRONE_WORKS_DATABASE_URL='postgresql://...' corepack pnpm --filter @drone-works/database migrate
```

The runner validates both the migration file checksum and the resulting RLS,
ownership, policy, and grant contract before recording the migration. AWS RDS
provisioning and credentials are deliberately outside A04.
