import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  LocalNativeParserOperations,
  ParserSupervisor,
  buildParserCreateArguments,
  defaultParserConstraints,
  validateParserInspection,
} from '../dist/index.js';

const image = `sha256:${'a'.repeat(64)}`;
let directory;
let source;

function inspection(overrides = {}) {
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
    ...overrides,
  };
}

function intermediate(exactSource) {
  return {
    schema_version: 1,
    kind: 'dji_parser_intermediate',
    parser: {
      id: 'dji-log-parser',
      version: '0.5.7',
      source_commit: 'e2e0775670a8391b4f7ecc40fca4cb01ea4a90fa',
    },
    source: {
      sha256: exactSource.sha256,
      bytes: exactSource.bytes,
      format_family: 'dji_txt',
      format_version: 14,
    },
    flights: [
      {
        flight_index: 0,
        imported: {
          takeoff_time_utc: '2026-01-01T00:00:00Z',
          declared_duration_ms: 1000,
          declared_distance_m: null,
          declared_max_height_m: null,
          declared_max_horizontal_speed_mps: null,
          declared_max_vertical_speed_mps: null,
          aircraft_name: null,
          aircraft_model: null,
          application_platform: null,
          application_version: null,
          identifiers: {
            aircraft_serials: [],
            battery_serials: [],
            camera_serials: [],
            controller_serials: [],
          },
        },
        capabilities: ['gps'],
        sample_count: 1,
        samples: [
          {
            elapsed_ms: 0,
            position: null,
            altitude_msl_m: null,
            height_agl_m: null,
            velocity: { x_mps: null, y_mps: null, z_mps: null },
            attitude: { pitch_deg: null, roll_deg: null, yaw_deg: null },
            battery: null,
            gps: { satellites: 0, signal_level: 0, position_used: false },
            signal: null,
          },
        ],
      },
    ],
  };
}

function execution(value, options = {}) {
  const stdout = Buffer.from(
    typeof value === 'string' ? value : JSON.stringify(value),
  );
  return {
    error: false,
    exitCode: options.exitCode ?? 0,
    signal: null,
    stderrBytes: options.stderrBytes ?? 0,
    stdout,
    stdoutBytes: stdout.length,
    stopReason: options.stopReason ?? null,
    totalOutputBytes: options.totalOutputBytes ?? stdout.length,
  };
}

class FakeRuntime {
  constructor(scenarios, inspected = inspection()) {
    this.scenarios = [...scenarios];
    this.inspected = inspected;
    this.created = [];
    this.removed = 0;
    this.started = 0;
    this.current = null;
  }

  async create(arguments_) {
    this.created.push(arguments_);
  }

  async inspect() {
    return this.inspected;
  }

  async start() {
    this.started += 1;
    this.current = this.scenarios.shift();
    if (!this.current) throw new Error('No fake parser scenario.');
    return this.current.execution;
  }

  async state() {
    return this.current?.state ?? { ExitCode: 0, OOMKilled: false };
  }

  async remove() {
    this.removed += 1;
    if (this.failRemove) throw new Error('generated cleanup failure');
  }
}

