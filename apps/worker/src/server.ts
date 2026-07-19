import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

import {
  readApplicationDatabaseEnvironment,
  readDjiKeychainEnvironment,
  readJobsDatabaseEnvironment,
  readServiceEnvironment,
} from '@drone-works/config';
import {
  Aes256GcmKeychainCipher,
  createApplicationPool,
  djiKeychainNoticeVersion,
  djiKeychainTermsVersion,
  FlightNormalizationRepository,
  ImportProcessingRepository,
  PostgresKeychainStore,
  type ManagedKeyProvider,
} from '@drone-works/database';
import { ProcessingQueue } from '@drone-works/jobs';
import {
  DisabledKeychainProvider,
  DjiKeychainProvider,
  DjiV14ProcessingService,
  KeychainBroker,
  LocalNativeParserOperations,
  type DjiParserOperations,
  type KeychainProvider,
  type ParserFailure,
} from '@drone-works/parser';

import {
  FunctionalImportProcessor,
  LoopbackWorkerObjectStore,
} from './processing.js';

const environment = readServiceEnvironment(process.env);
const database = readApplicationDatabaseEnvironment(process.env);
const jobsDatabase = readJobsDatabaseEnvironment(process.env);
const dji = readDjiKeychainEnvironment(process.env);
const objectInternalUrl = process.env.OBJECT_INTERNAL_URL;
if (!objectInternalUrl) {
  throw new Error('OBJECT_INTERNAL_URL is required for processing.');
}

function boundedInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 30_000) {
    throw new Error('The local worker timing configuration is invalid.');
  }
  return parsed;
}

async function localCredential(path: string): Promise<string> {
  const contents = await readFile(path, 'utf8');
  if (Buffer.byteLength(contents) > 16_384) {
    throw new Error('The local credential file is invalid.');
  }
  const values = contents
    .split(/\r?\n/)
    .map((line) => line.match(/^DJI_FLIGHT_RECORD_API_KEY=(.*)$/)?.[1])
    .filter((value): value is string => value !== undefined);
  if (values.length !== 1) {
    throw new Error('The local credential reference cannot be resolved.');
  }
  const value = values[0]?.trim() ?? '';
  const unquoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
      ? value.slice(1, -1)
      : value;
  if (!unquoted || /[\r\n]/.test(unquoted)) {
    throw new Error('The local credential reference cannot be resolved.');
  }
  return unquoted;
}

class LocalFileManagedKeyProvider implements ManagedKeyProvider {
  readonly #path: string;
  readonly #reference: string;
  readonly #version: string;

  constructor(input: {
    readonly path: string;
    readonly reference: string;
    readonly version: string;
  }) {
    this.#path = input.path;
    this.#reference = input.reference;
    this.#version = input.version;
  }

