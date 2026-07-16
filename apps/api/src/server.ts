import {
  readApplicationDatabaseEnvironment,
  readServiceEnvironment,
} from '@drone-works/config';
import {
  createApplicationPool,
  ImportProcessingRepository,
  OrganizationAuthorizationRepository,
  RawUploadRepository,
} from '@drone-works/database';

import { buildApi } from './app.js';
import { createIdentitySource } from './identity.js';
import { LoopbackImmutableObjectStore } from './loopback-object-store.js';

const environment = readServiceEnvironment(process.env);
const databaseEnvironment = readApplicationDatabaseEnvironment(process.env);
const identitySource = createIdentitySource(environment);
const pool = createApplicationPool({
  database: databaseEnvironment.PGDATABASE,
  host: databaseEnvironment.PGHOST,
  port: databaseEnvironment.PGPORT,
  user: databaseEnvironment.PGUSER,
});
const objectInternalUrl = process.env.OBJECT_INTERNAL_URL;
if (!objectInternalUrl) {
  throw new Error('OBJECT_INTERNAL_URL is required for raw uploads.');
}
const { app } = await buildApi({
  environment,
  identitySource,
  imports: new ImportProcessingRepository(pool),
  organizations: new OrganizationAuthorizationRepository(pool),
  objectStore: new LoopbackImmutableObjectStore(objectInternalUrl),
  uploads: new RawUploadRepository(pool),
});

await app.listen({ host: environment.HOST, port: environment.PORT });

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
