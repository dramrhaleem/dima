import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { runtimeRoot } from './local-backend/env.mjs';

const base = 'http://127.0.0.1:8787';
const [account] = JSON.parse(readFileSync(resolve(runtimeRoot, 'test-accounts.json'), 'utf8'));
const routes = [['health', '/api/v1/health', false], ['server-rendered page', '/', false], ['authenticated read', '/api/v1/foundation/checks', true]];
const results = [];
for (const [name, path, auth] of routes) {
  const times = [];
  for (let i = 0; i < 15; i++) {
    const start = performance.now();
    const response = await fetch(base + path, { headers: auth ? { Authorization: `Bearer ${account.accessToken}` } : {}, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Local ${name} failed with status ${response.status}`);
    await response.arrayBuffer();
    if (i >= 3) times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  results.push({ name, warmedSamples: times.length, p50WallMs: Number(times[Math.ceil(times.length * .5) - 1].toFixed(2)), p95WallMs: Number(times[Math.ceil(times.length * .95) - 1].toFixed(2)) });
}
const telemetry = await fetch(`${base}/cdn-cgi/local/explorer/api/local/observability/query`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sql: "SELECT MAX(json_extract(json(attributes),'$.cpu_time_ms')) AS max_cpu_ms, MAX(json_extract(json(attributes),'$.wall_time_ms')) AS max_wall_ms, COUNT(*) AS requests FROM spans WHERE parent_id IS NULL" }),
}).then(r => r.json());
const report = { checkedAt: new Date().toISOString(), environment: 'local workerd + loopback Auth/Postgres, sequential warmed requests; no hosted load test', results,
  localTelemetry: telemetry.result,
  cpuConclusion: telemetry.result?.rows?.[0]?.[0] === 0
    ? 'Local telemetry returned zero values in this run; wall timings are not CPU billing. Hosted CPU/free-tier suitability remains unverified.'
    : 'Local telemetry is development evidence only; hosted CPU/free-tier suitability remains unverified.' };
writeFileSync('docs/evidence/B0_LOCAL_TIMING.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ results, hostedCpuVerified: false }));
