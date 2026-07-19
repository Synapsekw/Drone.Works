import { createHash } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type FlightNormalizationRepository,
  type ImportJobTarget,
  type ImportProcessingRepository,
  type ImportWorkerFailureCode,
  type StoredImmutableObject,
  type TelemetryObjectStore,
} from '@drone-works/database';
import {
  DjiV14ProcessingService,
  classifyDjiFormat,
  type DjiV14ProcessingResult,
} from '@drone-works/parser';

interface ExactObject extends StoredImmutableObject {
  readonly body: Buffer;
}

function objectUrl(baseUrl: URL, key: string, versionId?: string): URL {
  const url = new URL(`/objects/${encodeURIComponent(key)}`, baseUrl);
  if (versionId) url.searchParams.set('version_id', versionId);
  return url;
}

function objectMetadata(response: Response): StoredImmutableObject {
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

export class LoopbackWorkerObjectStore implements TelemetryObjectStore {
  readonly #baseUrl: URL;

  constructor(baseUrl: string | URL) {
    this.#baseUrl = new URL(baseUrl);
    if (
      this.#baseUrl.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '::1'].includes(this.#baseUrl.hostname)
    ) {
      throw new Error('The local worker object adapter requires loopback.');
    }
  }

  async getExact(key: string, versionId: string): Promise<ExactObject | null> {
    const response = await fetch(objectUrl(this.#baseUrl, key, versionId));
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('The exact object read failed.');
    const metadata = objectMetadata(response);
    const body = Buffer.from(await response.arrayBuffer());
    if (
      metadata.versionId !== versionId ||
      metadata.byteSize !== body.byteLength
    ) {
      body.fill(0);
      throw new Error('The exact object read was inconsistent.');
    }
    return { ...metadata, body };
  }

  async putIfAbsent(
    key: string,
    content: Buffer,
    mediaType: string,
    expectedSha256: string,
  ): Promise<StoredImmutableObject> {
    if (createHash('sha256').update(content).digest('hex') !== expectedSha256) {
      throw new Error('The telemetry object digest is inconsistent.');
    }
    const response = await fetch(objectUrl(this.#baseUrl, key), {
      body: new Uint8Array(content),
      headers: {
        'content-type': mediaType,
        'x-content-sha256': expectedSha256,
      },
      method: 'PUT',
    });
    if (response.status === 409) {
      const existing = await fetch(objectUrl(this.#baseUrl, key), {
        method: 'HEAD',
      });
      if (!existing.ok) throw new Error('The immutable object conflicts.');
      const metadata = objectMetadata(existing);
      if (
        metadata.contentSha256 !== expectedSha256 ||
        metadata.byteSize !== content.byteLength ||
        metadata.mediaType !== mediaType
      ) {
        throw new Error('The immutable object conflicts.');
      }
      return metadata;
    }
    if (!response.ok) throw new Error('The telemetry object write failed.');
    return objectMetadata(response);
  }

  async deleteExact(key: string, versionId: string): Promise<void> {
    const response = await fetch(objectUrl(this.#baseUrl, key, versionId), {
      method: 'DELETE',
    });
    if (response.status !== 204 && response.status !== 404) {
      throw new Error('The exact object deletion failed.');
    }
  }
}

function terminalFailure(
  result: Exclude<
    DjiV14ProcessingResult,
    { readonly status: 'intermediate_ready' }
  >,
): ImportWorkerFailureCode {
  return 'failureCode' in result
    ? (result.failureCode as ImportWorkerFailureCode)
    : 'parser_runtime_error';
}

function detectSource(bytes: Buffer): ImportWorkerFailureCode | null {
  if (bytes.length <= 10) return 'unsupported_format';
  const support = classifyDjiFormat({
    formatFamily: 'dji_txt',
    formatVersion: bytes[10] ?? -1,
  });
  if (support.status === 'unsupported') return support.failureCode;
  if (bytes.length < 12) return 'invalid_source';
  const prefixBytes = bytes.readBigUInt64LE(0);
  if (prefixBytes < 12n || prefixBytes > BigInt(bytes.length)) {
    return 'invalid_source';
  }
  return null;
}

export class FunctionalImportProcessor {
  readonly #imports: Pick<ImportProcessingRepository, 'fail' | 'markStage'>;
  readonly #normalization: Pick<FlightNormalizationRepository, 'process'>;
  readonly #objectStore: LoopbackWorkerObjectStore;
  readonly #pauseAfterClaimMs: number;
  readonly #processing: DjiV14ProcessingService;

  constructor(
    input: Readonly<{
      imports: Pick<ImportProcessingRepository, 'fail' | 'markStage'>;
      normalization: Pick<FlightNormalizationRepository, 'process'>;
      objectStore: LoopbackWorkerObjectStore;
      pauseAfterClaimMs?: number;
      processing: DjiV14ProcessingService;
    }>,
  ) {
    this.#imports = input.imports;
    this.#normalization = input.normalization;
    this.#objectStore = input.objectStore;
    this.#pauseAfterClaimMs = input.pauseAfterClaimMs ?? 0;
    this.#processing = input.processing;
  }

  async process(
    organizationId: string,
    target: ImportJobTarget,
  ): Promise<void> {
    if (
      !(await this.#imports.markStage(
        organizationId,
        target.importId,
        'detecting',
      ))
    ) {
      return;
    }
    if (target.state === 'queued' && this.#pauseAfterClaimMs > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.#pauseAfterClaimMs),
      );
    }
    const exact = await this.#objectStore.getExact(
      target.objectKey,
      target.objectVersionId,
    );
    if (!exact) throw new Error('The retained raw object is unavailable.');
    try {
      const digest = createHash('sha256').update(exact.body).digest('hex');
      if (
        exact.versionId !== target.objectVersionId ||
        exact.byteSize !== target.byteSize ||
        exact.mediaType !== target.mediaType ||
        exact.contentSha256 !== target.contentSha256 ||
        digest !== target.contentSha256
      ) {
        await this.#imports.fail(
          organizationId,
          target.importId,
          'source_identity_mismatch',
        );
        return;
      }
      const detectedFailure = detectSource(exact.body);
      if (detectedFailure) {
        await this.#imports.fail(
          organizationId,
          target.importId,
          detectedFailure,
        );
        return;
      }
      if (
        !(await this.#imports.markStage(
          organizationId,
          target.importId,
          'parsing',
        ))
      ) {
        return;
      }
      const directory = await mkdtemp(join(tmpdir(), 'droneworks-source-'));
      const sourcePath = join(directory, 'source.bin');
      try {
        await writeFile(sourcePath, exact.body, { mode: 0o400 });
        await chmod(sourcePath, 0o400);
        const parsed = await this.#processing.process(
          {
            logVersion: 14,
            organizationId,
            parserId: 'dji-log-parser@0.5.7',
            rawSourceId: target.rawSourceId,
          },
          {
            bytes: target.byteSize,
            path: sourcePath,
            sha256: target.contentSha256,
          },
        );
        if (parsed.status !== 'intermediate_ready') {
          await this.#imports.fail(
            organizationId,
            target.importId,
            terminalFailure(parsed),
          );
          return;
        }
        if (
          !(await this.#imports.markStage(
            organizationId,
            target.importId,
            'normalizing',
          ))
        ) {
          parsed.destroy();
          return;
        }
        await this.#normalization.process(
          organizationId,
          target.importId,
          parsed,
        );
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    } finally {
      exact.body.fill(0);
    }
  }
}
