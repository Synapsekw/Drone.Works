import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, lstat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

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
import {
  defaultParserConstraints,
  type ExactParserSource,
  type ParserFailure,
  type ParserFailureCode,
} from './supervisor.js';

const sandboxExecutable = '/usr/bin/sandbox-exec';
const noNetworkProfile = '(version 1) (allow default) (deny network*)';

interface Execution {
  readonly exitCode: number | null;
  readonly outputLimited: boolean;
  readonly stderrBytes: number;
  readonly stdout: Buffer;
  readonly stdoutBytes: number;
  readonly timedOut: boolean;
  readonly totalOutputBytes: number;
  readonly wallMs: number;
}

function failure(
  failureCode: ParserFailureCode,
  execution?: Execution,
): ParserFailure {
  return Object.freeze({
    boundary: null,
    failureCode,
    process: execution
      ? Object.freeze({
          exitCode: execution.exitCode,
          oomKilled: false,
          stderrBytes: execution.stderrBytes,
          stdoutBytes: execution.stdoutBytes,
          totalOutputBytes: execution.totalOutputBytes,
          wallMs: execution.wallMs,
        })
      : null,
    schemaVersion: 1,
    status: 'failed',
  });
}

function childFailure(stdout: Buffer): ParserFailureCode {
  try {
    const value = JSON.parse(stdout.toString('utf8').trim()) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return 'invalid_worker_output';
    }
    const row = value as Record<string, unknown>;
    if (
      Object.keys(row).sort().join(',') !==
        'failure_code,kind,schema_version,status' ||
      row.schema_version !== 1 ||
      row.kind !== 'decode_summary' ||
      row.status !== 'decode_failed'
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

async function hashFile(
  path: string,
  maximumBytes: number,
): Promise<{ readonly bytes: number; readonly sha256: string }> {
  await access(path);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('The parser input must be a regular file.');
  }
  if (metadata.size > maximumBytes) {
    throw new RangeError('The parser input exceeds its local limit.');
  }
  const digest = createHash('sha256');
  let bytes = 0;
  for await (const value of createReadStream(path)) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    bytes += chunk.length;
    if (bytes > maximumBytes) {
      chunk.fill(0);
      throw new RangeError('The parser input exceeds its local limit.');
    }
    digest.update(chunk);
    chunk.fill(0);
  }
  return { bytes, sha256: digest.digest('hex') };
}

function minimalEnvironment(): NodeJS.ProcessEnv {
  return {
    LANG: process.env.LANG ?? 'C',
    LC_ALL: process.env.LC_ALL ?? 'C',
    PATH: process.env.PATH ?? '',
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
  };
}

