import pg from 'pg';

import { withOrganizationTransaction } from '../dist/index.js';
import {
  generatedOrganizations,
  seedOrganization,
} from '../test/generated-seed.mjs';

const { Pool } = pg;
const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  max: 1,
});

try {
  for (const seed of Object.values(generatedOrganizations)) {
    await withOrganizationTransaction(
      pool,
      seed.organizationId,
      async (transaction) => seedOrganization(transaction, seed),
    );
  }
} finally {
  await pool.end();
}
