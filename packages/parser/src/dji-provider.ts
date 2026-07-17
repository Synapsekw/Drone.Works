import {
  KeychainProviderError,
  validateKeychainRequest,
  type KeychainProvider,
  type KeychainRequest,
  type KeychainRequestMetadata,
  type KeychainResponse,
} from './keychain.js';

export const djiKeychainEndpoint =
  'https://dev.dji.com/openapi/v1/flight-records/keychains';

function normalizedEndpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('Invalid keychain provider endpoint.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError(
      'Keychain provider endpoint cannot contain credentials, query, or fragment.',
    );
  }
  return url;
}

function loopback(hostname: string): boolean {
  return ['127.0.0.1', '::1', 'localhost'].includes(hostname);
}

async function boundedBody(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await response.body?.cancel();
    throw new KeychainProviderError('invalid_keychain_response');
  }
  if (!response.body)
    throw new KeychainProviderError('invalid_keychain_response');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new KeychainProviderError('invalid_keychain_response');
      }
      chunks.push(Buffer.from(next.value));
    }
    return Buffer.concat(chunks, total).toString('utf8');
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}

export class DjiKeychainProvider implements KeychainProvider {
  readonly id = 'dji-flight-record-api-v1';
  readonly #credentialProvider: () => Promise<string>;
  readonly #endpoint: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #maximumResponseBytes: number;
  readonly #timeoutMs: number;

  constructor(
    input: Readonly<{
      allowedEndpoints?: readonly string[];
      allowInsecureLoopback?: boolean;
      credentialProvider: () => Promise<string>;
      endpoint?: string;
      externalNetworkAuthorized?: boolean;
      fetchImplementation?: typeof globalThis.fetch;
      maximumResponseBytes?: number;
      timeoutMs?: number;
    }>,
  ) {
    const endpoint = normalizedEndpoint(input.endpoint ?? djiKeychainEndpoint);
    const allowlist = new Set(
      (input.allowedEndpoints ?? [djiKeychainEndpoint]).map(
        (value) => normalizedEndpoint(value).href,
      ),
    );
    if (!allowlist.has(endpoint.href)) {
      throw new TypeError('Keychain provider endpoint is not allowlisted.');
    }
    const secure = endpoint.protocol === 'https:';
    const insecureTest =
      input.allowInsecureLoopback === true &&
      endpoint.protocol === 'http:' &&
      loopback(endpoint.hostname);
    if (!secure && !insecureTest) {
      throw new TypeError('Keychain provider endpoint must use HTTPS.');
    }
    if (secure && input.externalNetworkAuthorized !== true) {
      throw new TypeError(
        'External keychain provider network access is not authorized.',
      );
    }
    const timeoutMs = input.timeoutMs ?? 5000;
    const maximumResponseBytes = input.maximumResponseBytes ?? 256 * 1024;
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 60_000
    ) {
      throw new TypeError('Invalid keychain provider timeout.');
    }
    if (
      !Number.isSafeInteger(maximumResponseBytes) ||
      maximumResponseBytes < 1 ||
      maximumResponseBytes > 4 * 1024 * 1024
    ) {
      throw new TypeError('Invalid keychain provider response limit.');
    }
    this.#credentialProvider = input.credentialProvider;
    this.#endpoint = endpoint.href;
    this.#fetch = input.fetchImplementation ?? globalThis.fetch;
    this.#maximumResponseBytes = maximumResponseBytes;
    this.#timeoutMs = timeoutMs;
  }

  async fetchKeychains(
    input: Readonly<{
      request: KeychainRequest;
      requestMetadata: KeychainRequestMetadata;
    }>,
  ): Promise<KeychainResponse> {
    if (!validateKeychainRequest(input.request).valid) {
      throw new KeychainProviderError('invalid_keychain_request');
    }
    let credential: string;
    try {
      credential = await this.#credentialProvider();
    } catch {
      throw new KeychainProviderError('key_service_unavailable');
    }
    if (
      credential.length < 1 ||
      credential.length > 4096 ||
      /[\r\n]/.test(credential)
    ) {
      throw new KeychainProviderError('key_rejected');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    timeout.unref();
    try {
      const response = await this.#fetch(this.#endpoint, {
        body: JSON.stringify(input.request),
        headers: {
          Accept: 'application/json',
          'Api-Key': credential,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        redirect: 'manual',
        signal: controller.signal,
      }).catch(() => {
        throw new KeychainProviderError('key_service_unavailable');
      });
      if (response.status === 429) {
        await response.body?.cancel();
        throw new KeychainProviderError('key_service_rate_limited');
      }
      if (response.status >= 400 && response.status < 500) {
        await response.body?.cancel();
        throw new KeychainProviderError('key_rejected');
      }
      if (response.status < 200 || response.status >= 300) {
        await response.body?.cancel();
        throw new KeychainProviderError('key_service_unavailable');
      }
      if (
        !(response.headers.get('content-type') ?? '')
          .toLowerCase()
          .includes('application/json')
      ) {
        await response.body?.cancel();
        throw new KeychainProviderError('invalid_keychain_response');
      }
      const body = await boundedBody(response, this.#maximumResponseBytes);
      let envelope: unknown;
      try {
        envelope = JSON.parse(body);
      } catch {
        throw new KeychainProviderError('invalid_keychain_response');
      }
      if (!envelope || typeof envelope !== 'object' || !('data' in envelope)) {
        throw new KeychainProviderError('invalid_keychain_response');
      }
      return (envelope as { readonly data: KeychainResponse }).data;
    } finally {
      clearTimeout(timeout);
    }
  }
}
