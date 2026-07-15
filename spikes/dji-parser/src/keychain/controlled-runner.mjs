import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { KeychainBroker } from "./broker.mjs";
import { EncryptedMemoryKeychainCache } from "./cache.mjs";
import { DjiKeychainProvider } from "./dji-provider.mjs";
import {
  runIsolatedDecode,
  runIsolatedKeychainRequest,
} from "./ipc.mjs";
import { runNativeIntermediate, runNativeSummary } from "./native-ipc.mjs";
import { normalizeDjiIntermediate } from "../normalization/canonical-v1.mjs";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(sourceDirectory, "../../../..");
const DEFAULT_PARSER_ID = "dji-log-parser-js@0.5.7";
const CREDENTIAL_NAME = "DJI_FLIGHT_RECORD_API_KEY";

function values(argv, name) {
  const found = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name && argv[index + 1]) {
      found.push(argv[index + 1]);
    }
  }
  return found;
}

function value(argv, name, fallback) {
  return values(argv, name).at(-1) ?? fallback;
}

function positiveInteger(argv, name, fallback) {
  const parsed = Number(value(argv, name, String(fallback)));
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return parsed;
}

function isInside(parent, child) {
  const pathFromParent = relative(parent, child);
  return pathFromParent !== ".."
    && !pathFromParent.startsWith(`..${sep}`)
    && !isAbsolute(pathFromParent);
}

