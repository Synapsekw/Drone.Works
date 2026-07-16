import pg from 'pg';

import { applyReviewedMigrations } from '../dist/index.js';

const { Client } = pg;
const required = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER'];
for (const name of required) {
  if (!process.env[name]) {
    throw new Error(`${name} is required for reviewed database migrations.`);
  }
}

const client = new Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  application_name: 'droneworks-reviewed-migration',
});

await client.connect();
try {
  const results = await applyReviewedMigrations(client);
  process.stdout.write(
    `${results.map((result) => `${result.migrationId}:${result.status}`).join(',')}\n`,
  );
} finally {
  await client.end();
}
