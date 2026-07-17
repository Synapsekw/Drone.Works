import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, lstat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

import {
  PrivateParserIntermediate,
  validatePrivateIntermediate,
  type PrivateIntermediateSummary,
} from './intermediate.js';
import {
  PrivateKeychainRequest,
  validateKeychainRequest,
  type KeychainRequest,
} from './keychain.js';

export const defaultParserConstraints = Object.freeze({
  containerUser: '65532:65532',
  cpus: 1,
  maxPrivateInputBytes: 262_144,
  maxOutputBytes: 32 * 1024 * 1024,
  maxSourceBytes: 32 * 1024 * 1024,
  memoryMb: 192,
  pidsLimit: 16,
  timeoutMs: 15_000,
  tmpfsMb: 16,
});

export interface ParserConstraints {
  readonly containerUser: string;
  readonly cpus: number;
  readonly maxPrivateInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxSourceBytes: number;
  readonly memoryMb: number;
  readonly pidsLimit: number;
  readonly timeoutMs: number;
  readonly tmpfsMb: number;
}

export interface ExactParserSource {
  readonly bytes: number;
  readonly path: string;
  readonly sha256: string;
}

export interface OciInspection {
  readonly Config?: {
    readonly Env?: readonly string[];
    readonly User?: string;
  };
  readonly HostConfig?: {
    readonly CapDrop?: readonly string[];
    readonly Memory?: number;
    readonly MemorySwap?: number;
    readonly NanoCpus?: number;
    readonly NetworkMode?: string;
    readonly OomKillDisable?: boolean;
    readonly PidsLimit?: number;
    readonly Privileged?: boolean;
    readonly ReadonlyRootfs?: boolean;
    readonly SecurityOpt?: readonly string[];
    readonly Tmpfs?: Readonly<Record<string, string>>;
  };
  readonly Mounts?: readonly {
    readonly Destination?: string;
    readonly RW?: boolean;
  }[];
}

export interface OciExecution {
  readonly error: boolean;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stderrBytes: number;
  readonly stdout: Buffer;
  readonly stdoutBytes: number;
  readonly stopReason: 'output' | 'timeout' | null;
  readonly totalOutputBytes: number;
}

export interface OciState {
  readonly ExitCode?: number;
  readonly OOMKilled?: boolean;
}

export interface ParserOciRuntime {
  create(arguments_: readonly string[]): Promise<void>;
  inspect(name: string): Promise<OciInspection>;
  remove(name: string): Promise<void>;
  start(
    name: string,
    privateInput: Buffer,
    limits: Readonly<{ maxOutputBytes: number; timeoutMs: number }>,
  ): Promise<OciExecution>;
  state(name: string): Promise<OciState>;
}

export type ParserFailureCode =
  | 'boundary_violation'
  | 'invalid_source'
  | 'invalid_worker_output'
  | 'parser_memory_limit'
  | 'parser_cleanup_failed'
  | 'parser_output_limit'
  | 'parser_panic'
  | 'parser_runtime_error'
  | 'parser_wall_time_limit'
  | 'private_input_invalid'
  | 'private_input_limit'
  | 'source_identity_mismatch'
  | 'source_input_limit'
  | 'source_unavailable'
  | 'truncated_source';

export interface ParserFailure {
  readonly boundary: ParserBoundarySummary | null;
  readonly failureCode: ParserFailureCode;
  readonly process: ParserProcessSummary | null;
  readonly schemaVersion: 1;
  readonly status: 'failed';
}

interface ParserBoundarySummary {
  readonly cpus: number;
  readonly memoryMb: number;
  readonly network: 'none';
  readonly pidsLimit: number;
  readonly rootFilesystem: 'read_only';
  readonly tmpfsMb: number;
  readonly user: string;
  readonly validated: true;
}

interface ParserProcessSummary {
  readonly exitCode: number | null;
  readonly oomKilled: boolean;
  readonly stderrBytes: number;
  readonly stdoutBytes: number;
  readonly totalOutputBytes: number;
  readonly wallMs: number;
}

function positiveNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be positive.`);
  }
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return value;
}

function validatedConstraints(
  options: Partial<ParserConstraints>,
): ParserConstraints {
  const constraints = { ...defaultParserConstraints, ...options };
  positiveNumber(constraints.cpus, 'cpus');
  for (const key of [
    'maxPrivateInputBytes',
    'maxOutputBytes',
    'maxSourceBytes',
    'memoryMb',
    'pidsLimit',
    'timeoutMs',
    'tmpfsMb',
  ] as const) {
    positiveInteger(constraints[key], key);
  }
  if (!/^\d+:\d+$/.test(constraints.containerUser)) {
    throw new TypeError('containerUser must be a numeric user and group.');
  }
  return Object.freeze(constraints);
}

function requireImageDigest(image: string): string {
  if (
    !/^sha256:[0-9a-f]{64}$/.test(image) &&
    !/^\S+@sha256:[0-9a-f]{64}$/.test(image)
  ) {
    throw new TypeError('The parser image must be content-addressed.');
  }
  return image;
}

function requireSource(source: ExactParserSource): ExactParserSource {
  if (
    !Number.isSafeInteger(source.bytes) ||
    source.bytes < 1 ||
    !/^[0-9a-f]{64}$/.test(source.sha256) ||
    !source.path
  ) {
    throw new TypeError('The exact parser source is invalid.');
  }
  return source;
}

export function buildParserCreateArguments(input: {
  readonly constraints?: Partial<ParserConstraints>;
  readonly image: string;
  readonly name: string;
  readonly operation?: 'decode' | 'keychain_request';
  readonly sourcePath: string;
}): readonly string[] {
  const constraints = validatedConstraints(input.constraints ?? {});
  if (!input.name)
    throw new TypeError('The parser container name is required.');
  return Object.freeze([
    'create',
    '--interactive',
    '--name',
    input.name,
    '--network',
    'none',
    '--read-only',
    '--user',
    constraints.containerUser,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--cpus',
    String(constraints.cpus),
    '--memory',
    `${constraints.memoryMb}m`,
    '--memory-swap',
    `${constraints.memoryMb}m`,
    '--pids-limit',
    String(constraints.pidsLimit),
    '--ulimit',
    'core=0:0',
    '--ulimit',
    'nofile=64:64',
    '--tmpfs',
    `/tmp:rw,noexec,nosuid,size=${constraints.tmpfsMb}m`,
    '--mount',
    `type=bind,source=${resolve(input.sourcePath)},target=/input/source.bin,readonly`,
    requireImageDigest(input.image),
    ...(input.operation === 'keychain_request'
      ? ['/input/source.bin', '--output', 'keychain-request']
      : []),
  ]);
}

export function validateParserInspection(
  inspection: OciInspection,
  options: Partial<ParserConstraints> = {},
): readonly string[] {
  const constraints = validatedConstraints(options);
  const host = inspection.HostConfig ?? {};
  const config = inspection.Config ?? {};
  const errors: string[] = [];
  const expectedMemory = constraints.memoryMb * 1024 * 1024;
  const expectedNanoCpus = Math.round(constraints.cpus * 1_000_000_000);
  const input = inspection.Mounts?.find(
    (mount) => mount.Destination === '/input/source.bin',
  );
  if (host.NetworkMode !== 'none') errors.push('network');
  if (host.ReadonlyRootfs !== true) errors.push('root_filesystem');
  if (host.Privileged === true) errors.push('privileged');
  if (host.OomKillDisable === true) errors.push('oom_kill');
  if (host.Memory !== expectedMemory) errors.push('memory');
  if (host.MemorySwap !== expectedMemory) errors.push('swap');
  if (host.NanoCpus !== expectedNanoCpus) errors.push('cpu');
  if (host.PidsLimit !== constraints.pidsLimit) errors.push('pids');
  if (!host.CapDrop?.includes('ALL')) errors.push('capabilities');
  if (
    !host.SecurityOpt?.some((value) => value.startsWith('no-new-privileges'))
  ) {
    errors.push('new_privileges');
  }
  const tmpfs = host.Tmpfs?.['/tmp'] ?? '';
  if (
    !tmpfs.includes(`size=${constraints.tmpfsMb}m`) ||
    !tmpfs.includes('noexec') ||
    !tmpfs.includes('nosuid')
  ) {
    errors.push('tmpfs');
  }
  if (config.User !== constraints.containerUser) errors.push('user');
  if (!input || input.RW !== false) errors.push('source_mount');
  if (
    inspection.Mounts?.some(
      (mount) => mount.Destination !== '/input/source.bin',
    )
  ) {
    errors.push('unexpected_mount');
  }
  if (
    config.Env?.some((entry) =>
      /^(AWS|PG|DATABASE|DJI|AUTH|SECRET|TOKEN|CREDENTIAL|KEYCHAIN)/i.test(
        entry.split('=', 1)[0] ?? '',
      ),
    )
  ) {
    errors.push('secret_environment');
  }
  return Object.freeze(errors);
}

async function hashSource(
  path: string,
  maxBytes: number,
): Promise<{ bytes: number; sha256: string }> {
  await access(path);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('Source must be a regular file.');
  }
  if (metadata.size > maxBytes) throw new SourceInputLimitError();
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const value of createReadStream(path)) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    bytes += chunk.length;
    if (bytes > maxBytes) {
      chunk.fill(0);
      throw new SourceInputLimitError();
    }
    hash.update(chunk);
    chunk.fill(0);
  }
  return { bytes, sha256: hash.digest('hex') };
}

class SourceInputLimitError extends Error {}

function boundary(constraints: ParserConstraints): ParserBoundarySummary {
  return Object.freeze({
    cpus: constraints.cpus,
    memoryMb: constraints.memoryMb,
    network: 'none',
    pidsLimit: constraints.pidsLimit,
    rootFilesystem: 'read_only',
    tmpfsMb: constraints.tmpfsMb,
    user: constraints.containerUser,
    validated: true,
  });
}

function processSummary(
  execution: OciExecution,
  state: OciState,
  wallMs: number,
): ParserProcessSummary {
  return Object.freeze({
    exitCode: state.ExitCode ?? execution.exitCode,
    oomKilled: state.OOMKilled === true,
    stderrBytes: execution.stderrBytes,
    stdoutBytes: execution.stdoutBytes,
    totalOutputBytes: execution.totalOutputBytes,
    wallMs,
  });
}

function failed(
  failureCode: ParserFailureCode,
  boundarySummary: ParserBoundarySummary | null = null,
  process: ParserProcessSummary | null = null,
): ParserFailure {
  return Object.freeze({
    boundary: boundarySummary,
    failureCode,
    process,
    schemaVersion: 1,
    status: 'failed',
  });
}

function parserFailure(stdout: Buffer): ParserFailureCode {
  try {
    const value = JSON.parse(stdout.toString('utf8').trim()) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return 'invalid_worker_output';
    }
    const row = value as Record<string, unknown>;
    const keys = Object.keys(row).sort();
    if (
      keys.join(',') !== 'failure_code,kind,schema_version,status' ||
      row.schema_version !== 1 ||
      row.kind !== 'decode_summary' ||
      row.status !== 'decode_failed' ||
      typeof row.failure_code !== 'string'
    ) {
      return 'invalid_worker_output';
    }
    switch (row.failure_code) {
      case 'truncated_records':
        return 'truncated_source';
      case 'decode_failed':
      case 'invalid_or_corrupt_prefix':
        return 'invalid_source';
      case 'invalid_keychain_response':
      case 'parser_input_limit':
        return 'private_input_invalid';
      case 'parser_internal_error':
        return 'parser_panic';
      default:
        return 'parser_runtime_error';
    }
  } catch {
    return 'invalid_worker_output';
  }
}

export class ParserSupervisor {
  readonly #constraints: ParserConstraints;
  readonly #image: string;
  readonly #runtime: ParserOciRuntime;

  constructor(input: {
    readonly constraints?: Partial<ParserConstraints>;
    readonly image: string;
    readonly runtime: ParserOciRuntime;
  }) {
    this.#constraints = validatedConstraints(input.constraints ?? {});
    this.#image = requireImageDigest(input.image);
    this.#runtime = input.runtime;
  }

  async #executeCreated(
    name: string,
    privateInput: Buffer,
    trustedSource: Readonly<{ bytes: number; sha256: string }>,
    boundarySummary: ParserBoundarySummary,
    started: number,
  ): Promise<ParserFailure | PrivateParserIntermediate> {
    let execution: OciExecution | null = null;
    try {
      const inspection = await this.#runtime.inspect(name);
      if (validateParserInspection(inspection, this.#constraints).length > 0) {
        return failed('boundary_violation');
      }
      execution = await this.#runtime.start(name, privateInput, {
        maxOutputBytes: this.#constraints.maxOutputBytes,
        timeoutMs: this.#constraints.timeoutMs,
      });
      const state = await this.#runtime.state(name);
      const process = processSummary(
        execution,
        state,
        performance.now() - started,
      );
      if (execution.stopReason === 'timeout') {
        return failed('parser_wall_time_limit', boundarySummary, process);
      }
      if (execution.stopReason === 'output') {
        return failed('parser_output_limit', boundarySummary, process);
      }
      if (state.OOMKilled === true) {
        return failed('parser_memory_limit', boundarySummary, process);
      }
      if (execution.error) {
        return failed('parser_runtime_error', boundarySummary, process);
      }
      if ((state.ExitCode ?? execution.exitCode) !== 0) {
        return failed(
          parserFailure(execution.stdout),
          boundarySummary,
          process,
        );
      }

      try {
        const value = JSON.parse(execution.stdout.toString('utf8')) as unknown;
        const validated = validatePrivateIntermediate(value, trustedSource);
        const summary: PrivateIntermediateSummary = Object.freeze({
          boundary: boundarySummary,
          contract: Object.freeze({
            kind: 'dji_parser_intermediate',
            schemaVersion: 1,
          }),
          material: Object.freeze({
            ...validated.shape,
            bytes: execution.stdout.length,
            sha256: createHash('sha256').update(execution.stdout).digest('hex'),
            sourceHashVerified: true,
          }),
          process,
          schemaVersion: 1,
          status: 'intermediate_ready',
        });
        return new PrivateParserIntermediate(summary, validated.value);
      } catch {
        return failed('invalid_worker_output', boundarySummary, process);
      }
    } finally {
      execution?.stdout.fill(0);
    }
  }

  async #executeKeychainRequestCreated(
    name: string,
    boundarySummary: ParserBoundarySummary,
    started: number,
  ): Promise<ParserFailure | PrivateKeychainRequest> {
    let execution: OciExecution | null = null;
    try {
      const inspection = await this.#runtime.inspect(name);
      if (validateParserInspection(inspection, this.#constraints).length > 0) {
        return failed('boundary_violation');
      }
      execution = await this.#runtime.start(name, Buffer.alloc(0), {
        maxOutputBytes: this.#constraints.maxPrivateInputBytes,
        timeoutMs: this.#constraints.timeoutMs,
      });
      const state = await this.#runtime.state(name);
      const process = processSummary(
        execution,
        state,
        performance.now() - started,
      );
      if (execution.stopReason === 'timeout') {
        return failed('parser_wall_time_limit', boundarySummary, process);
      }
      if (execution.stopReason === 'output') {
        return failed('parser_output_limit', boundarySummary, process);
      }
      if (state.OOMKilled === true) {
        return failed('parser_memory_limit', boundarySummary, process);
      }
      if (execution.error || (state.ExitCode ?? execution.exitCode) !== 0) {
        return failed('parser_runtime_error', boundarySummary, process);
      }
      try {
        const envelope = JSON.parse(
          execution.stdout.toString('utf8'),
        ) as unknown;
        if (
          !envelope ||
          typeof envelope !== 'object' ||
          Array.isArray(envelope)
        ) {
          return failed('invalid_worker_output', boundarySummary, process);
        }
        const row = envelope as Record<string, unknown>;
        if (
          Object.keys(row).sort().join(',') !== 'kind,request,schema_version' ||
          row.kind !== 'keychain_request' ||
          row.schema_version !== 1
        ) {
          return failed('invalid_worker_output', boundarySummary, process);
        }
        const validated = validateKeychainRequest(row.request);
        if (!validated.valid) {
          return failed('invalid_worker_output', boundarySummary, process);
        }
        return new PrivateKeychainRequest(
          {
            department: validated.metadata.department,
            featurePoints: validated.metadata.featurePoints,
            groups: validated.metadata.groups,
            requestVersion: validated.metadata.requestVersion,
            schemaVersion: 1,
            serializedBytes: validated.metadata.serializedBytes,
            sourceHashVerified: true,
            status: 'keychain_request_ready',
          },
          row.request as KeychainRequest,
        );
      } catch {
        return failed('invalid_worker_output', boundarySummary, process);
      }
    } finally {
      execution?.stdout.fill(0);
    }
  }

  async buildKeychainRequest(
    requestedSource: ExactParserSource,
  ): Promise<ParserFailure | PrivateKeychainRequest> {
    const source = requireSource(requestedSource);
    if (source.bytes > this.#constraints.maxSourceBytes) {
      return failed('source_input_limit');
    }
    let trustedSource: { bytes: number; sha256: string };
    try {
      trustedSource = await hashSource(
        source.path,
        this.#constraints.maxSourceBytes,
      );
    } catch (error) {
      return failed(
        error instanceof SourceInputLimitError
          ? 'source_input_limit'
          : 'source_unavailable',
      );
    }
    if (
      trustedSource.bytes !== source.bytes ||
      trustedSource.sha256 !== source.sha256
    ) {
      return failed('source_identity_mismatch');
    }

    const name = `droneworks-parser-request-${randomUUID()}`;
    const boundarySummary = boundary(this.#constraints);
    const started = performance.now();
    let created = false;
    let result: ParserFailure | PrivateKeychainRequest;
    try {
      await this.#runtime.create(
        buildParserCreateArguments({
          constraints: this.#constraints,
          image: this.#image,
          name,
          operation: 'keychain_request',
          sourcePath: source.path,
        }),
      );
      created = true;
      result = await this.#executeKeychainRequestCreated(
        name,
        boundarySummary,
        started,
      );
    } catch {
      result = failed('parser_runtime_error', created ? boundarySummary : null);
    }
    if (created) {
      try {
        await this.#runtime.remove(name);
      } catch {
        if (result instanceof PrivateKeychainRequest) result.destroy();
        return failed('parser_cleanup_failed', boundarySummary);
      }
    }
    return result;
  }

  async run(
    requestedSource: ExactParserSource,
    privateInput: Buffer,
  ): Promise<ParserFailure | PrivateParserIntermediate> {
    const source = requireSource(requestedSource);
    if (source.bytes > this.#constraints.maxSourceBytes) {
      privateInput.fill(0);
      return failed('source_input_limit');
    }
    if (privateInput.length > this.#constraints.maxPrivateInputBytes) {
      privateInput.fill(0);
      return failed('private_input_limit');
    }
    let trustedSource: { bytes: number; sha256: string };
    try {
      trustedSource = await hashSource(
        source.path,
        this.#constraints.maxSourceBytes,
      );
    } catch (error) {
      privateInput.fill(0);
      if (error instanceof SourceInputLimitError) {
        return failed('source_input_limit');
      }
      return failed('source_unavailable');
    }
    if (
      trustedSource.bytes !== source.bytes ||
      trustedSource.sha256 !== source.sha256
    ) {
      privateInput.fill(0);
      return failed('source_identity_mismatch');
    }

    const name = `droneworks-parser-${randomUUID()}`;
    let created = false;
    let result: ParserFailure | PrivateParserIntermediate;
    const boundarySummary = boundary(this.#constraints);
    const started = performance.now();
    try {
      await this.#runtime.create(
        buildParserCreateArguments({
          constraints: this.#constraints,
          image: this.#image,
          name,
          sourcePath: source.path,
        }),
      );
      created = true;
      result = await this.#executeCreated(
        name,
        privateInput,
        trustedSource,
        boundarySummary,
        started,
      );
    } catch {
      result = failed('parser_runtime_error', created ? boundarySummary : null);
    } finally {
      privateInput.fill(0);
    }
    if (created) {
      try {
        await this.#runtime.remove(name);
      } catch {
        if (result instanceof PrivateParserIntermediate) result.destroy();
        return failed('parser_cleanup_failed', boundarySummary);
      }
    }
    return result;
  }
}