function unquote(value) {
  if (value.length >= 2) {
    const first = value.at(0);
    const last = value.at(-1);
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

export async function readCredentialFile(path) {
  const bytes = await readFile(path);
  let credential = null;

  try {
    for (const originalLine of bytes.toString("utf8").split(/\r?\n/)) {
      const line = originalLine.trim();
      if (!line || line.startsWith("#")) continue;

      const separator = line.indexOf("=");
      if (separator < 1) continue;
      const name = line.slice(0, separator).trim().replace(/^export\s+/, "");
      if (name !== CREDENTIAL_NAME) continue;
      if (credential !== null) {
        throw new TypeError(`${CREDENTIAL_NAME} must appear exactly once`);
      }
      credential = unquote(line.slice(separator + 1).trim());
    }
  } finally {
    bytes.fill(0);
  }

  if (typeof credential !== "string"
    || credential.length < 1
    || credential.length > 4_096
    || /[\r\n]/.test(credential)) {
    throw new TypeError(`${CREDENTIAL_NAME} is missing or invalid`);
  }

  return credential;
}

function assertKeychainUseAuthorization(fixture, now = new Date()) {
  const approved = fixture?.review?.status === "approved_local"
    || fixture?.review?.status === "approved_repository";
  if (!approved
    || fixture?.provenance?.commercial_evaluation !== true) {
    throw new Error("Fixture is not authorized for controlled keychain use");
  }

  const reviewOn = fixture.provenance.review_on;
  if (typeof reviewOn === "string") {
    const reviewDate = new Date(`${reviewOn}T23:59:59.999Z`);
    if (!Number.isFinite(reviewDate.valueOf()) || now > reviewDate) {
      throw new Error("Fixture authorization requires review");
    }
  }
}

function assertFixtureAuthorization(fixture, now = new Date()) {
  assertKeychainUseAuthorization(fixture, now);
  if (fixture?.provenance?.external_service_processing !== true) {
    throw new Error("Fixture is not authorized for external DJI processing");
  }
}

export async function loadControlledFixture({ manifestPath, fixtureId }) {
  const resolvedManifest = resolve(repositoryRoot, manifestPath);
  if (!isInside(repositoryRoot, resolvedManifest)) {
    throw new Error("Manifest must resolve inside the repository");
  }

  const manifest = JSON.parse(await readFile(resolvedManifest, "utf8"));
  const fixture = manifest.fixtures?.find((candidate) => candidate.id === fixtureId);
  if (!fixture) {
    throw new Error("Unknown fixture id");
  }

  const fixturesRoot = dirname(resolvedManifest);
  const fixturePath = resolve(fixturesRoot, fixture.path);
  if (!isInside(fixturesRoot, fixturePath)) {
    throw new Error("Fixture resolves outside fixtures/");
  }

  return { fixture, fixturePath };
}

export async function runControlledKeychain({
  fixture,
  fixturePath,
  fixtureId = fixture?.id,
  followUpFixtures = [],
  provider,
  allowDjiRequest = false,
  workerPath,
  networkIsolation = "require",
  timeoutMs = 5_000,
  maxOutputBytes = 65_536,
  memoryMb = 128,
  nativeExecutable,
  nativeArgs = [],
  maxIntermediateOutputBytes = 32 * 1024 * 1024,
  normalizeProof = false,
  displayTimezone = "UTC",
  now,
}) {
  if (normalizeProof && (!nativeExecutable || !allowDjiRequest)) {
    throw new TypeError("normalizeProof requires an authorized native request");
  }
  if (allowDjiRequest) {
    assertFixtureAuthorization(fixture, now);
    for (const followUp of followUpFixtures) {
      assertKeychainUseAuthorization(followUp.fixture, now);
    }
    if (!provider) {
      throw new TypeError("A provider is required for an authorized DJI request");
    }
  }

  const childOptions = {
    fixtureId,
    fixturePath,
    workerPath,
    networkIsolation,
    timeoutMs,
    maxOutputBytes,
    memoryMb,
  };
  const privateRequest = await runIsolatedKeychainRequest(childOptions);
  const result = {
    schema_version: 1,
    mode: allowDjiRequest ? "live" : "dry_run",
    fixture_id: fixtureId,
    external_network_authorized: allowDjiRequest,
    request: privateRequest.result,
    broker: null,
    decode: null,
    intermediate: null,
    normalization: null,
    follow_up_decodes: [],
  };

  if (privateRequest.result.status !== "keychain_request_ready" || !allowDjiRequest) {
    return result;
  }

  const masterKey = randomBytes(32);
  const cache = new EncryptedMemoryKeychainCache(masterKey);
  masterKey.fill(0);
  const broker = new KeychainBroker({ cache, provider });

  try {
    const resolution = await broker.resolve({
      organizationId: "phase0-local-research",
      sourceId: fixtureId,
      parserId: DEFAULT_PARSER_ID,
      logVersion: 14,
      keychainUseAuthorized: true,
      externalServiceProcessingAuthorized: true,
      requestFactory: async () => privateRequest.requestForBroker(),
    });
    result.broker = resolution.result;

    const keychains = resolution.keychainsForParser();
    if (keychains) {
      if (nativeExecutable) {
        const nativeOptions = {
          fixtureId,
          fixturePath,
          nativeExecutable,
          nativeArgs,
          keychains,
          networkIsolation,
          timeoutMs,
          expectedSourceSha256: fixture.sha256,
        };
        result.decode = await runNativeSummary(nativeOptions);
        if (result.decode.status === "decoded") {
          const first = await runNativeIntermediate({
            ...nativeOptions,
            maxOutputBytes: maxIntermediateOutputBytes,
          });
          const second = await runNativeIntermediate({
            ...nativeOptions,
            maxOutputBytes: maxIntermediateOutputBytes,
          });
          const repeatMaterialMatch = first.result.status === "intermediate_ready"
            && second.result.status === "intermediate_ready"
            && first.result.material.sha256 === second.result.material.sha256;
          result.intermediate = {
            ...first.result,
            repeat_material_match: repeatMaterialMatch,
          };
          if (normalizeProof && repeatMaterialMatch) {
            const flightCount = first.result.material.flight_count;
            const canonicalFlightIds = Array.from(
              { length: flightCount },
              (_, index) => `phase0-${fixtureId}-flight-${index}`,
            );
            result.normalization = normalizeDjiIntermediate(first, {
              organization_id: "phase0-local-research",
              upload_batch_id: `phase0-${fixtureId}-batch`,
              raw_source_id: `phase0-${fixtureId}-source`,
              import_item_id: `phase0-${fixtureId}-item`,
              processing_attempt_id: `phase0-${fixtureId}-attempt`,
              processing_revision_id: `phase0-${fixtureId}-revision`,
              canonical_flight_ids: canonicalFlightIds,
              flight_assignments: canonicalFlightIds.map((canonicalFlightId) => ({
                canonical_flight_id: canonicalFlightId,
                state: "awaiting_review",
                pilot_id: null,
                aircraft_id: null,
                pilot_assignment_provenance: null,
                aircraft_assignment_provenance: null,
              })),
              display_timezone: displayTimezone,
              display_timezone_source: "phase0_proof_default",
              active_overrides: [],
            }).result;
          }
        }
      } else {
        result.decode = await runIsolatedDecode({
          ...childOptions,
          keychains,
        });
      }
      for (const followUp of followUpFixtures) {
        result.follow_up_decodes.push(nativeExecutable
          ? await runNativeSummary({
            fixtureId: followUp.fixtureId,
            fixturePath: followUp.fixturePath,
            nativeExecutable,
            nativeArgs,
            keychains,
            networkIsolation,
            timeoutMs,
          })
          : await runIsolatedDecode({
            ...childOptions,
            fixtureId: followUp.fixtureId,
            fixturePath: followUp.fixturePath,
            keychains,
          }));
      }
    }
    return result;
  } finally {
    cache.destroy();
  }
}

async function main(argv) {
  const fixtureId = value(argv, "--fixture");
  if (!fixtureId) {
    throw new TypeError("--fixture is required");
  }

  const allowDjiRequest = argv.includes("--allow-dji-request");
  const manifestPath = value(argv, "--manifest", "fixtures/manifest.json");
  const { fixture, fixturePath } = await loadControlledFixture({ manifestPath, fixtureId });
  const followUpFixtures = await Promise.all(values(argv, "--follow-up-fixture").map(
    async (followUpId) => {
      const loaded = await loadControlledFixture({ manifestPath, fixtureId: followUpId });
      return { ...loaded, fixtureId: followUpId };
    },
  ));

  let provider;
  if (allowDjiRequest) {
    const envFile = resolve(repositoryRoot, value(argv, "--env-file", ".env.local"));
    if (!isInside(repositoryRoot, envFile)) {
      throw new Error("Credential file must resolve inside the repository");
    }
    provider = new DjiKeychainProvider({
      externalNetworkAuthorized: true,
      credentialProvider: async () => readCredentialFile(envFile),
    });
  }

  const nativeExecutableValue = value(argv, "--native-executable");
  const nativeExecutable = nativeExecutableValue
    ? resolve(repositoryRoot, nativeExecutableValue)
    : undefined;

  return runControlledKeychain({
    fixture,
    fixturePath,
    fixtureId,
    followUpFixtures,
    provider,
    allowDjiRequest,
    timeoutMs: positiveInteger(argv, "--timeout-ms", 5_000),
    maxOutputBytes: positiveInteger(argv, "--max-output", 65_536),
    maxIntermediateOutputBytes: positiveInteger(
      argv,
      "--max-intermediate-output",
      32 * 1024 * 1024,
    ),
    memoryMb: positiveInteger(argv, "--memory-mb", 128),
    nativeExecutable,
    normalizeProof: argv.includes("--normalize-proof"),
    displayTimezone: value(argv, "--display-timezone", "UTC"),
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await main(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify({
      ...result,
      generated_at: new Date().toISOString(),
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      schema_version: 1,
      status: "runner_failed",
      failure_code: error?.message === "Fixture is not authorized for external DJI processing"
        ? "external_processing_not_authorized"
        : "controlled_runner_error",
    })}\n`);
    process.exitCode = 1;
  }
}
