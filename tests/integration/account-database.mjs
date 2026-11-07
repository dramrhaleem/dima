import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readEnv, clientEnvPath, runtimeRoot } from '../../scripts/local-backend/env.mjs';

const env = readEnv(clientEnvPath);
assert.equal(env.SUPABASE_URL, 'http://127.0.0.1:54321', 'Database verification is local-only');
const accounts = JSON.parse(readFileSync(resolve(runtimeRoot, 'test-accounts.json'), 'utf8'));
const request = (path, token, options = {}) => fetch(`${env.SUPABASE_URL}${path}`, { ...options,
  headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token ?? env.SUPABASE_ANON_KEY}`, ...options.headers },
  signal: AbortSignal.timeout(10000) });
for (const a of accounts) {
  const r = await request('/auth/v1/token?grant_type=password', null, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: a.email, password: a.password }) });
  assert.equal(r.status, 200, 'Fixture authentication status');
  a.accessToken = (await r.json()).access_token;
}
const [a, b] = accounts;
const results = [];
const pass = name => results.push({ name, status: 'passed' });
const rpc = (command, token = a.accessToken) => request('/rest/v1/rpc/save_account_profile', token,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_command: command }) });
const getA = () => request(`/rest/v1/account_profiles?user_id=eq.${a.userId}`, a.accessToken).then(r => r.json());
const current = (await getA())[0];
let revision = current?.revision ?? 0;
const body = { displayName: 'B1 private owner', timezone: 'Africa/Cairo', intent: 'work', appearance: 'system', reducedMotion: true, onboarded: true, expectedRevision: revision, operationId: randomUUID() };
let r = await rpc(body); assert.equal(r.status, 200, 'Initial atomic save status');
const first = await r.json(); assert.equal(first.revision, revision + 1); revision = first.revision; pass('Atomic caller-owned profile save');
r = await rpc(body); assert.equal(r.status, 200); assert.deepEqual(await r.json(), first); assert.equal((await getA())[0].revision, revision); pass('Identical operation replay returns original result without another revision');
r = await rpc({ ...body, displayName: 'Changed retry' }); assert.equal(r.status, 409); assert.equal((await r.json()).message, 'IDEMPOTENCY_MISMATCH'); pass('Same operation with altered payload rejected');
r = await rpc({ ...body, operationId: randomUUID() }); assert.equal(r.status, 409); assert.equal((await r.json()).message, 'REVISION_CONFLICT'); pass('Stale revision cannot overwrite saved profile');
const commands = ['Device A', 'Device B'].map(displayName => ({ ...body, displayName, expectedRevision: revision, operationId: randomUUID() }));
const race = await Promise.all(commands.map(x => rpc(x)));
assert.deepEqual(race.map(x => x.status).sort(), [200, 409]);
assert.equal((await getA())[0].revision, revision + 1); revision++; pass('Two concurrent device saves have exactly one winner');
r = await request(`/rest/v1/account_profiles?user_id=eq.${a.userId}`, b.accessToken); assert.equal(r.status, 200); assert.deepEqual(await r.json(), []); pass('Second account cannot read private profile');
r = await request(`/rest/v1/profile_operations?user_id=eq.${a.userId}`, b.accessToken); assert.equal(r.status, 200); assert.deepEqual(await r.json(), []); pass('Second account cannot read private command snapshots');
for (const table of ['account_profiles', 'account_roles', 'profile_operations']) {
  r = await request(`/rest/v1/${table}`, null); assert.equal(r.status, 401, `Anonymous ${table} denied`);
} pass('Anonymous private table access denied');
for (const extra of [{ user_id: b.userId }, { owner_id: b.userId }, { role: 'admin' }]) {
  r = await rpc({ ...body, expectedRevision: revision, operationId: randomUUID(), ...extra }); assert.equal(r.status, 422);
} pass('Direct RPC rejects forged ownership and role fields');
for (const patch of [{ timezone: 'Moon/City' }, { timezone: 'EST' }, { expectedRevision: 1.5 }, { onboarded: false }, { displayName: ' ' }, { appearance: 'neon' }, { intent: 'admin' }, { reducedMotion: null }]) {
  r = await rpc({ ...body, expectedRevision: revision, operationId: randomUUID(), ...patch }); assert.equal(r.status, 422, `Invalid field ${Object.keys(patch)[0]}`);
} pass('Database validates timezone, enum, revision, booleans and completed-onboarding invariants');
for (const invalid of [null, [], 'invalid', {}]) {
  r = await rpc(invalid); assert.equal(r.status, 422);
} pass('Malformed direct RPC payloads fail with controlled validation errors');
for (const [table, data] of [
  ['account_profiles', { user_id: a.userId, display_name: 'Bypass', intent: 'work', revision: 100 }],
  ['account_roles', { user_id: a.userId, role: 'admin' }],
  ['public_profiles', { user_id: a.userId, display_name: 'Publish bypass', visible: true }],
  ['profile_operations', { user_id: a.userId, operation_id: randomUUID(), command: {}, profile_result: {} }],
]) {
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    r = await request(`/rest/v1/${table}?user_id=eq.${a.userId}`, a.accessToken, { method, headers: { 'Content-Type': 'application/json' }, ...(method !== 'DELETE' ? { body: JSON.stringify(data) } : {}) });
    assert.equal(r.status, 403, `${method} ${table} denied`);
  }
} pass('Direct table insert/update/delete cannot bypass commands, public opt-in or role grants');
r = await request('/auth/v1/user', a.accessToken, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { role: 'admin' } }) }); assert.equal(r.status, 200);
r = await request(`/rest/v1/account_roles?user_id=eq.${a.userId}`, a.accessToken); assert.equal(r.status, 200); assert.deepEqual(await r.json(), []); pass('User-editable Auth metadata cannot grant account role');
r = await request(`/rest/v1/public_profiles?user_id=eq.${a.userId}`, null); assert.equal(r.status, 200); assert.deepEqual(await r.json(), []); pass('Saving a private profile never publishes it');
r = await rpc(body, null); assert.equal(r.status, 401); pass('Anonymous profile command denied');
writeFileSync('docs/evidence/B1_DATABASE_RESULTS.json', JSON.stringify({ checkedAt: new Date().toISOString(), environment: 'local real Auth/Postgres/PostgREST', results }, null, 2) + '\n');
console.log(JSON.stringify({ passed: results.length, failed: 0, credentialsPrinted: false }));
