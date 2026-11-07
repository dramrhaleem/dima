import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { runtimeRoot, readEnv, clientEnvPath } from '../../scripts/local-backend/env.mjs';

const base = process.env.DIMA_TEST_API ?? 'http://127.0.0.1:8787';
const url = new URL(base);
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Integration checks are local-only');
const env = readEnv(clientEnvPath);
const accounts = JSON.parse(readFileSync(resolve(runtimeRoot, 'test-accounts.json'), 'utf8'));
// Refresh synthetic sessions without printing their credentials.
for (const account of accounts) {
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: account.email, password: account.password }) });
  assert.equal(response.status, 200);
  account.accessToken = (await response.json()).access_token;
}
const results = [];
const pass = name => results.push({ name, status: 'passed' });
const request = (token, options = {}) => fetch(`${base}/api/v1/foundation/checks`, { ...options, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers }, signal: AbortSignal.timeout(15000) });
let r = await fetch(`${base}/api/v1/health`); assert.equal(r.status, 200); assert.equal((await r.json()).stage, 'B0'); pass('Workers route responds with versioned contract');
r = await request(); assert.equal(r.status, 401); pass('Missing identity rejected');
r = await request('x'.repeat(40)); assert.equal(r.status, 401); pass('Unverified identity rejected by real Auth');
const label = `API proof ${crypto.randomUUID()}`;
r = await request(accounts[0].accessToken, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ label }) });
assert.equal(r.status, 201); const record = (await r.json()).data; assert.equal(record.owner_id, accounts[0].userId); pass('Authenticated API persists caller-owned row');
r = await request(accounts[0].accessToken); assert.equal(r.status, 200); assert.ok((await r.json()).data.some(x => x.id === record.id)); assert.match(r.headers.get('Cache-Control'), /no-store/); pass('Owner reload receives persisted private data');
r = await request(accounts[1].accessToken); assert.equal(r.status, 200); assert.ok(!(await r.json()).data.some(x => x.id === record.id)); pass('Second account cannot receive first account data');
for (const body of [{ label: ' ', }, { label: 'x'.repeat(121) }, { label: 'forged', owner_id: accounts[1].userId }]) {
  r = await request(accounts[0].accessToken, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); assert.equal(r.status, 422);
} pass('Empty, oversized and forged ownership inputs rejected');
r = await request(accounts[0].accessToken, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }); assert.equal(r.status, 400); pass('Malformed JSON has controlled response');
r = await request(accounts[0].accessToken, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'x'.repeat(3000) }) }); assert.equal(r.status, 413); pass('Body length is bounded');
r = await request(accounts[0].accessToken, { headers: { Origin: 'https://untrusted.example' } }); assert.equal(r.status, 403); pass('Unlisted browser origin rejected');
r = await request(null, { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:4174', 'Access-Control-Request-Method': 'POST' } }); assert.equal(r.status, 204); assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:4174'); pass('Standalone client has explicit preflight support');
r = await request(accounts[0].accessToken, { headers: { Origin: 'http://127.0.0.1:4174' } }); assert.equal(r.status, 200); assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:4174'); pass('Standalone client can access the same authenticated API');
mkdirSync('docs/evidence', { recursive: true });
writeFileSync('docs/evidence/B0_API_RESULTS.json', JSON.stringify({ checkedAt: new Date().toISOString(), base, runtime: 'local workerd (verify launch command)', results }, null, 2) + '\n');
console.log(JSON.stringify({ passed: results.length, failed: 0, credentialsPrinted: false }));
