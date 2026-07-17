import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import type {
  OciExecution,
  OciInspection,
  OciState,
  ParserOciRuntime,
} from './supervisor.js';

const execFileAsync = promisify(execFile);

export class CliOciRuntime implements ParserOciRuntime {
  readonly #controlTimeoutMs: number;
  readonly #executable: string;

  constructor(executable = 'podman', controlTimeoutMs = 10_000) {
    if (!executable || executable.includes('\0')) {
      throw new TypeError('The OCI runtime executable is invalid.');
    }
    if (!Number.isSafeInteger(controlTimeoutMs) || controlTimeoutMs < 1) {
      throw new TypeError('The OCI runtime control timeout is invalid.');
    }
    this.#executable = executable;
    this.#controlTimeoutMs = controlTimeoutMs;
  }

  async #json(arguments_: readonly string[]): Promise<unknown> {
    const { stdout } = await execFileAsync(this.#executable, [...arguments_], {
      encoding: 'utf8',
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
      timeout: this.#controlTimeoutMs,
    });
    return JSON.parse(stdout.trim()) as unknown;
  }

  async create(arguments_: readonly string[]): Promise<void> {
    await execFileAsync(this.#executable, [...arguments_], {
      encoding: 'utf8',
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
      timeout: this.#controlTimeoutMs,
    });
  }

  async inspect(name: string): Promise<OciInspection> {
    const value = await this.#json(['inspect', name]);
    if (!Array.isArray(value) || !value[0]) {
      throw new Error('OCI inspection was unavailable.');
    }
    return value[0] as OciInspection;
  }

  async state(name: string): Promise<OciState> {
    return (await this.#json([
      'inspect',
      '--format',
      '{{json .State}}',
      name,
    ])) as OciState;
  }

  async remove(name: string): Promise<void> {
    await execFileAsync(this.#executable, ['rm', '--force', name], {
      encoding: 'utf8',
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
      timeout: this.#controlTimeoutMs,
    });
  }

  async start(
    name: string,
    privateInput: Buffer,
    limits: Readonly<{ maxOutputBytes: number; timeoutMs: number }>,
  ): Promise<OciExecution> {
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let totalOutputBytes = 0;
    let stopReason: 'output' | 'timeout' | null = null;
    let stopPromise: Promise<unknown> = Promise.resolve();
    const child = spawn(
      this.#executable,
      ['start', '--attach', '--interactive', name],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );

    const requestStop = (reason: 'output' | 'timeout') => {
      if (stopReason) return;
      stopReason = reason;
      stopPromise = execFileAsync(this.#executable, ['kill', name], {
        encoding: 'utf8',
        killSignal: 'SIGKILL',
        maxBuffer: 1024 * 1024,
        timeout: this.#controlTimeoutMs,
      })
        .catch(() => undefined)
        .finally(() => child.kill('SIGKILL'));
    };

    const timer = setTimeout(() => requestStop('timeout'), limits.timeoutMs);
    timer.unref();
    child.stdin.on('error', () => undefined);
    child.stdin.end(privateInput);
    child.stdout.on('data', (value: Buffer) => {
      stdoutBytes += value.length;
      totalOutputBytes += value.length;
      const kept = Math.max(
        0,
        limits.maxOutputBytes - (stdoutBytes - value.length),
      );
      if (kept > 0) stdout.push(Buffer.from(value.subarray(0, kept)));
      if (totalOutputBytes > limits.maxOutputBytes) requestStop('output');
    });
    child.stderr.on('data', (value: Buffer) => {
      stderrBytes += value.length;
      totalOutputBytes += value.length;
      if (totalOutputBytes > limits.maxOutputBytes) requestStop('output');
    });

    const outcome = await new Promise<{
      readonly error: boolean;
      readonly exitCode: number | null;
      readonly signal: string | null;
    }>((resolve) => {
      child.once('error', () =>
        resolve({ error: true, exitCode: null, signal: null }),
      );
      child.once('close', (exitCode, signal) =>
        resolve({ error: false, exitCode, signal }),
      );
    });
    clearTimeout(timer);
    await stopPromise;

    return Object.freeze({
      ...outcome,
      stderrBytes,
      stdout: Buffer.concat(stdout),
      stdoutBytes,
      stopReason,
      totalOutputBytes,
    });
  }
}
