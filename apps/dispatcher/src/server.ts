import { createServer } from 'node:http';

import {
  readJobsDatabaseEnvironment,
  readServiceEnvironment,
} from '@drone-works/config';
import {
  dispatchOnce,
  DispatcherRepository,
  ProcessingQueue,
} from '@drone-works/jobs';

const environment = readServiceEnvironment(process.env);
const database = readJobsDatabaseEnvironment(process.env);
const configuration = {
  database: database.PGDATABASE,
  host: database.PGHOST,
  port: database.PGPORT,
};
const dispatcher = new DispatcherRepository(configuration);
const expireInSeconds = Number(
  process.env.DRONE_WORKS_PROCESSING_JOB_EXPIRE_SECONDS ?? '60',
);
if (
  !Number.isSafeInteger(expireInSeconds) ||
  expireInSeconds < 1 ||
  expireInSeconds > 3_600
) {
  throw new Error('The processing job expiration is invalid.');
}
const queue = await ProcessingQueue.start(configuration, { expireInSeconds });
let healthy = true;
let dispatching = false;

const dispatch = async () => {
  if (dispatching) return;
  dispatching = true;
  try {
    await dispatchOnce(dispatcher, queue);
    healthy = true;
  } catch (error) {
    healthy = false;
    process.stderr.write(
      `Dispatcher cycle failed: ${error instanceof Error ? error.name : 'Error'}\n`,
    );
  } finally {
    dispatching = false;
  }
};
const interval = setInterval(dispatch, 250);
interval.unref();

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(healthy ? 200 : 503, {
      'content-type': 'application/json',
    });
    response.end(
      JSON.stringify({
        status: healthy ? 'ok' : 'unavailable',
        service: 'dispatcher',
      }),
    );
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ status: 'not_found' }));
});

server.listen(environment.PORT, environment.HOST);

const shutdown = async () => {
  clearInterval(interval);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await Promise.all([queue.stop(), dispatcher.close()]);
  process.exit(0);
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
