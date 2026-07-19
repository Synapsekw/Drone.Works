import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, openSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const repositoryRoot = resolve(process.cwd(), '../..');
const state = JSON.parse(
  readFileSync(
    resolve(repositoryRoot, '.drone-works/local/state.json'),
    'utf8',
  ),
) as {
  readonly endpoints: {
    readonly objects: string;
    readonly worker: string;
  };
  readonly postgres: {
    readonly database: string;
    readonly port: number;
    readonly socket: string;
  };
  readonly processes: readonly {
    readonly log: string;
    readonly name: string;
    readonly pid: number;
  }[];
  readonly worker: {
    readonly credentialFile: string;
    readonly kmsKeyFile: string;
    readonly parserExecutable: string;
    readonly parserSha256: string;
  };
};

const fixturePath = resolve(repositoryRoot, 'fixtures/local/dji-log-003.txt');
const canary = 'A13A_REDACTION_CANARY_7F2C9B';
let replacementWorker: ChildProcess | undefined;

function killWorker(pid: number) {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

async function waitForWorkerUnavailable() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await fetch(state.endpoints.worker, {
        signal: AbortSignal.timeout(100),
      });
    } catch {
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('The killed worker did not release its loopback endpoint.');
}

async function waitForReplacementWorker(child: ChildProcess) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error('The replacement worker exited before recovery.');
    }
    try {
      const response = await fetch(state.endpoints.worker, {
        signal: AbortSignal.timeout(200),
      });
      const body = (await response.json()) as {
        readonly service?: string;
        readonly status?: string;
      };
      if (response.ok && body.service === 'worker' && body.status === 'ok') {
        return;
      }
    } catch {
      // The replacement process has not bound its loopback endpoint yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('The replacement worker did not become ready.');
}

function startReplacementWorker(): ChildProcess {
  const workerUrl = new URL(state.endpoints.worker);
  const workerLog = state.processes.find(({ name }) => name === 'worker')?.log;
  if (!workerLog) throw new Error('The generated worker log is unavailable.');
  const descriptor = openSync(workerLog, 'a');
  const child = spawn(
    process.execPath,
    [resolve(repositoryRoot, 'apps/worker/dist/server.js')],
    {
      cwd: repositoryRoot,
      detached: true,
      env: {
        ...process.env,
        DRONE_WORKS_DJI_KMS_KEY_REFERENCE: 'kms://local/a13a',
        DRONE_WORKS_DJI_KMS_KEY_VERSION: 'local-v1',
        DRONE_WORKS_DJI_NOTICE_VERSION: 'dji-keychain-notice-v1',
        DRONE_WORKS_DJI_PROVIDER_ENABLED: 'true',
        DRONE_WORKS_DJI_SECRET_REFERENCE:
          'secret://local/dji-flight-record-api',
        DRONE_WORKS_DJI_TERMS_VERSION:
          'dji-flight-record-api-review-2026-07-17',
        DRONE_WORKS_ENV: 'local',
        DRONE_WORKS_LOCAL_CREDENTIAL_FILE: state.worker.credentialFile,
        DRONE_WORKS_LOCAL_KMS_KEY_FILE: state.worker.kmsKeyFile,
        DRONE_WORKS_LOCAL_PARSER_EXECUTABLE: state.worker.parserExecutable,
        DRONE_WORKS_LOCAL_PARSER_SHA256: state.worker.parserSha256,
        DRONE_WORKS_LOCAL_WORKER_RECOVERY_PROBE_MS: '0',
        HOST: '127.0.0.1',
        OBJECT_INTERNAL_URL: state.endpoints.objects.replace(/\/health$/, ''),
        PGDATABASE: state.postgres.database,
        PGHOST: state.postgres.socket,
        PGPORT: String(state.postgres.port),
        PGUSER: 'droneworks_app',
        PORT: workerUrl.port,
      },
      stdio: ['ignore', descriptor, descriptor],
    },
  );
  closeSync(descriptor);
  return child;
}

async function enterAlpha(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Generated Alpha owner' }).click();
  await page.getByRole('button', { name: 'Enter organization' }).click();
  await expect(page.getByTestId('organization-state')).toContainText(
    'Generated A',
  );
}

