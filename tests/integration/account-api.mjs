import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readEnv, clientEnvPath, runtimeRoot } from '../../scripts/local-backend/env.mjs';

const base = process.env.DIMA_TEST_API ?? 'http://127.0.0.1:8787';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Account API verification is local-only');
const env = readEnv(clientEnvPath);
const accounts = JSON.parse(readFileSync(resolve(runtimeRoot, 'test-accounts.json'), 'utf8'));
for (const a of accounts) {
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: a.email, password: a.password }), signal: AbortSignal.timeout(10000) });
  assert.equal(r.status, 200); a.accessToken = (await r.json()).access_token;
}
const [a, b] = accounts;
const results = [];
const pass = name => results.push({ name, status: 'passed' });
const request = (token, options = {}) => fetch(`${base}/api/v1/me`, { ...options, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers }, signal: AbortSignal.timeout(15000) });
const save = (body, token = a.accessToken, headers = {}) => request(token, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
let r = await request(); assert.equal(r.status, 401); pass('Missing account identity rejected');
r = await request('invalid-token'); assert.equal(r.status, 401); pass('Invalid account identity rejected');
r = await request(a.accessToken); assert.equal(r.status, 200); assert.match(r.headers.get('Cache-Control'), /no-store/);
const before = (await r.json()).data; assert.equal(before.role, 'member'); pass('Authenticated owner read is private and ignores forged metadata role');
const body = { displayName: `API owner ${randomUUID().slice(0, 8)}`, timezone: 'Africa/Cairo', intent: 'work', appearance: 'system', reducedMotion: true, onboarded: true, expectedRevision: before.profile?.revision ?? 0, operationId: randomUUID() };
r = await save(body); assert.equal(r.status, 200); const saved = await r.json(); assert.equal(saved.data.profile.displayName, body.displayName); assert.equal(saved.revision, body.expectedRevision + 1); assert.equal(saved.operationId, body.operationId); assert.ok(saved.requestId && saved.serverTime); pass('Versioned HTTP command saves profile with result metadata');
r = await request(a.accessToken); assert.equal(r.status, 200); assert.deepEqual((await r.json()).data.profile, saved.data.profile); pass('Profile survives a new request');
r = await request(b.accessToken); assert.equal(r.status, 200); assert.notEqual((await r.json()).data.profile?.displayName, body.displayName); pass('Second account never receives first account profile');
r = await save(body); assert.equal(r.status, 200); assert.deepEqual((await r.json()).data, saved.data); pass('HTTP retry remains idempotent');
r = await save({ ...body, operationId: randomUUID() }); assert.equal(r.status, 409); assert.equal((await r.json()).error.code, 'REVISION_CONFLICT'); pass('HTTP stale edit returns actionable conflict');
r = await save({ ...body, displayName: 'Different retry' }); assert.equal(r.status, 409); assert.equal((await r.json()).error.code, 'IDEMPOTENCY_MISMATCH'); pass('HTTP altered retry rejected');
for (const extra of [{ role: 'admin' }, { user_id: b.userId }, { timezone: 'Moon/City' }]) {
  r = await save({ ...body, expectedRevision: saved.revision, operationId: randomUUID(), ...extra }); assert.equal(r.status, 422);
} pass('HTTP schema rejects role, ownership and invalid timezone');
r = await save({ ...body, expectedRevision: saved.revision, operationId: randomUUID() }, a.accessToken, { 'X-Dima-Account-Id': b.userId }); assert.equal(r.status, 409); assert.equal((await r.json()).error.code, 'ACCOUNT_CHANGED'); pass('Account precondition prevents stale draft applying after cookie/account switch');
r = await save(body, a.accessToken, { Origin: 'https://untrusted.example' }); assert.equal(r.status, 403); pass('Foreign browser mutation origin rejected');
r = await request(a.accessToken, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{' }); assert.equal(r.status, 400); pass('Malformed command has safe response');
r = await save({ ...body, displayName: 'x'.repeat(5000) }); assert.equal(r.status, 413); pass('Profile body bound enforced');
writeFileSync('docs/evidence/B1_ACCOUNT_API_RESULTS.json', JSON.stringify({ checkedAt: new Date().toISOString(), base, results }, null, 2) + '\n');
console.log(JSON.stringify({ passed: results.length, failed: 0, credentialsPrinted: false }));
