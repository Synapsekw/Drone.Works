import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import pg from 'pg';

import {
  applyReviewedJobsMigration,
  applyReviewedMigrations,
  withOrganizationTransaction,
} from '../dist/index.js';
import {
  generatedOrganizations,
  seedOrganization,
} from '../test/generated-seed.mjs';

const execFileAsync = promisify(execFile);
const { Client, Pool } = pg;

async function findPostgresBin() {
  const candidates = [
    process.env.POSTGRES_BIN,
    '/opt/homebrew/opt/postgresql@18/bin',
    '/usr/local/opt/postgresql@18/bin',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await Promise.all(
        ['initdb', 'pg_ctl', 'postgres'].map((binary) =>
          access(join(candidate, binary)),
        ),
      );
      return candidate;
    } catch {
      // Continue to the next explicit native PostgreSQL installation.
    }
  }
  throw new Error(
    'PostgreSQL 18 server binaries were not found. Docker is not used.',
  );
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not allocate a PostgreSQL test port.'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

export async function startDisposablePostgres(options = {}) {
  const postgresBin = await findPostgresBin();
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'droneworks-a05-'));
  const dataDirectory = join(temporaryRoot, 'data');
  const socketDirectory = join(temporaryRoot, 'socket');
  const logPath = join(temporaryRoot, 'postgres.log');
  const port = await availablePort();
  const bootstrapUser = userInfo().username;
  let serverStarted = false;

  try {
    await execFileAsync(join(postgresBin, 'initdb'), [
      '--pgdata',
      dataDirectory,
      '--encoding',
      'UTF8',
      '--locale',
      'C',
      '--auth',
      'trust',
      '--no-sync',
    ]);
    await mkdir(socketDirectory);
    await execFileAsync(join(postgresBin, 'pg_ctl'), [
      '--pgdata',
      dataDirectory,
      '--log',
      logPath,
      '--options',
      `-F -h '' -k ${socketDirectory} -p ${port}`,
      '--wait',
      'start',
    ]);
    serverStarted = true;

    const bootstrap = new Client({
      host: socketDirectory,
      port,
      database: 'postgres',
      user: bootstrapUser,
    });
    await bootstrap.connect();
    try {
      await bootstrap.query(
        await readFile(
          new URL('../sql/bootstrap.sql', import.meta.url),
          'utf8',
        ),
      );
    } finally {
      await bootstrap.end();
    }

    const migration = new Client({
      host: socketDirectory,
      port,
      database: 'postgres',
      user: 'droneworks_migration_runner',
      application_name: 'droneworks-a05-authorization-test',
    });
    await migration.connect();
    try {
      await applyReviewedMigrations(
        migration,
        new Date('2026-07-16T00:00:00.000Z'),
      );
    } finally {
      await migration.end();
    }

    const jobsMigration = new Client({
      host: socketDirectory,
      port,
      database: 'postgres',
      user: 'droneworks_queue',
      application_name: 'droneworks-reviewed-jobs-migration',
    });
    await jobsMigration.connect();
    try {
      await applyReviewedJobsMigration(
        jobsMigration,
        new Date('2026-07-16T00:00:00.000Z'),
      );
    } finally {
      await jobsMigration.end();
    }

    const appPool = new Pool({
      host: socketDirectory,
      port,
      database: 'postgres',
      user: 'droneworks_app',
      max: 1,
    });
    try {
      for (const seed of Object.values(generatedOrganizations)) {
        await withOrganizationTransaction(
          appPool,
          seed.organizationId,
          async (transaction) => seedOrganization(transaction, seed),
        );
      }
    } finally {
      await appPool.end();
    }

    if (options.setupSql) {
      const setup = new Client({
        host: socketDirectory,
        port,
        database: 'postgres',
        user: bootstrapUser,
      });
      await setup.connect();
      try {
        await setup.query(options.setupSql);
      } finally {
        await setup.end();
      }
    }

    return {
      environment: {
        PGDATABASE: 'postgres',
        PGHOST: socketDirectory,
        PGPORT: String(port),
        PGUSER: 'droneworks_app',
      },
      async close() {
        if (serverStarted) {
          await execFileAsync(join(postgresBin, 'pg_ctl'), [
            '--pgdata',
            dataDirectory,
            '--mode',
            'immediate',
            '--wait',
            'stop',
          ]).catch(() => undefined);
          serverStarted = false;
        }
        await rm(temporaryRoot, { recursive: true, force: true });
      },
    };
  } catch (error) {
    const log = serverStarted
      ? await readFile(logPath, 'utf8').catch(() => 'unavailable')
      : 'server did not start';
    if (serverStarted) {
      await execFileAsync(join(postgresBin, 'pg_ctl'), [
        '--pgdata',
        dataDirectory,
        '--mode',
        'immediate',
        '--wait',
        'stop',
      ]).catch(() => undefined);
    }
    await rm(temporaryRoot, { recursive: true, force: true });
    throw new Error(`Disposable PostgreSQL failed. Log:\n${log}`, {
      cause: error,
    });
  }
}