async function execute(input: {
  readonly executable: string;
  readonly maxOutputBytes: number;
  readonly operation: 'intermediate' | 'keychain_request';
  readonly privateInput: Buffer;
  readonly sourcePath: string;
  readonly timeoutMs: number;
}): Promise<Execution> {
  const output: Buffer[] = [];
  let stderrBytes = 0;
  let totalOutputBytes = 0;
  let outputLimited = false;
  let timedOut = false;
  const args = [
    '-p',
    noNetworkProfile,
    input.executable,
    input.sourcePath,
    '--output',
    input.operation === 'intermediate' ? 'intermediate' : 'keychain-request',
  ];
  const started = performance.now();
  const child = spawn(sandboxExecutable, args, {
    env: minimalEnvironment(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.on('error', () => undefined);
  child.stdin.end(input.privateInput);
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, input.timeoutMs);
  timer.unref();
  child.stdout.on('data', (value: Buffer) => {
    totalOutputBytes += value.length;
    if (totalOutputBytes <= input.maxOutputBytes) {
      output.push(Buffer.from(value));
    }
    if (totalOutputBytes > input.maxOutputBytes && !outputLimited) {
      outputLimited = true;
      child.kill('SIGKILL');
    }
  });
  child.stderr.on('data', (value: Buffer) => {
    stderrBytes += value.length;
  });
  const exitCode = await new Promise<number | null>((resolve) => {
    child.once('error', () => resolve(null));
    child.once('close', (code) => resolve(code));
  });
  clearTimeout(timer);
  return {
    exitCode,
    outputLimited,
    stderrBytes,
    stdout: Buffer.concat(output),
    stdoutBytes: output.reduce((total, value) => total + value.length, 0),
    timedOut,
    totalOutputBytes,
    wallMs: performance.now() - started,
  };
}

export class LocalNativeParserOperations {
  readonly #executable: string;
  readonly #executableSha256: string;
  #verified = false;

  constructor(
    input: Readonly<{
      environment: 'local' | 'production' | 'staging' | 'test';
      executable: string;
      executableSha256: string;
    }>,
  ) {
    if (!['local', 'test'].includes(input.environment)) {
      throw new Error('The local native parser is unavailable in hosted mode.');
    }
    if (process.platform !== 'darwin') {
      throw new Error(
        'The no-Docker local native parser requires macOS sandbox-exec.',
      );
    }
    if (!/^[0-9a-f]{64}$/.test(input.executableSha256)) {
      throw new TypeError('The local parser executable digest is invalid.');
    }
    this.#executable = input.executable;
    this.#executableSha256 = input.executableSha256;
  }

  async #verifyExecutable(): Promise<void> {
    if (this.#verified) return;
    await access(sandboxExecutable);
    const actual = await hashFile(this.#executable, 8 * 1024 * 1024);
    if (actual.sha256 !== this.#executableSha256) {
      throw new Error('The local parser executable digest does not match.');
    }
    this.#verified = true;
  }

  async #trustedSource(
    source: ExactParserSource,
  ): Promise<Readonly<{ bytes: number; sha256: string }> | ParserFailure> {
    if (source.bytes > defaultParserConstraints.maxSourceBytes) {
      return failure('source_input_limit');
    }
    try {
      const trusted = await hashFile(
        source.path,
        defaultParserConstraints.maxSourceBytes,
      );
      if (trusted.bytes !== source.bytes || trusted.sha256 !== source.sha256) {
        return failure('source_identity_mismatch');
      }
      return trusted;
    } catch (error) {
      return failure(
        error instanceof RangeError
          ? 'source_input_limit'
          : 'source_unavailable',
      );
    }
  }

  async buildKeychainRequest(
    source: ExactParserSource,
  ): Promise<ParserFailure | PrivateKeychainRequest> {
    await this.#verifyExecutable();
    const trusted = await this.#trustedSource(source);
    if ('status' in trusted) return trusted;
    const execution = await execute({
      executable: this.#executable,
      maxOutputBytes: defaultParserConstraints.maxPrivateInputBytes,
      operation: 'keychain_request',
      privateInput: Buffer.alloc(0),
      sourcePath: source.path,
      timeoutMs: defaultParserConstraints.timeoutMs,
    });
    try {
      if (execution.timedOut) {
        return failure('parser_wall_time_limit', execution);
      }
      if (execution.outputLimited) {
        return failure('parser_output_limit', execution);
      }
      if (execution.exitCode !== 0) {
        return failure(childFailure(execution.stdout), execution);
      }
      const envelope = JSON.parse(execution.stdout.toString('utf8')) as unknown;
      if (
        !envelope ||
        typeof envelope !== 'object' ||
        Array.isArray(envelope)
      ) {
        return failure('invalid_worker_output', execution);
      }
      const row = envelope as Record<string, unknown>;
      if (
        Object.keys(row).sort().join(',') !== 'kind,request,schema_version' ||
        row.kind !== 'keychain_request' ||
        row.schema_version !== 1
      ) {
        return failure('invalid_worker_output', execution);
      }
      const validated = validateKeychainRequest(row.request);
      if (!validated.valid) {
        return failure('invalid_worker_output', execution);
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
      return failure('invalid_worker_output', execution);
    } finally {
      execution.stdout.fill(0);
    }
  }

  async run(
    source: ExactParserSource,
    privateInput: Buffer,
  ): Promise<ParserFailure | PrivateParserIntermediate> {
    try {
      await this.#verifyExecutable();
      if (privateInput.length > defaultParserConstraints.maxPrivateInputBytes) {
        return failure('private_input_limit');
      }
      const trusted = await this.#trustedSource(source);
      if ('status' in trusted) return trusted;
      const execution = await execute({
        executable: this.#executable,
        maxOutputBytes: defaultParserConstraints.maxOutputBytes,
        operation: 'intermediate',
        privateInput,
        sourcePath: source.path,
        timeoutMs: defaultParserConstraints.timeoutMs,
      });
      try {
        if (execution.timedOut) {
          return failure('parser_wall_time_limit', execution);
        }
        if (execution.outputLimited) {
          return failure('parser_output_limit', execution);
        }
        if (execution.exitCode !== 0) {
          return failure(childFailure(execution.stdout), execution);
        }
        const value = JSON.parse(execution.stdout.toString('utf8')) as unknown;
        const validated = validatePrivateIntermediate(value, trusted);
        const summary: PrivateIntermediateSummary = Object.freeze({
          boundary: Object.freeze({
            execution: 'local_native',
            network: 'none',
            platform: 'darwin',
            sandbox: 'macos_sandbox_exec',
            sourceFilesystem: 'read_only',
            validated: true,
          }),
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
          process: Object.freeze({
            exitCode: execution.exitCode,
            oomKilled: false,
            stderrBytes: execution.stderrBytes,
            stdoutBytes: execution.stdoutBytes,
            totalOutputBytes: execution.totalOutputBytes,
            wallMs: execution.wallMs,
          }),
          schemaVersion: 1,
          status: 'intermediate_ready',
        });
        return new PrivateParserIntermediate(summary, validated.value);
      } catch {
        return failure('invalid_worker_output', execution);
      } finally {
        execution.stdout.fill(0);
      }
    } finally {
      privateInput.fill(0);
    }
  }
}
