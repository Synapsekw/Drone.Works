import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DjiKeychainProvider,
  DjiV14ProcessingService,
  KeychainBroker,
  KeychainProviderError,
  PrivateKeychainRequest,
  ParserSupervisor,
  classifyDjiFormat,
  defaultParserConstraints,
  validateKeychainRequest,
  validateKeychainResponse,
} from '../dist/index.js';

const request = Object.freeze({
  department: 7,
  keychainsArray: [
    [
      {
        aesCiphertext: Buffer.from('generated-ciphertext').toString('base64'),
        featurePoint: 'BaseFeature',
      },
    ],
  ],
  version: 4,
});
const keychains = Object.freeze([
  [
    {
      aesIv: randomBytes(16).toString('base64'),
      aesKey: randomBytes(32).toString('base64'),
      featurePoint: 'BaseFeature',
    },
  ],
]);
const context = Object.freeze({
  logVersion: 14,
  organizationId: '00000000-0000-4000-8000-0000000000a1',
  parserId: 'dji-log-parser@0.5.7',
  rawSourceId: '00000000-0000-4000-8000-0000000000a5',
});

class MemoryStore {
  authorizationValue = null;
  cached = null;
  deleted = 0;
  writes = [];

  async authorization() {
    return this.authorizationValue;
  }

  async get() {
    return this.cached ? structuredClone(this.cached) : null;
  }

  async put(_context, value, metadata) {
    this.cached = structuredClone(value);
    this.writes.push(structuredClone(metadata));
  }

  async deleteSource() {
    const count = this.cached ? 1 : 0;
    this.cached = null;
    this.deleted += count;
    return count;
  }

  async deleteOrganization() {
    return this.deleteSource();
  }
}

class MockProvider {
  id = 'generated-provider';
  calls = 0;
  failure = null;

  async fetchKeychains() {
    this.calls += 1;
    if (this.failure) throw new KeychainProviderError(this.failure);
    return structuredClone(keychains);
  }
}

function authorization(overrides = {}) {
  return {
    externalServiceProcessingAuthorized: true,
    keychainUseAuthorized: true,
    noticeVersion: 'notice-v1',
    termsVersion: 'terms-v1',
    ...overrides,
  };
}

