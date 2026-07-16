import pg from 'pg';

import { applyReviewedJobsMigration } from '../dist/index.js';

const { Client } = pg;
const required = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER'];
for (const name of required) {
  if (!process.env[name]) {
    throw new Error(`${name} is required for reviewed jobs migrations.`);
  }
}
if (process.env.PGUSER !== 'droneworks_queue') {
  throw new Error('Reviewed jobs migrations require droneworks_queue.');
}

const client = new Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  application_name: 'droneworks-reviewed-jobs-migration',
});

await client.connect();
try {
  const result = await applyReviewedJobsMigration(client);
  process.stdout.write(`${result.migrationId}:${result.status}\n`);
} finally {
  await client.end();
}
