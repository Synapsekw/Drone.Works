import {
  readApplicationDatabaseEnvironment,
  readServiceEnvironment,
} from '@drone-works/config';
import {
  createApplicationPool,
  OrganizationAuthorizationRepository,
} from '@drone-works/database';

import { buildApi } from './app.js';
import { createIdentitySource } from './identity.js';

const environment = readServiceEnvironment(process.env);
const databaseEnvironment = readApplicationDatabaseEnvironment(process.env);
const identitySource = createIdentitySource(environment);
const pool = createApplicationPool({
  database: databaseEnvironment.PGDATABASE,
  host: databaseEnvironment.PGHOST,
  port: databaseEnvironment.PGPORT,
  user: databaseEnvironment.PGUSER,
});
const { app } = await buildApi({
  environment,
  identitySource,
  organizations: new OrganizationAuthorizationRepository(pool),
});

await app.listen({ host: environment.HOST, port: environment.PORT });

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