async function selectFixture(
  page: import('@playwright/test').Page,
  name: string,
  buffer = readFileSync(fixturePath),
) {
  await page.getByLabel('Select a DJI source log').setInputFiles({
    name,
    mimeType: 'application/octet-stream',
    buffer,
  });
}

test.afterAll(() => {
  if (replacementWorker?.pid) killWorker(replacementWorker.pid);
});

test('proves the generated-persona browser-to-flight path and isolation', async ({
  page,
}) => {
  const requests: Array<{ method: string; url: string; body: string }> = [];
  page.on('request', (request) => {
    requests.push({
      body: request.postData() ?? '',
      method: request.method(),
      url: request.url(),
    });
  });

  await enterAlpha(page);

  await selectFixture(page, `${canary}-unapproved.txt`);
  await page.getByRole('button', { name: 'Upload and process' }).click();
  await expect(page.locator('.error-banner')).toContainText(
    'needs a key that is currently unavailable',
    { timeout: 45_000 },
  );

  await selectFixture(page, `${canary}-approved.txt`);
  await page.getByLabel('Approve encrypted DJI processing if required').check();
  await page.getByRole('button', { name: 'Upload and process' }).click();
  await expect(page.getByText('Detecting the source format')).toBeVisible({
    timeout: 30_000,
  });
  const originalWorker = state.processes.find(({ name }) => name === 'worker');
  if (!originalWorker) throw new Error('The generated worker is unavailable.');
  killWorker(originalWorker.pid);
  await waitForWorkerUnavailable();
  replacementWorker = startReplacementWorker();
  await waitForReplacementWorker(replacementWorker);

  await expect(page.getByTestId('flight-detail')).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByTestId('flight-map')).toBeVisible();
  await expect(page.getByText('Provider-free local canvas.')).toBeVisible();
  await expect(page.locator('canvas[role="img"]')).toHaveAttribute(
    'aria-label',
    'Capability-supported two-dimensional flight track',
  );
  const flightId = await page.getByLabel('Flight ID').inputValue();
  expect(flightId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );

  await selectFixture(page, `${canary}-duplicate.txt`);
  await page.getByRole('button', { name: 'Upload and process' }).click();
  await expect(
    page.getByText('Exact duplicate — retained flight reused'),
  ).toBeVisible({ timeout: 45_000 });
  expect(await page.getByLabel('Flight ID').inputValue()).toBe(flightId);

  const corrupt = Buffer.from(readFileSync(fixturePath));
  corrupt.fill(0xff, 0, 8);
  await selectFixture(page, `${canary}-corrupt.txt`, corrupt);
  corrupt.fill(0);
  await page
    .getByLabel('Approve encrypted DJI processing if required')
    .uncheck();
  await page.getByRole('button', { name: 'Upload and process' }).click();
  await expect(page.locator('.error-banner')).toContainText(
    'corrupt or malformed',
    { timeout: 45_000 },
  );

  await page.getByRole('button', { name: 'Generated Beta owner' }).click();
  await expect(page.getByTestId('flight-detail')).toHaveCount(0);
  await expect(page.getByTestId('organization-state')).toHaveText(
    'Organization-bound data is empty.',
  );
  await page.getByRole('button', { name: 'Enter organization' }).click();
  await page.getByLabel('Flight ID').fill(flightId);
  await page.getByRole('button', { name: 'Open flight' }).click();
  await expect(page.locator('.error-banner')).toContainText(
    'not available to the current organization membership',
  );
  await expect(page.locator('.error-banner')).not.toContainText(flightId);

  const mutations = requests.filter(
    ({ method }) => !['GET', 'HEAD', 'OPTIONS'].includes(method),
  );
  expect(mutations.length).toBeGreaterThan(0);
  for (const mutation of mutations) {
    const path = new URL(mutation.url).pathname;
    expect(
      path.startsWith('/api/v1/') ||
        path === '/_local/generated-personas/select' ||
        path === '/security/csp-report',
    ).toBe(true);
  }
  for (const request of requests) {
    if (!request.url.startsWith('http')) continue;
    const url = new URL(request.url);
    expect(['127.0.0.1', 'localhost']).toContain(url.hostname);
    expect(url.pathname).not.toMatch(/tile|style/i);
  }

  const accessibility = await new AxeBuilder({ page })
    .include('main')
    .analyze();
  expect(accessibility.violations).toEqual([]);
});
