import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const host = '127.0.0.1';
const objectPort = Number(process.env.OBJECT_PORT);
const emailPort = Number(process.env.EMAIL_PORT);
const objects = new Map();
const messages = [];

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readBody(request, maximumBytes = 33_554_432) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) {
      throw new Error('body_too_large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const objectServer = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${host}:${objectPort}`);
  if (request.method === 'GET' && url.pathname === '/health') {
    json(response, 200, { status: 'ok', service: 'objects' });
    return;
  }

  if (request.method === 'PUT' && url.pathname.startsWith('/objects/')) {
    try {
      const body = await readBody(request);
      const digest = createHash('sha256').update(body).digest('hex');
      if (request.headers['x-content-sha256'] !== digest) {
        json(response, 400, { status: 'invalid_checksum' });
        return;
      }
      const key = decodeURIComponent(url.pathname.slice('/objects/'.length));
      if (objects.has(key)) {
        json(response, 409, { status: 'immutable_key_exists' });
        return;
      }
      const versionId = randomUUID();
      const mediaType = request.headers['content-type'];
      if (typeof mediaType !== 'string' || mediaType.length > 200) {
        json(response, 400, { status: 'invalid_media_type' });
        return;
      }
      const object = { body, digest, mediaType, versionId };
      objects.set(key, object);
      response.writeHead(201, {
        'content-type': 'application/json',
        'x-byte-size': String(body.byteLength),
        'x-content-sha256': digest,
        'x-stored-media-type': mediaType,
        'x-version-id': versionId,
      });
      response.end(
        JSON.stringify({ status: 'created', version_id: versionId, digest }),
      );
    } catch (error) {
      json(response, error.message === 'body_too_large' ? 413 : 400, {
        status: 'invalid_request',
      });
    }
    return;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/objects/')) {
    const key = decodeURIComponent(url.pathname.slice('/objects/'.length));
    const object = objects.get(key);
    if (!object || url.searchParams.get('version_id') !== object.versionId) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'content-type': object.mediaType,
      'content-length': String(object.body.byteLength),
      'x-byte-size': String(object.body.byteLength),
      'x-content-sha256': object.digest,
      'x-stored-media-type': object.mediaType,
      'x-version-id': object.versionId,
    });
    response.end(object.body);
    return;
  }

  if (request.method === 'HEAD' && url.pathname.startsWith('/objects/')) {
    const key = decodeURIComponent(url.pathname.slice('/objects/'.length));
    const object = objects.get(key);
    if (
      !object ||
      (url.searchParams.get('version_id') &&
        url.searchParams.get('version_id') !== object.versionId)
    ) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'x-byte-size': String(object.body.byteLength),
      'x-content-sha256': object.digest,
      'x-stored-media-type': object.mediaType,
      'x-version-id': object.versionId,
    });
    response.end();
    return;
  }

  if (request.method === 'DELETE' && url.pathname.startsWith('/objects/')) {
    const key = decodeURIComponent(url.pathname.slice('/objects/'.length));
    const object = objects.get(key);
    if (!object || url.searchParams.get('version_id') !== object.versionId) {
      response.writeHead(404).end();
      return;
    }
    objects.delete(key);
    response.writeHead(204).end();
    return;
  }

  json(response, 404, { status: 'not_found' });
});

const emailServer = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${host}:${emailPort}`);
  if (request.method === 'GET' && url.pathname === '/health') {
    json(response, 200, { status: 'ok', service: 'email' });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/messages') {
    json(response, 200, { messages });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/messages') {
    try {
      const body = JSON.parse((await readBody(request)).toString('utf8'));
      const message = { id: randomUUID(), ...body };
      messages.push(message);
      json(response, 202, message);
    } catch {
      json(response, 400, { status: 'invalid_request' });
    }
    return;
  }

  json(response, 404, { status: 'not_found' });
});

await Promise.all([
  new Promise((resolveListen) =>
    objectServer.listen(objectPort, host, resolveListen),
  ),
  new Promise((resolveListen) =>
    emailServer.listen(emailPort, host, resolveListen),
  ),
]);

const shutdown = () => {
  Promise.all([
    new Promise((resolveClose) => objectServer.close(resolveClose)),
    new Promise((resolveClose) => emailServer.close(resolveClose)),
  ]).then(() => process.exit(0));
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