  async key(reference: string, version: string): Promise<Buffer> {
    if (reference !== this.#reference || version !== this.#version) {
      throw new Error('The local managed-key reference is unavailable.');
    }
    const key = await readFile(this.#path);
    if (key.length !== 32) {
      key.fill(0);
      throw new Error('The local managed-key reference is invalid.');
    }
    return key;
  }
}

class UnavailableManagedKeyProvider implements ManagedKeyProvider {
  async key(): Promise<Buffer> {
    throw new Error('No managed-key provider is enabled.');
  }
}

const unavailableParserFailure = (): ParserFailure => ({
  boundary: null,
  failureCode: 'parser_runtime_error',
  process: null,
  schemaVersion: 1,
  status: 'failed',
});

const unavailableParser: DjiParserOperations = {
  async buildKeychainRequest() {
    return unavailableParserFailure();
  },
  async run(_source, privateInput) {
    privateInput.fill(0);
    return unavailableParserFailure();
  },
};

const pool = createApplicationPool({
  database: database.PGDATABASE,
  host: database.PGHOST,
  port: database.PGPORT,
  user: database.PGUSER,
});
const objectStore = new LoopbackWorkerObjectStore(objectInternalUrl);
const imports = new ImportProcessingRepository(pool);
let parser: DjiParserOperations = unavailableParser;
let provider: KeychainProvider = new DisabledKeychainProvider();
let managedKeyProvider: ManagedKeyProvider =
  new UnavailableManagedKeyProvider();

if (dji.ENABLED) {
  if (!['local', 'test'].includes(environment.DRONE_WORKS_ENV)) {
    throw new Error(
      'Hosted DJI processing requires the A14/A15 managed providers.',
    );
  }
  if (
    dji.NOTICE_VERSION !== djiKeychainNoticeVersion ||
    dji.TERMS_VERSION !== djiKeychainTermsVersion
  ) {
    throw new Error('The enabled DJI notice or terms reference is stale.');
  }
  const executable = process.env.DRONE_WORKS_LOCAL_PARSER_EXECUTABLE;
  const executableSha256 = process.env.DRONE_WORKS_LOCAL_PARSER_SHA256;
  const credentialFile = process.env.DRONE_WORKS_LOCAL_CREDENTIAL_FILE;
  const keyFile = process.env.DRONE_WORKS_LOCAL_KMS_KEY_FILE;
  if (!executable || !executableSha256 || !credentialFile || !keyFile) {
    throw new Error('The local DJI processing references are incomplete.');
  }
  parser = new LocalNativeParserOperations({
    environment: environment.DRONE_WORKS_ENV,
    executable,
    executableSha256,
  });
  provider = new DjiKeychainProvider({
    credentialProvider: () => localCredential(credentialFile),
    externalNetworkAuthorized: true,
  });
  managedKeyProvider = new LocalFileManagedKeyProvider({
    path: keyFile,
    reference: dji.KMS_KEY_REFERENCE,
    version: dji.KMS_KEY_VERSION,
  });
}

const keychainStore = new PostgresKeychainStore({
  cipher: new Aes256GcmKeychainCipher({
    activeKeyReference: dji.ENABLED
      ? dji.KMS_KEY_REFERENCE
      : 'kms://disabled/local',
    activeKeyVersion: dji.ENABLED ? dji.KMS_KEY_VERSION : 'disabled-v1',
    provider: managedKeyProvider,
  }),
  pool,
});
const processor = new FunctionalImportProcessor({
  imports,
  normalization: new FlightNormalizationRepository({ objectStore, pool }),
  objectStore,
  pauseAfterClaimMs: boundedInteger(
    process.env.DRONE_WORKS_LOCAL_WORKER_RECOVERY_PROBE_MS,
    0,
  ),
  processing: new DjiV14ProcessingService({
    broker: new KeychainBroker({ provider, store: keychainStore }),
    parser,
  }),
});
const queue = await ProcessingQueue.start({
  database: jobsDatabase.PGDATABASE,
  host: jobsDatabase.PGHOST,
  port: jobsDatabase.PGPORT,
});

let cycling = false;
let healthy = true;
let lastSupervisedAt = 0;
const cycle = async () => {
  if (cycling) return;
  cycling = true;
  try {
    if (Date.now() - lastSupervisedAt >= 1_000) {
      await queue.supervise();
      lastSupervisedAt = Date.now();
    }
    await queue.processNext(imports, async ({ payload, target }) => {
      await processor.process(payload.organizationId, target);
    });
    healthy = true;
  } catch (error) {
    healthy = false;
    process.stderr.write(
      `Worker cycle failed: ${error instanceof Error ? error.name : 'Error'}\n`,
    );
  } finally {
    cycling = false;
  }
};
const interval = setInterval(cycle, 200);
interval.unref();
void cycle();

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(healthy ? 200 : 503, {
      'content-type': 'application/json',
    });
    response.end(
      JSON.stringify({
        status: healthy ? 'ok' : 'unavailable',
        service: 'worker',
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
  await Promise.all([queue.stop(), pool.end()]);
  process.exit(0);
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
