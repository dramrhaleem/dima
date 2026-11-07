import { expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isOwnedNodeProcess } from '../../scripts/local-backend/process.mjs';

it('recognizes a relative Node script argument without claiming a different script', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'dima-process-'));
  const script = join(folder, 'runner.mjs');
  writeFileSync(script, 'setInterval(() => {}, 1000);');
  const child = spawn(process.execPath, ['runner.mjs'], { cwd: folder, stdio: 'ignore' });
  try {
    await once(child, 'spawn');
    expect(isOwnedNodeProcess(child.pid, script)).toBe(true);
    expect(isOwnedNodeProcess(child.pid, join(folder, 'other', 'runner.mjs'))).toBe(false);
    expect(isOwnedNodeProcess(0, script)).toBe(false);
  } finally {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
    rmSync(folder, { recursive: true, force: true });
  }
});

it.each(['checkout', 'runtime'])('stop rejects a foreign %s before touching PID files or Docker', mismatch => {
  const folder = mkdtempSync(join(tmpdir(), 'dima-stop-owner-'));
  try {
    writeFileSync(join(folder, 'docker.env'), `DIMA_REPO_ROOT=${mismatch === 'checkout' ? '/different-checkout' : process.cwd()}\nDIMA_BACKEND_ROOT=${mismatch === 'runtime' ? '/different-runtime' : folder}\n`);
    writeFileSync(join(folder, 'gateway.pid'), '123456');
    writeFileSync(join(folder, 'jobs.pid'), '123457');
    const result = spawnSync(process.execPath, [resolve('scripts/local-backend/stop.mjs')], {
      env: { ...process.env, DIMA_BACKEND_ROOT: folder }, encoding: 'utf8', timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Runtime belongs to another project; no services were stopped.');
    expect(readFileSync(join(folder, 'gateway.pid'), 'utf8')).toBe('123456');
    expect(readFileSync(join(folder, 'jobs.pid'), 'utf8')).toBe('123457');
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
