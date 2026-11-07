import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { readEnv, clientEnvPath } from './local-backend/env.mjs';

const env = readEnv(clientEnvPath);
if (env.SUPABASE_URL !== 'http://127.0.0.1:54321') throw new Error('Local-only configuration expected');
const values = {
  'apps/web/.env.local': `DIMA_B0_ENABLED=true\nDIMA_APP_ORIGIN=http://127.0.0.1:8787\nDIMA_GOOGLE_ENABLED=false\nSUPABASE_URL=${env.SUPABASE_URL}\nSUPABASE_ANON_KEY=${env.SUPABASE_ANON_KEY}\nDIMA_CLIENT_ORIGINS=http://127.0.0.1:4174,http://localhost:4174,http://127.0.0.1:8787,http://localhost:8787,http://127.0.0.1:3000,http://localhost:3000\n`,
  'apps/web/.dev.vars': `DIMA_B0_ENABLED=true\nDIMA_APP_ORIGIN=http://127.0.0.1:8787\nDIMA_GOOGLE_ENABLED=false\nSUPABASE_URL=${env.SUPABASE_URL}\nSUPABASE_ANON_KEY=${env.SUPABASE_ANON_KEY}\nDIMA_CLIENT_ORIGINS=http://127.0.0.1:4174,http://localhost:4174,http://127.0.0.1:8787,http://localhost:8787,http://127.0.0.1:3000,http://localhost:3000\n`,
  'apps/client-proof/.env.local': `VITE_API_BASE_URL=http://127.0.0.1:8787\nVITE_SUPABASE_URL=${env.SUPABASE_URL}\nVITE_SUPABASE_ANON_KEY=${env.SUPABASE_ANON_KEY}\n`,
};
for (const [file, value] of Object.entries(values)) {
  const path = resolve(file);
  if (existsSync(path) && readFileSync(path, 'utf8') !== value) throw new Error(`Existing ${file} differs; inspect without overwriting.`);
  writeFileSync(path, value, { mode: 0o600 });
  chmodSync(path, 0o600);
}
console.log('Local web/worker/client configuration written; no credentials printed.');
