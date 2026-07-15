import { execFile, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import pg from "pg";

const execFileAsync = promisify(execFile);
const { Client } = pg;

async function findPostgresBin() {
  const candidates = [
    process.env.POSTGRES_BIN,
    "/opt/homebrew/opt/postgresql@18/bin",
    "/usr/local/opt/postgresql@18/bin",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(join(candidate, "postgres"));
      await access(join(candidate, "initdb"));
      await access(join(candidate, "pg_ctl"));
      return candidate;
    } catch {
      // Continue to the next explicit native PostgreSQL installation.
    }
  }

  throw new Error(
    "PostgreSQL 18 server binaries were not found. Install postgresql@18 natively or set POSTGRES_BIN; Docker is not used by this proof.",
  );
}

async function runNodeTests(environment) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--test", "test/isolation.test.mjs"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, ...environment },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`test process exited with ${code ?? signal}`));
      }
    });
  });
}

const postgresBin = await findPostgresBin();
const temporaryRoot = await mkdtemp(join(tmpdir(), "droneworks-postgres-rls-"));
const dataDirectory = join(temporaryRoot, "data");
const socketDirectory = join(temporaryRoot, "socket");
const logPath = join(temporaryRoot, "postgres.log");
const port = String(55000 + Math.floor(Math.random() * 5000));
let serverStarted = false;

try {
  await execFileAsync(join(postgresBin, "initdb"), [
    "--pgdata", dataDirectory,
    "--encoding", "UTF8",
    "--locale", "C",
    "--auth", "trust",
    "--no-sync",
  ]);
  await mkdir(socketDirectory);
  await execFileAsync(join(postgresBin, "pg_ctl"), [
    "--pgdata", dataDirectory,
    "--log", logPath,
    "--options", `-F -h '' -k ${socketDirectory} -p ${port}`,
    "--wait",
    "start",
  ]);
  serverStarted = true;

  const bootstrapUser = userInfo().username;
  const bootstrapClient = new Client({
    host: socketDirectory,
    port: Number(port),
    database: "postgres",
    user: bootstrapUser,
  });
  await bootstrapClient.connect();
  try {
    const migration = await readFile(new URL("../sql/001_isolation.sql", import.meta.url), "utf8");
    const seed = await readFile(new URL("../sql/002_seed.sql", import.meta.url), "utf8");
    await bootstrapClient.query(migration);
    await bootstrapClient.query(seed);
  } finally {
    await bootstrapClient.end();
  }

  await runNodeTests({
    PGHOST: socketDirectory,
    PGPORT: port,
    PGDATABASE: "postgres",
    PGUSER: "droneworks_app",
    DRONEWORKS_PG_BOOTSTRAP_USER: bootstrapUser,
  });
} catch (error) {
  if (serverStarted) {
    try {
      const log = await readFile(logPath, "utf8");
      process.stderr.write(`\nPostgreSQL log:\n${log}\n`);
    } catch {
      // Preserve the original failure when no server log is available.
    }
  }
  throw error;
} finally {
  if (serverStarted) {
    await execFileAsync(join(postgresBin, "pg_ctl"), [
      "--pgdata", dataDirectory,
      "--mode", "immediate",
      "--wait",
      "stop",
    ]).catch(() => undefined);
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}
