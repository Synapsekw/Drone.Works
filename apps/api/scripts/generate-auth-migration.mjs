import { userInfo } from 'node:os';

import { getMigrations } from 'better-auth/db/migration';
import pg from 'pg';

import { startDisposablePostgres } from '../../../packages/database/scripts/disposable-postgres.mjs';
import { createVerifiedAuth } from '../dist/auth.js';

const { Pool } = pg;
const postgres = await startDisposablePostgres();
const pool = new Pool({
  database: postgres.environment.PGDATABASE,
  host: postgres.environment.PGHOST,
  options: '-c search_path=droneworks_auth,pg_catalog',
  port: Number(postgres.environment.PGPORT),
  user: userInfo().username,
});

try {
  const auth = createVerifiedAuth({
    baseUrl: 'http://127.0.0.1:3000',
    beforeDeleteUser: async () => undefined,
    email: { send: async () => undefined },
    pool,
    secret: 'schema-generation-only-not-a-runtime-secret',
    secureCookies: false,
    trustedOrigins: ['http://127.0.0.1:3000'],
  });
  const migrations = await getMigrations(auth.options);
  process.stdout.write(`${await migrations.compileMigrations()}\n`);
} finally {
  await pool.end();
  await postgres.close();
}
