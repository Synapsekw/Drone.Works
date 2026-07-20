import {
  readApplicationDatabaseEnvironment,
  readServiceEnvironment,
  readVerifiedAuthEnvironment,
} from '@drone-works/config';
import {
  createApplicationPool,
  createAuthPool,
  FlightReadRepository,
  ImportProcessingRepository,
  OrganizationAuthorizationRepository,
  RawUploadRepository,
} from '@drone-works/database';

import { buildApi } from './app.js';
import { createVerifiedAuth } from './auth.js';
import { createIdentitySource } from './identity.js';
import { LoopbackEmailDelivery } from './loopback-email.js';
import { LoopbackImmutableObjectStore } from './loopback-object-store.js';

const environment = readServiceEnvironment(process.env);
const authEnvironment = readVerifiedAuthEnvironment(process.env);
const databaseEnvironment = readApplicationDatabaseEnvironment(process.env);
const pool = createApplicationPool({
  database: databaseEnvironment.PGDATABASE,
  host: databaseEnvironment.PGHOST,
  port: databaseEnvironment.PGPORT,
  user: databaseEnvironment.PGUSER,
});
const organizations = new OrganizationAuthorizationRepository(pool);
const authPool = authEnvironment.ENABLED
  ? createAuthPool({
      database: databaseEnvironment.PGDATABASE,
      host: databaseEnvironment.PGHOST,
      port: databaseEnvironment.PGPORT,
      user: 'droneworks_auth',
    })
  : null;
const email = authEnvironment.ENABLED
  ? new LoopbackEmailDelivery(authEnvironment.EMAIL_INTERNAL_URL)
  : undefined;
const auth =
  authEnvironment.ENABLED && authPool && email
    ? createVerifiedAuth({
        baseUrl: authEnvironment.BASE_URL,
        beforeDeleteUser: (userId) =>
          organizations.prepareAuthUserDeletion(userId),
        email,
        pool: authPool,
        secret: authEnvironment.SECRET,
        secureCookies: ['staging', 'production'].includes(
          environment.DRONE_WORKS_ENV,
        ),
        trustedOrigins: authEnvironment.TRUSTED_ORIGINS,
      })
    : undefined;
const identitySource = createIdentitySource(environment, auth);
const objectInternalUrl = process.env.OBJECT_INTERNAL_URL;
if (!objectInternalUrl) {
  throw new Error('OBJECT_INTERNAL_URL is required for raw uploads.');
}
const { app } = await buildApi({
  ...(auth ? { auth } : {}),
  ...(email ? { email } : {}),
  environment,
  identitySource,
  flights: new FlightReadRepository({
    objectStore: new LoopbackImmutableObjectStore(objectInternalUrl),
    pool,
  }),
  imports: new ImportProcessingRepository(pool),
  organizations,
  objectStore: new LoopbackImmutableObjectStore(objectInternalUrl),
  uploads: new RawUploadRepository(pool),
  ...(authEnvironment.ENABLED
    ? { publicWebUrl: authEnvironment.BASE_URL }
    : {}),
});

await app.listen({ host: environment.HOST, port: environment.PORT });

const shutdown = async () => {
  await app.close();
  await authPool?.end();
  await pool.end();
  process.exit(0);
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
