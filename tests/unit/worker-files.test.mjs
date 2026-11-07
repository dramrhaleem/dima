import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync, rmSync, existsSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRegularBuildFile, syncLocalVariables } from '../../scripts/worker-files.mjs';

it('removes stale enabled variables when the source is removed; whitelists bindings and protects server credentials', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dima-vars-'));
  try {
    const source = join(dir, 'source'); const target = join(dir, 'target');
    writeFileSync(source, 'DIMA_B0_ENABLED=true\nSUPABASE_ANON_KEY=public-fixture\nPRIVATE_FIXTURE=never-copy\nSUPABASE_SERVICE_ROLE_KEY=server-only-fixture\nDIMA_JOBS_TOKEN=job-dispatcher-fixture\nDIMA_REALTIME_SIGNING_SECRET=realtime-signing-fixture\n');
    syncLocalVariables(source, target);
    expect(readFileSync(target, 'utf8')).not.toContain('PRIVATE_FIXTURE');
    expect(readFileSync(target, 'utf8')).toContain('DIMA_B0_ENABLED=true');
    expect(readFileSync(target, 'utf8')).toContain('SUPABASE_SERVICE_ROLE_KEY=server-only-fixture');
    expect(readFileSync(target, 'utf8')).toContain('DIMA_JOBS_TOKEN=job-dispatcher-fixture');
    expect(readFileSync(target, 'utf8')).toContain('DIMA_REALTIME_SIGNING_SECRET=realtime-signing-fixture');
    expect(statSync(target).mode & 0o077).toBe(0);
    unlinkSync(source);
    syncLocalVariables(source, target);
    expect(existsSync(target)).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('handles an uncommitted tracked-file deletion without following directory symlinks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dima-files-'));
  try {
    const file = join(dir, 'tracked.ts'); writeFileSync(file, 'export {};');
    expect(isRegularBuildFile(file)).toBe(true);
    unlinkSync(file);
    expect(isRegularBuildFile(file)).toBe(false);
    symlinkSync(dir, join(dir, 'link'));
    expect(isRegularBuildFile(join(dir, 'link'))).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