describe('A09 keychain broker and provider boundary', () => {
  it('supports only the exact v14 matrix and keeps denial reasons distinct', () => {
    expect(
      classifyDjiFormat({ formatFamily: 'dji_txt', formatVersion: 14 }),
    ).toEqual({ status: 'supported' });
    expect(
      classifyDjiFormat({ formatFamily: 'unknown', formatVersion: 14 }),
    ).toEqual({ failureCode: 'unsupported_format', status: 'unsupported' });
    expect(
      classifyDjiFormat({ formatFamily: 'dji_txt', formatVersion: 13 }),
    ).toEqual({ failureCode: 'unsupported_version', status: 'unsupported' });
  });

  it('validates only bounded allowlisted request and response shapes', () => {
    expect(validateKeychainRequest(request)).toMatchObject({ valid: true });
    expect(validateKeychainResponse(keychains)).toMatchObject({ valid: true });
    expect(validateKeychainRequest({ ...request, keychainsArray: [] })).toEqual(
      { code: 'invalid_keychain_request', valid: false },
    );
    expect(
      validateKeychainResponse([
        [{ ...keychains[0][0], featurePoint: 'UnknownFeature' }],
      ]),
    ).toEqual({ code: 'invalid_keychain_response', valid: false });
  });

  it('derives authorization from the store before constructing a request', async () => {
    const store = new MemoryStore();
    const provider = new MockProvider();
    const broker = new KeychainBroker({ provider, store });
    let requestCalls = 0;
    const denied = await broker.resolve(context, async () => {
      requestCalls += 1;
      return request;
    });
    expect(denied.summary.status).toBe('keychain_use_not_authorized');
    expect(requestCalls).toBe(0);
    expect(provider.calls).toBe(0);

    store.authorizationValue = authorization({
      externalServiceProcessingAuthorized: false,
    });
    const externalDenied = await broker.resolve(context, async () => {
      requestCalls += 1;
      return request;
    });
    expect(externalDenied.summary.status).toBe('key_service_not_authorized');
    expect(requestCalls).toBe(0);
    expect(provider.calls).toBe(0);
  });

  it('fetches once, stores only through the scoped cache, and reuses offline', async () => {
    const store = new MemoryStore();
    store.authorizationValue = authorization();
    const provider = new MockProvider();
    const broker = new KeychainBroker({ provider, store });
    const fetched = await broker.resolve(context, async () => request);
    expect(fetched.summary).toMatchObject({
      cacheHit: false,
      hasKeychains: true,
      providerCalled: true,
      status: 'fetched',
    });
    expect(provider.calls).toBe(1);
    expect(store.writes).toEqual([
      {
        noticeVersion: 'notice-v1',
        providerId: 'generated-provider',
        termsVersion: 'terms-v1',
      },
    ]);
    const serialized = JSON.stringify(fetched);
    expect(serialized).not.toContain(keychains[0][0].aesKey);
    expect(serialized).not.toContain(keychains[0][0].aesIv);
    const privateInput = fetched.consumeForParser();
    expect(privateInput).toBeInstanceOf(Buffer);
    privateInput.fill(0);

    store.authorizationValue = authorization({
      externalServiceProcessingAuthorized: false,
    });
    const cached = await broker.resolve(context, async () => {
      throw new Error('A cache hit must not construct a provider request.');
    });
    expect(cached.summary).toMatchObject({
      cacheHit: true,
      providerCalled: false,
      status: 'cache_hit',
    });
    expect(provider.calls).toBe(1);
  });

  it('keeps provider failures distinct and payload-redacted', async () => {
    for (const code of [
      'key_service_unavailable',
      'key_service_rate_limited',
      'key_rejected',
    ]) {
      const store = new MemoryStore();
      store.authorizationValue = authorization();
      const provider = new MockProvider();
      provider.failure = code;
      const result = await new KeychainBroker({ provider, store }).resolve(
        context,
        async () => request,
      );
      expect(result.summary).toMatchObject({ failureCode: code, status: code });
      expect(JSON.stringify(result)).not.toContain(
        request.keychainsArray[0][0].aesCiphertext,
      );
    }
  });

  it('fails closed for non-allowlisted or non-authorized external endpoints', () => {
    expect(
      () =>
        new DjiKeychainProvider({
          allowedEndpoints: ['https://approved.invalid/keychains'],
          credentialProvider: async () => 'unused',
          endpoint: 'https://unapproved.invalid/keychains',
          externalNetworkAuthorized: true,
        }),
    ).toThrow('not allowlisted');
    expect(
      () =>
        new DjiKeychainProvider({
          credentialProvider: async () => 'unused',
        }),
    ).toThrow('network access is not authorized');
  });

  it('posts through an injected runtime credential and classifies HTTP outcomes', async () => {
    const endpoint = 'http://127.0.0.1:4567/keychains';
    let observedHeaders;
    let observedBody;
    const provider = new DjiKeychainProvider({
      allowedEndpoints: [endpoint],
      allowInsecureLoopback: true,
      credentialProvider: async () => 'generated-secret',
      endpoint,
      fetchImplementation: async (_url, init) => {
        observedHeaders = init.headers;
        observedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ data: keychains }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      },
    });
    expect(
      await provider.fetchKeychains({
        request,
        requestMetadata: validateKeychainRequest(request).metadata,
      }),
    ).toEqual(keychains);
    expect(observedBody).toEqual(request);
    expect(observedHeaders['Api-Key']).toBe('generated-secret');

    for (const [status, code] of [
      [401, 'key_rejected'],
      [429, 'key_service_rate_limited'],
      [503, 'key_service_unavailable'],
    ]) {
      const failing = new DjiKeychainProvider({
        allowedEndpoints: [endpoint],
        allowInsecureLoopback: true,
        credentialProvider: async () => 'must-not-escape',
        endpoint,
        fetchImplementation: async () => new Response('{}', { status }),
      });
      await expect(
        failing.fetchKeychains({
          request,
          requestMetadata: validateKeychainRequest(request).metadata,
        }),
      ).rejects.toMatchObject({ code });
    }
  });
});

let temporaryDirectory;

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { force: true, recursive: true });
    temporaryDirectory = null;
  }
});

