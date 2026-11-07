// Explicit, bounded hosted validation. Creates two disposable users and removes only those IDs.
// Run: node --experimental-strip-types tests/integration/hosted-smoke.mjs --run-hosted
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { subscribeRoom } from '../../packages/client/src/realtime.ts';
if (!process.argv.includes('--run-hosted')) throw new Error('Explicit --run-hosted required.');
const secretPath = '/home/amro/.local/state/dima-production/worker-secrets.json';
assert.equal(statSync(secretPath).mode & 0o077, 0);
const env = JSON.parse(readFileSync(secretPath, 'utf8'));
assert.equal(env.SUPABASE_URL, 'https://vblsmzgbodqnlxlplnby.supabase.co');
const origin = 'https://dima.study';
const service = env.SUPABASE_SERVICE_ROLE_KEY;
const require = createRequire(resolve('packages/client/package.json'));
const { RealtimeClient } = require('@supabase/realtime-js');
const runId = randomUUID(), actors = [], subscriptions = [], results = [], cleanup = [];
const secrets = new Set(Object.values(env));
const redact = value => { let out = String(value); for (const value of secrets) if (typeof value === 'string' && value.length > 10) out = out.replaceAll(value, '[redacted]'); return out; };
const pass = name => { results.push({ name, status: 'passed' }); console.log(JSON.stringify({ passed: name })); };
async function http(actor, path, method = 'GET', body, extraHeaders = {}) {
  const response = await fetch(`${origin}/api/v1/${path}`, { method, headers: { ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}), 'Content-Type': 'application/json', ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
  let data; try { data = await response.json(); } catch { data = null; }
  return { status: response.status, body: data };
}
async function admin(path, method = 'GET', body) {
  return fetch(`${env.SUPABASE_URL}/auth/v1/admin/${path}`, { method, headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
}
async function actor(tag) {
  const email = `b7-disposable-${runId}-${tag}@example.test`, password = randomBytes(32).toString('base64url'); secrets.add(password);
  const created = await admin('users', 'POST', { email, password, email_confirm: true, user_metadata: { validation_run: runId, disposable: true } });
  assert.equal(created.status, 200, `Create synthetic ${tag}`);
  const user = await created.json(), a = { id: user.id, email, deviceId: randomUUID() }; actors.push(a);
  const signed = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(20000) });
  assert.equal(signed.status, 200, `Synthetic sign in ${tag}`);
  const session = await signed.json(); a.token = session.access_token; secrets.add(a.token); secrets.add(session.refresh_token);
  const profile = await http(a, 'me'); assert.equal(profile.status, 200, 'Read account');
  const saved = await http(a, 'me', 'PATCH', { operationId: randomUUID(), expectedRevision: profile.body.data.profile?.revision ?? 0, displayName: `Dima validation ${tag}`, timezone: 'UTC', intent: 'learning', appearance: 'light', reducedMotion: false, onboarded: true });
  assert.equal(saved.status, 200, `Save profile: ${saved.body?.error?.code}`);
  const reopened = await http(a, 'me'); assert.equal(reopened.status, 200); assert.equal(reopened.body.data.profile.displayName, `Dima validation ${tag}`); assert.equal(reopened.body.data.accountId, a.id);
  return a;
}
async function me(actor, roomId) { const r = await http(actor, `rooms/me${roomId ? `?roomId=${roomId}` : ''}`); assert.equal(r.status, 200); actor.me = r.body.data; return actor.me; }
async function command(actor, body) {
  await me(actor, body.roomId);
  const r = await http(actor, 'rooms', 'POST', { operationId: randomUUID(), expectedRevision: actor.me.revision, ...body });
  assert.equal(r.status, 200, `Room command ${body.type}: ${r.body?.error?.code}`); actor.me = r.body.data; return r.body;
}
async function grant(actor, roomId) { const r = await http(actor, `rooms/${roomId}/realtime`, 'POST', {}); assert.equal(r.status, 200, `Grant: ${r.body?.error?.code}`); secrets.add(r.body.data.token); return r.body.data; }
async function until(check, label) { const end = Date.now() + 18000; while (!check()) { if (Date.now() >= end) throw new Error(`Timed out: ${label}`); await sleep(75); } }
async function open(credentials) {
  const states = [], hints = [], abort = new globalThis.AbortController();
  const handle = await subscribeRoom({ grant: credentials, signal: abort.signal, onStatus: state => states.push(state), onInvalidate: hint => hints.push(hint) });
  const sub = { hints, close: () => { abort.abort(); handle.close(); } }; subscriptions.push(sub);
  await until(() => states.includes('connected'), 'hosted authorized subscription'); return sub;
}
let failure, roomId;
try {
  const catalog = await http(null, 'catalog'); assert.equal(catalog.status, 200); assert.equal(catalog.body.data.length, 2);
  assert.equal((await http(null, 'me')).status, 401);
  pass('HTTPS public catalog has two courses; anonymous account access denied');
  const owner = await actor('owner'), member = await actor('member');
  const mismatched = await http(owner, 'me', 'PATCH', {}, { 'X-Dima-Account-Id': member.id }); assert.equal(mismatched.status, 409);
  const rest = await fetch(`${env.SUPABASE_URL}/rest/v1/account_profiles?user_id=eq.${owner.id}&select=user_id`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${member.token}` }, signal: AbortSignal.timeout(15000) });
  assert.equal(rest.status, 200); assert.deepEqual(await rest.json(), []);
  pass('Two real hosted profiles persist; mismatched account mutation and cross-account reads blocked');
  const created = await command(owner, { type: 'create', deviceId: owner.deviceId, title: 'Temporary deployment validation', description: 'Disposable automated launch validation', topic: 'Deployment validation', offeringId: null, language: 'en', presetId: 'classic', acknowledgeVisibility: true, visibilityVersion: 1 });
  roomId = created.receipt.roomId;
  assert.equal((await http(member, `rooms/${roomId}/realtime`, 'POST', {})).status, 403);
  await command(member, { type: 'join', roomId, deviceId: member.deviceId, acknowledgeVisibility: true, visibilityVersion: 1 });
  const ownerGrant = await grant(owner, roomId), memberGrant = await grant(member, roomId);
  const claims = JSON.parse(Buffer.from(memberGrant.token.split('.')[1], 'base64url').toString());
  assert.equal(claims.role, 'anon'); assert.equal(claims.aud, 'realtime'); assert.equal('sub' in claims, false);
  assert.equal((await http({ token: memberGrant.token }, 'me')).status, 401);
  const ownerSub = await open(ownerGrant), memberSub = await open(memberGrant);
  const hint = { version: 70001, phase: 'lobby', count: { reserved: 2, connected: 2 } };
  const broadcast = await fetch(`${env.SUPABASE_URL}/realtime/v1/api/broadcast`, { method: 'POST', headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ topic: ownerGrant.topic, event: 'invalidate', private: true, payload: hint }] }), signal: AbortSignal.timeout(15000) });
  assert.equal(broadcast.status, 202);
  await until(() => ownerSub.hints.some(h => h.version === 70001) && memberSub.hints.some(h => h.version === 70001), 'hosted private hint fanout');
  assert.deepEqual(memberSub.hints.find(h => h.version === 70001), hint);
  pass('Hosted room create/join and two private Realtime receivers get server hint; nonmember and token account misuse denied');
  const deniedClient = new RealtimeClient(memberGrant.url, { params: { apikey: memberGrant.anonKey }, logger: () => {}, timeout: 10000 });
  let state, message;
  try {
    await deniedClient.setAuth(memberGrant.token);
    deniedClient.channel(`room:${randomUUID()}`, { config: { private: true, presence: { enabled: false } } }).subscribe((next, error) => { if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT'].includes(next)) { state = next; message = error?.message ?? ''; } });
    await until(() => !!state, 'wrong room denial'); assert.equal(state, 'CHANNEL_ERROR'); assert.match(message, /permissions to read/);
  } finally { await deniedClient.removeAllChannels(); await deniedClient.disconnect(); }
  pass('Hosted managed Realtime RLS rejects a valid room capability on another room');
} catch (error) { failure = { name: error.name, message: redact(error.message).slice(0, 1000), stack: redact(error.stack).slice(0, 3000) }; }
finally {
  for (const sub of subscriptions) sub.close();
  for (const a of [...actors].reverse()) {
    try {
      const current = await admin(`users/${a.id}`); assert.equal(current.status, 200);
      const record = await current.json(); assert.equal(record.email, a.email); assert.equal(record.user_metadata.validation_run, runId); assert.equal(record.user_metadata.disposable, true);
      const removed = await admin(`users/${a.id}`, 'DELETE'); assert.equal(removed.status, 200);
      const absent = await admin(`users/${a.id}`); assert.equal(absent.status, 404);
      cleanup.push({ id: a.id, deleted: true, verifiedAbsent: true });
    } catch (error) { cleanup.push({ id: a.id, deleted: false, error: redact(error.message).slice(0, 500) }); }
  }
}
const report = { runId, at: new Date().toISOString(), origin, projectRef: 'vblsmzgbodqnlxlplnby', scope: 'Bounded production integration validation; no load, email delivery or browser claim', workerVersion: '5aba369c-2517-4dac-9dfd-3a924425ba60', harnessSha256: createHash('sha256').update(readFileSync('tests/integration/hosted-smoke.mjs')).digest('hex'), ok: !failure && cleanup.every(r => r.deleted), results, failure: failure ?? null, syntheticRoomId: roomId ?? null, syntheticAccounts: actors.length, cleanup };
writeFileSync('docs/evidence/B7_HOSTED_CORE_SMOKE.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ok: report.ok, passed: results.length, failure: failure?.message ?? null, cleanup: cleanup.map(r => ({ deleted: r.deleted, verifiedAbsent: r.verifiedAbsent })) }));
if (!report.ok) process.exitCode = 1;
