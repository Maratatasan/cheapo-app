import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const output = mkdtempSync(join(tmpdir(), 'cheapo-auth-java-'));
const moduleRoot = resolve('modules/cheapo-loopback');
const java = (name) => process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', name) : name;
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
try {
  run(java('javac'), ['-d', output,
    join(moduleRoot, 'android/src/main/java/expo/modules/cheapoloopback/LoopbackReceiver.java'),
    join(moduleRoot, 'android/src/main/java/expo/modules/cheapoloopback/RsaVerifier.java'),
    join(moduleRoot, 'tests/NativePrimitivesTest.java')]);
  run(java('java'), ['-cp', output, 'NativePrimitivesTest']);
} finally { rmSync(output, { recursive: true, force: true }); }