describe('A09 private parser request operation', () => {
  it('returns a one-use redacted request and removes the constrained child', async () => {
    temporaryDirectory = await mkdtemp(
      resolve(tmpdir(), 'droneworks-a09-request-'),
    );
    const path = resolve(temporaryDirectory, 'source.bin');
    const content = Buffer.from('generated exact keychain request source');
    await writeFile(path, content, { mode: 0o400 });
    const source = {
      bytes: content.length,
      path,
      sha256: createHash('sha256').update(content).digest('hex'),
    };
    content.fill(0);
    const stdout = Buffer.from(
      JSON.stringify({
        kind: 'keychain_request',
        request,
        schema_version: 1,
      }),
    );
    const runtime = {
      created: null,
      removed: 0,
      async create(arguments_) {
        this.created = arguments_;
      },
      async inspect() {
        return {
          Config: {
            Env: ['PATH=/usr/bin'],
            User: defaultParserConstraints.containerUser,
          },
          HostConfig: {
            CapDrop: ['ALL'],
            Memory: defaultParserConstraints.memoryMb * 1024 * 1024,
            MemorySwap: defaultParserConstraints.memoryMb * 1024 * 1024,
            NanoCpus: defaultParserConstraints.cpus * 1_000_000_000,
            NetworkMode: 'none',
            OomKillDisable: false,
            PidsLimit: defaultParserConstraints.pidsLimit,
            Privileged: false,
            ReadonlyRootfs: true,
            SecurityOpt: ['no-new-privileges:true'],
            Tmpfs: {
              '/tmp': `rw,noexec,nosuid,size=${defaultParserConstraints.tmpfsMb}m`,
            },
          },
          Mounts: [{ Destination: '/input/source.bin', RW: false }],
        };
      },
      async remove() {
        this.removed += 1;
      },
      async start() {
        return {
          error: false,
          exitCode: 0,
          signal: null,
          stderrBytes: 0,
          stdout,
          stdoutBytes: stdout.length,
          stopReason: null,
          totalOutputBytes: stdout.length,
        };
      },
      async state() {
        return { ExitCode: 0, OOMKilled: false };
      },
    };
    const result = await new ParserSupervisor({
      image: `sha256:${'a'.repeat(64)}`,
      runtime,
    }).buildKeychainRequest(source);
    expect(result.summary.status).toBe('keychain_request_ready');
    expect(JSON.stringify(result)).not.toContain(
      request.keychainsArray[0][0].aesCiphertext,
    );
    expect(runtime.created.slice(-3)).toEqual([
      '/input/source.bin',
      '--output',
      'keychain-request',
    ]);
    expect(runtime.removed).toBe(1);
    expect(result.consume()).toEqual(request);
    expect(() => result.consume()).toThrow('unavailable');
  });

  it('composes authorization, request extraction, and decode without payload output', async () => {
    const store = new MemoryStore();
    store.authorizationValue = authorization();
    const provider = new MockProvider();
    let deliveredInput;
    const parser = {
      async buildKeychainRequest() {
        return new PrivateKeychainRequest(
          {
            department: 7,
            featurePoints: 1,
            groups: 1,
            requestVersion: 4,
            schemaVersion: 1,
            serializedBytes: JSON.stringify(request).length,
            sourceHashVerified: true,
            status: 'keychain_request_ready',
          },
          request,
        );
      },
      async run(_source, privateInput) {
        deliveredInput = Buffer.from(privateInput);
        return Object.freeze({
          boundary: null,
          failureCode: 'truncated_source',
          process: null,
          schemaVersion: 1,
          status: 'failed',
        });
      },
    };
    const result = await new DjiV14ProcessingService({
      broker: new KeychainBroker({ provider, store }),
      parser,
    }).process(context, {
      bytes: 1,
      path: '/generated/source',
      sha256: 'a'.repeat(64),
    });
    expect(result.failureCode).toBe('truncated_source');
    expect(provider.calls).toBe(1);
    expect(JSON.parse(deliveredInput.toString('utf8'))).toEqual({ keychains });
    expect(JSON.stringify(result)).not.toContain(keychains[0][0].aesKey);
    deliveredInput.fill(0);
  });
});
