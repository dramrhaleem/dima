// Add the isolated local server writer without replacing existing OAuth/settings.
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readEnv, runtimeRoot } from './local-backend/env.mjs';
const { SUPABASE_SERVICE_ROLE_KEY: key } = readEnv(resolve(runtimeRoot, 'server.env'));
if (!key) throw new Error('Start the isolated backend first');
for (const file of ['apps/web/.env.local', 'apps/web/.dev.vars']) {
  const env = readEnv(file);
  if (env.SUPABASE_URL !== 'http://127.0.0.1:54321') throw new Error('Refusing a nonlocal environment');
  if (env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_SERVICE_ROLE_KEY !== key) throw new Error('Existing server credential differs; inspect without overwriting');
  if (!env.SUPABASE_SERVICE_ROLE_KEY) writeFileSync(file, readFileSync(file, 'utf8').trimEnd() + `\nSUPABASE_SERVICE_ROLE_KEY=${key}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}
console.log('Local learning writer configured server-side; credentials not printed.');