beforeEach(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'droneworks-a08-host-'));
  const path = resolve(directory, 'source.bin');
  const content = Buffer.from('generated exact parser source');
  await writeFile(path, content, { mode: 0o400 });
  source = {
    bytes: content.length,
    path,
    sha256: createHash('sha256').update(content).digest('hex'),
  };
  content.fill(0);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('A08 native parser supervisor', () => {
  it('rejects the local native adapter in every hosted environment', () => {
    for (const environment of ['staging', 'production']) {
      expect(
        () =>
          new LocalNativeParserOperations({
            environment,
            executable: '/generated/parser',
            executableSha256: 'a'.repeat(64),
          }),
      ).toThrow('unavailable in hosted mode');
    }
  });

  it('builds and revalidates the complete no-network read-only boundary', () => {
    const args = buildParserCreateArguments({
      image,
      name: 'generated-parser',
      sourcePath: source.path,
    });
    expect(args).toContain('none');
    expect(args).toContain('--read-only');
    expect(args).toContain('ALL');
    expect(args).toContain('no-new-privileges');
    expect(args).toContain(String(defaultParserConstraints.pidsLimit));
    expect(args.join(' ')).not.toMatch(/--env|AWS|PGHOST|credential/i);
    expect(validateParserInspection(inspection())).toEqual([]);
    const weakened = inspection({
      Config: {
        Env: ['AWS_SECRET_ACCESS_KEY=generated-forbidden'],
        User: '0:0',
      },
      HostConfig: { ...inspection().HostConfig, NetworkMode: 'bridge' },
    });
    expect(validateParserInspection(weakened)).toEqual(
      expect.arrayContaining(['network', 'user', 'secret_environment']),
    );
  });

  it('returns only a bounded summary and destroys private intermediate material', async () => {
    const runtime = new FakeRuntime([
      {
        execution: execution(intermediate(source)),
        state: { ExitCode: 0, OOMKilled: false },
      },
    ]);
    const input = Buffer.from('{"keychains":[]}');
    const result = await new ParserSupervisor({ image, runtime }).run(
      source,
      input,
    );
    expect(result.status).toBe('intermediate_ready');
    expect(input.every((value) => value === 0)).toBe(true);
    expect(runtime.removed).toBe(1);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(source.sha256);
    expect(serialized).not.toContain('takeoff_time_utc');
    expect(serialized).not.toContain('identifiers');
    expect(result.summary.material).toMatchObject({
      flightCount: 1,
      sampleCount: 1,
      sourceHashVerified: true,
    });
    let retained;
    await result.withValue((value) => {
      retained = value;
      expect(value.source.sha256).toBe(source.sha256);
    });
    expect(result.destroyed).toBe(true);
    expect(retained).toEqual({});
    await expect(result.withValue(() => undefined)).rejects.toThrow(
      'unavailable',
    );
  });

  it('rejects malformed private output and runs a later operation cleanly', async () => {
    const poisoned = intermediate(source);
    poisoned.raw_private_payload = 'must-not-escape';
    const runtime = new FakeRuntime([
      {
        execution: execution(poisoned),
        state: { ExitCode: 0, OOMKilled: false },
      },
      {
        execution: execution(intermediate(source)),
        state: { ExitCode: 0, OOMKilled: false },
      },
    ]);
    const supervisor = new ParserSupervisor({ image, runtime });
    const poisonResult = await supervisor.run(
      source,
      Buffer.from('{"keychains":[]}'),
    );
    expect(poisonResult).toMatchObject({
      failureCode: 'invalid_worker_output',
      status: 'failed',
    });
    expect(JSON.stringify(poisonResult)).not.toContain('must-not-escape');
    const recovered = await supervisor.run(
      source,
      Buffer.from('{"keychains":[]}'),
    );
    expect(recovered.status).toBe('intermediate_ready');
    recovered.destroy();
    expect(runtime.removed).toBe(2);
  });

  it('sanitizes parser panic output and preserves the next operation', async () => {
    const failure = {
      schema_version: 1,
      kind: 'decode_summary',
      status: 'decode_failed',
      failure_code: 'parser_internal_error',
    };
    const runtime = new FakeRuntime([
      {
        execution: execution(failure, { exitCode: 2, stderrBytes: 99 }),
        state: { ExitCode: 2, OOMKilled: false },
      },
      {
        execution: execution(intermediate(source)),
        state: { ExitCode: 0, OOMKilled: false },
      },
    ]);
    const supervisor = new ParserSupervisor({ image, runtime });
    const panic = await supervisor.run(source, Buffer.from('{"keychains":[]}'));
    expect(panic).toMatchObject({
      failureCode: 'parser_panic',
      process: { stderrBytes: 99 },
    });
    expect(JSON.stringify(panic)).not.toContain('private-container-error');
    const recovered = await supervisor.run(
      source,
      Buffer.from('{"keychains":[]}'),
    );
    expect(recovered.status).toBe('intermediate_ready');
    recovered.destroy();
  });

  it.each([
    [
      'parser_wall_time_limit',
      execution('', { exitCode: 137, stopReason: 'timeout' }),
      { ExitCode: 137, OOMKilled: false },
    ],
    [
      'parser_output_limit',
      execution('', {
        exitCode: 137,
        stopReason: 'output',
        totalOutputBytes: defaultParserConstraints.maxOutputBytes + 1,
      }),
      { ExitCode: 137, OOMKilled: false },
    ],
    [
      'parser_memory_limit',
      execution('', { exitCode: 137 }),
      { ExitCode: 137, OOMKilled: true },
    ],
  ])(
    'classifies %s without returning process output',
    async (code, run, state) => {
      const runtime = new FakeRuntime([{ execution: run, state }]);
      const result = await new ParserSupervisor({ image, runtime }).run(
        source,
        Buffer.from('{"keychains":[]}'),
      );
      expect(result).toMatchObject({ failureCode: code, status: 'failed' });
      expect(Object.keys(result)).toEqual([
        'boundary',
        'failureCode',
        'process',
        'schemaVersion',
        'status',
      ]);
      expect(runtime.removed).toBe(1);
    },
  );

  it('fails before execution for changed or oversized exact input', async () => {
    const runtime = new FakeRuntime([]);
    const supervisor = new ParserSupervisor({ image, runtime });
    const changedInput = Buffer.from('{"keychains":[]}');
    const changed = await supervisor.run(
      { ...source, sha256: '0'.repeat(64) },
      changedInput,
    );
    expect(changed.failureCode).toBe('source_identity_mismatch');
    expect(changedInput.every((value) => value === 0)).toBe(true);
    const oversized = Buffer.alloc(
      defaultParserConstraints.maxPrivateInputBytes + 1,
      1,
    );
    const limited = await supervisor.run(source, oversized);
    expect(limited.failureCode).toBe('private_input_limit');
    expect(oversized.every((value) => value === 0)).toBe(true);
    const sourceInput = Buffer.from('{"keychains":[]}');
    const sourceLimited = await new ParserSupervisor({
      constraints: { maxSourceBytes: source.bytes - 1 },
      image,
      runtime,
    }).run(source, sourceInput);
    expect(sourceLimited.failureCode).toBe('source_input_limit');
    expect(sourceInput.every((value) => value === 0)).toBe(true);
    expect(runtime.started).toBe(0);
  });

  it('fails closed and cleans up when runtime inspection weakens isolation', async () => {
    const runtime = new FakeRuntime(
      [],
      inspection({
        HostConfig: { ...inspection().HostConfig, ReadonlyRootfs: false },
      }),
    );
    const result = await new ParserSupervisor({ image, runtime }).run(
      source,
      Buffer.from('{"keychains":[]}'),
    );
    expect(result).toMatchObject({
      boundary: null,
      failureCode: 'boundary_violation',
    });
    expect(runtime.started).toBe(0);
    expect(runtime.removed).toBe(1);
  });

  it('destroys private output and reports a sanitized cleanup failure', async () => {
    const runtime = new FakeRuntime([
      {
        execution: execution(intermediate(source)),
        state: { ExitCode: 0, OOMKilled: false },
      },
    ]);
    runtime.failRemove = true;
    const result = await new ParserSupervisor({ image, runtime }).run(
      source,
      Buffer.from('{"keychains":[]}'),
    );
    expect(result).toMatchObject({
      failureCode: 'parser_cleanup_failed',
      status: 'failed',
    });
    expect(JSON.stringify(result)).not.toContain(source.sha256);
    expect(runtime.removed).toBe(1);
  });

  it('rejects floating parser image references', () => {
    expect(
      () =>
        new ParserSupervisor({
          image: 'parser:latest',
          runtime: new FakeRuntime([]),
        }),
    ).toThrow('content-addressed');
  });
});
