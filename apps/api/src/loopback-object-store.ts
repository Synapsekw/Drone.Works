import { createHash } from 'node:crypto';

export interface ImmutableObject {
  readonly byteSize: number;
  readonly contentSha256: string;
  readonly mediaType: string;
  readonly versionId: string;
}

export class ObjectStoreConflictError extends Error {
  readonly statusCode = 409;

  constructor() {
    super('The immutable object key already contains different bytes.');
    this.name = 'ObjectStoreConflictError';
  }
}

export class ObjectStoreVerificationError extends Error {
  readonly statusCode = 409;

  constructor() {
    super('The stored object does not match the upload declaration.');
    this.name = 'ObjectStoreVerificationError';
  }
}

export interface ImmutableObjectStore {
  deleteExact(key: string, versionId: string): Promise<void>;
  headExact(key: string, versionId: string): Promise<ImmutableObject | null>;
  putIfAbsent(
    key: string,
    content: Buffer,
    mediaType: string,
    expectedSha256: string,
  ): Promise<ImmutableObject>;
}

function objectUrl(baseUrl: URL, key: string, versionId?: string): URL {
  const url = new URL(`/objects/${encodeURIComponent(key)}`, baseUrl);
  if (versionId) url.searchParams.set('version_id', versionId);
  return url;
}

function immutableObject(response: Response): ImmutableObject {
  const byteSize = Number(response.headers.get('x-byte-size'));
  const contentSha256 = response.headers.get('x-content-sha256');
  const mediaType = response.headers.get('x-stored-media-type');
  const versionId = response.headers.get('x-version-id');
  if (
    !Number.isSafeInteger(byteSize) ||
    !contentSha256 ||
    !mediaType ||
    !versionId
  ) {
    throw new Error('The object service returned incomplete metadata.');
  }
  return { byteSize, contentSha256, mediaType, versionId };
}

export class LoopbackImmutableObjectStore implements ImmutableObjectStore {
  readonly #baseUrl: URL;

  constructor(baseUrl: string | URL) {
    this.#baseUrl = new URL(baseUrl);
    if (
      this.#baseUrl.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '::1'].includes(this.#baseUrl.hostname)
    ) {
      throw new Error(
        'The development object adapter requires a loopback URL.',
      );
    }
  }

  async putIfAbsent(
    key: string,
    content: Buffer,
    mediaType: string,
    expectedSha256: string,
  ): Promise<ImmutableObject> {
    const digest = createHash('sha256').update(content).digest('hex');
    if (digest !== expectedSha256) throw new ObjectStoreVerificationError();
    const response = await fetch(objectUrl(this.#baseUrl, key), {
      body: new Uint8Array(content),
      headers: {
        'content-type': mediaType,
        'x-content-sha256': expectedSha256,
      },
      method: 'PUT',
    });
    if (response.status === 409) {
      const existing = await this.headByKey(key);
      if (
        existing?.contentSha256 === expectedSha256 &&
        existing.byteSize === content.byteLength &&
        existing.mediaType === mediaType
      ) {
        return existing;
      }
      throw new ObjectStoreConflictError();
    }
    if (!response.ok) {
      const error = new Error('The object service rejected the upload.');
      Object.assign(error, { statusCode: response.status });
      throw error;
    }
    return immutableObject(response);
  }

  async headExact(
    key: string,
    versionId: string,
  ): Promise<ImmutableObject | null> {
    const response = await fetch(objectUrl(this.#baseUrl, key, versionId), {
      method: 'HEAD',
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('The object service HEAD failed.');
    return immutableObject(response);
  }

  async deleteExact(key: string, versionId: string): Promise<void> {
    const response = await fetch(objectUrl(this.#baseUrl, key, versionId), {
      method: 'DELETE',
    });
    if (response.status !== 204 && response.status !== 404) {
      throw new Error('The object service exact-version delete failed.');
    }
  }

  private async headByKey(key: string): Promise<ImmutableObject | null> {
    const response = await fetch(objectUrl(this.#baseUrl, key), {
      method: 'HEAD',
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('The object service HEAD failed.');
    return immutableObject(response);
  }
}
