// Server-only local capability signing. Public client environment is never changed.
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { prepareRealtimeSecrets } from './local-backend/realtime.mjs';
import { readEnv } from './local-backend/env.mjs';
const runtime = prepareRealtimeSecrets();
const files = ['apps/web/.env.local', 'apps/web/.dev.vars'].map(file => ({ file, env: readEnv(file) }));
for (const { env } of files) {
  if (env.SUPABASE_URL !== 'http://127.0.0.1:54321') throw new Error('Refusing a nonlocal environment.');
  if (env.DIMA_REALTIME_SIGNING_SECRET && env.DIMA_REALTIME_SIGNING_SECRET !== runtime.JWT_SECRET) throw new Error('Existing signing configuration differs.');
}
for (const { file, env } of files) {
  if (!env.DIMA_REALTIME_SIGNING_SECRET) writeFileSync(file, `${readFileSync(file, 'utf8').trimEnd()}\nDIMA_REALTIME_SIGNING_SECRET=${runtime.JWT_SECRET}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}
console.log('Local room signing configured privately; existing project credentials were preserved.');
