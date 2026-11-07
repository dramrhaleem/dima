// Add a dedicated local dispatcher credential without touching other service settings.
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readEnv, runtimeRoot } from './local-backend/env.mjs';

const runtime = readEnv(resolve(runtimeRoot, 'docker.env'));
if (runtime.DIMA_REPO_ROOT !== process.cwd() || runtime.DIMA_BACKEND_ROOT !== runtimeRoot) throw new Error('Local runtime belongs to another project.');
if ((statSync(runtimeRoot).mode & 0o077) !== 0) throw new Error('A private POSIX runtime directory is required.');

const secretFile = resolve(runtimeRoot, 'jobs.env');
const token = existsSync(secretFile)
  ? readEnv(secretFile).DIMA_JOBS_TOKEN
  : randomBytes(32).toString('hex');
if (!/^[a-f0-9]{64}$/.test(token ?? '')) throw new Error('Existing dispatcher credential requires inspection.');

// Validate every destination before changing any of them.
const files = ['apps/web/.env.local', 'apps/web/.dev.vars'].map(file => ({ file, env: readEnv(file) }));
for (const { env } of files) {
  if (env.SUPABASE_URL !== 'http://127.0.0.1:54321') throw new Error('Refusing a nonlocal environment.');
  if (env.DIMA_JOBS_TOKEN && env.DIMA_JOBS_TOKEN !== token) throw new Error('Existing dispatcher credential differs.');
}
if (!existsSync(secretFile)) writeFileSync(secretFile, `DIMA_JOBS_TOKEN=${token}\n`, { mode: 0o600, flag: 'wx' });
chmodSync(secretFile, 0o600);
for (const { file, env } of files) {
  if (!env.DIMA_JOBS_TOKEN) writeFileSync(file, `${readFileSync(file, 'utf8').trimEnd()}\nDIMA_JOBS_TOKEN=${token}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}
console.log('Local time dispatcher configured; server-only credentials retained privately.');
