import { createServer } from 'node:http';

import {
  readDjiKeychainEnvironment,
  readServiceEnvironment,
} from '@drone-works/config';

const environment = readServiceEnvironment(process.env);
readDjiKeychainEnvironment(process.env);
const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', service: 'worker' }));
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ status: 'not_found' }));
});

server.listen(environment.PORT, environment.HOST);

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
