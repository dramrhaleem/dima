import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeRoot, readEnv } from './env.mjs';
import { isOwnedNodeProcess } from './process.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const envFile = resolve(runtimeRoot, 'docker.env');
const ownership = readEnv(envFile);
if (ownership.DIMA_REPO_ROOT !== repoRoot || ownership.DIMA_BACKEND_ROOT !== runtimeRoot) throw new Error('Runtime belongs to another project; no services were stopped.');
const composeFile = resolve(repoRoot, 'scripts/local-backend/compose.yaml');
const containers = spawnSync('docker', ['ps', '-aq', '--filter', 'label=com.docker.compose.project=dima-b0'], { encoding: 'utf8' });
if (containers.status !== 0) throw new Error('Cannot verify local container ownership; no services were stopped.');
for (const id of containers.stdout.trim().split('\n').filter(Boolean)) {
  const config = spawnSync('docker', ['inspect', id, '--format', '{{index .Config.Labels "com.docker.compose.project.config_files"}}'], { encoding: 'utf8' });
  if (config.status !== 0 || config.stdout.trim() !== composeFile) throw new Error('Container belongs to another checkout; no services were stopped.');
}
for (const [pidName, scriptName] of [['gateway.pid', 'gateway.mjs'], ['jobs.pid', 'dispatch.mjs']]) {
  const pidFile = resolve(runtimeRoot, pidName);
  if (!existsSync(pidFile)) continue;
  const pid = Number(readFileSync(pidFile, 'utf8'));
  if (Number.isInteger(pid) && pid > 1) {
    try {
      if (isOwnedNodeProcess(pid, resolve(repoRoot, 'scripts/local-backend', scriptName))) process.kill(pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error;
    }
  }
  if (existsSync(pidFile)) unlinkSync(pidFile);
}

const result = spawnSync('docker', ['compose', '--env-file', envFile, '-f', composeFile, '--profile', 'realtime', 'stop'], { stdio: 'inherit' });
if (result.status !== 0) process.exitCode = 1;
else console.log('Local services stopped; database files retained.');
