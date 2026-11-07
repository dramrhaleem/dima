// Local transport/configuration gate; this does not replace private membership or sustained-load tests.
import http from 'node:http';
import { clearTimeout } from 'node:timers';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readEnv, runtimeRoot, clientEnvPath } from '../../scripts/local-backend/env.mjs';
const repoRoot = process.cwd();
const ownership = readEnv(resolve(runtimeRoot, 'docker.env'));
if (ownership.DIMA_REPO_ROOT !== repoRoot || ownership.DIMA_BACKEND_ROOT !== runtimeRoot) throw new Error('Local runtime ownership mismatch.');
const { SUPABASE_ANON_KEY: anon, SUPABASE_URL: url } = readEnv(clientEnvPath);
if (url !== 'http://127.0.0.1:54321') throw new Error('This probe is local-only.');
const { SUPABASE_SERVICE_ROLE_KEY: service } = readEnv(resolve(runtimeRoot, 'server.env'));
function upgrade(key, origin, path = '/realtime/v1/websocket') {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port: 54321, path: `${path}?vsn=2.0.0&apikey=${encodeURIComponent(key)}`, headers: {
      Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64'), ...(origin ? { Origin: origin } : {}),
    } });
    request.setTimeout(10000, () => request.destroy(new Error('Transport probe timeout')));
    request.on('upgrade', (response, socket) => { socket.destroy(); resolve(response.statusCode); });
    request.on('response', response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end();
  });
}
const results = {
  validHandshake: await upgrade(anon, 'http://127.0.0.1:8787'),
  wrongKey: await upgrade('invalid', 'http://127.0.0.1:8787'),
  foreignOrigin: await upgrade(anon, 'https://untrusted.example'),
  adminSocketPath: await upgrade(anon, undefined, '/realtime/v1/api/tenants'),
};
const admin = await fetch(`${url}/realtime/v1/api/tenants`, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } });
results.adminHttpPath = admin.status;
const payload = { messages: [{ topic: 'room:10000000-0000-4000-8000-000000000001', event: 'invalidate', private: true, payload: { version: 1, phase: 'lobby', count: { reserved: 0, connected: 0 } } }] };
for (const [key, name] of [[anon, 'clientPublish'], [service, 'serverPublish']]) {
  const response = await fetch(`${url}/realtime/v1/api/broadcast`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
  results[name] = response.status;
}
const require = createRequire(resolve(repoRoot, 'packages/client/package.json'));
const { RealtimeClient } = require('@supabase/realtime-js');
const client = new RealtimeClient(`${url}/realtime/v1`, { params: { apikey: anon }, logger: () => {}, timeout: 10000 });
try {
  await client.setAuth(anon);
  results.anonymousPrivateJoin = await new Promise(resolve => {
    const timer = setTimeout(() => resolve({ state: 'TEST_TIMEOUT', expectedReadDenial: false }), 15000);
    client.channel(payload.messages[0].topic, { config: { private: true, presence: { enabled: false } } }).subscribe((state, error) => {
      if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT'].includes(state)) {
        clearTimeout(timer);
        resolve({ state, expectedReadDenial: typeof error?.message === 'string' && error.message.includes('You do not have permissions to read') });
      }
    });
  });
} finally { await client.removeAllChannels(); await client.disconnect(); }
const configResponse = await fetch('http://127.0.0.1:54326/api/tenants/realtime-dev', { headers: { Authorization: `Bearer ${service}` }, signal: AbortSignal.timeout(10000) });
const config = (await configResponse.json()).data;
results.configuration = { privateOnly: config?.private_only, presenceEnabled: config?.presence_enabled, tenantLimit: config?.max_concurrent_users, channelsPerClient: config?.max_channels_per_client };
const ok = results.validHandshake === 101 && results.wrongKey === 401 && results.foreignOrigin === 403
  && results.adminSocketPath === 404 && results.adminHttpPath === 404 && results.clientPublish === 403
  && [200, 202, 204].includes(results.serverPublish) && results.anonymousPrivateJoin.expectedReadDenial
  && configResponse.ok && config.private_only === true && config.presence_enabled === false && config.max_concurrent_users === 200 && config.max_channels_per_client === 1;
writeFileSync(resolve(repoRoot, 'docs/evidence/B5_REALTIME_TRANSPORT_RESULTS.json'), JSON.stringify({ at: new Date().toISOString(), ok, scope: 'Local transport and private-only configuration; no authorized-room or sustained-load acceptance', image: 'supabase/realtime:v2.143.3', sdk: '2.118.0', results }, null, 2) + '\n');
console.log(JSON.stringify({ ok, results }));
if (!ok) process.exitCode = 1;
