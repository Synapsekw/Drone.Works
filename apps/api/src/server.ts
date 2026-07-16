import { readServiceEnvironment } from '@drone-works/config';

import { buildApi } from './app.js';

const environment = readServiceEnvironment(process.env);
const { app } = await buildApi();

await app.listen({ host: environment.HOST, port: environment.PORT });

const shutdown = async () => {
  await app.close();
  process.exit(0);
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
