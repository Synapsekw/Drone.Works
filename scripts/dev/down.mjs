import {
  execFileAsync,
  readRuntimeState,
  removeRuntimeState,
  terminateProcessGroup,
} from './runtime-lib.mjs';
import { join } from 'node:path';

let state;
try {
  state = await readRuntimeState();
} catch {
  await removeRuntimeState();
  process.stdout.write('Drone.Works local runtime is already stopped.\n');
  process.exit(0);
}

for (const processRecord of [...state.processes].reverse()) {
  terminateProcessGroup(processRecord.pid);
}

await execFileAsync(join(state.postgres.bin, 'pg_ctl'), [
  '--pgdata',
  state.postgres.data,
  '--mode',
  'fast',
  '--wait',
  'stop',
]).catch(() => undefined);

await removeRuntimeState();
process.stdout.write(
  'Drone.Works local runtime stopped and generated state removed.\n',
);
