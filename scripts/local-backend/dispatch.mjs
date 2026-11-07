// Development-only job pump. Production scheduling is configured separately.
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnv, runtimeRoot } from './env.mjs';
import { isOwnedNodeProcess } from './process.mjs';

const script = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(script), '../..');
const ownership = readEnv(resolve(runtimeRoot, 'docker.env'));
if (ownership.DIMA_REPO_ROOT !== repoRoot || ownership.DIMA_BACKEND_ROOT !== runtimeRoot) throw new Error('Runtime belongs to another project.');
const { DIMA_JOBS_TOKEN: token } = readEnv(resolve(runtimeRoot, 'jobs.env'));
if (!token) throw new Error('Configure the local dispatcher first.');
const once = process.argv.includes('--once');
const pidFile = resolve(runtimeRoot, 'jobs.pid');
let stopped = false;
const shutdown = new globalThis.AbortController();

if (!once) {
  if (existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, 'utf8'));
    if (isOwnedNodeProcess(pid, script)) throw new Error('The project dispatcher is already running.');
  }
  writeFileSync(pidFile, String(process.pid), { mode: 0o600 });
  const stop = () => { stopped = true; shutdown.abort(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

try {
  do {
    try {
      const response = await fetch('http://127.0.0.1:8787/api/internal/jobs/dispatch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
        // The hint owner has a bounded28s task after settlement. This is a client
        // envelope, not a promise that every degraded database batch fits it.
        signal: AbortSignal.any([AbortSignal.timeout(45000), shutdown.signal]),
      });
      if (!response.ok) throw new Error(`Dispatcher HTTP ${response.status}`);
      await response.json();
      // Do not print job payloads, account identities, or credentials.
      console.log('Local job batch accepted.');
    } catch (error) {
      if (!stopped) console.error(error instanceof Error && /^Dispatcher HTTP \d+$/.test(error.message) ? error.message : 'Local dispatcher unavailable; queued jobs remain durable.');
      if (once) process.exitCode = 1;
    }
    if (!once && !stopped) {
      for (let second = 0; second < 30 && !stopped; second++) await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } while (!once && !stopped);
} finally {
  if (!once && existsSync(pidFile) && readFileSync(pidFile, 'utf8') === String(process.pid)) unlinkSync(pidFile);
}
