// One local synthetic client's protocol trace. Payloads and credentials are never serialized.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { readEnv, clientEnvPath, runtimeRoot } from '../../scripts/local-backend/env.mjs';
const env = readEnv(clientEnvPath), admin = readEnv(resolve(runtimeRoot, 'server.env')).SUPABASE_SERVICE_ROLE_KEY;
assert.equal(env.SUPABASE_URL, 'http://127.0.0.1:54321');
const ownership = readEnv(resolve(runtimeRoot, 'docker.env'));
assert.equal(ownership.DIMA_REPO_ROOT, resolve('.')); assert.equal(ownership.DIMA_BACKEND_ROOT, runtimeRoot);
const labels = JSON.parse(execFileSync('docker', ['inspect', 'dima-b0-db', '--format', '{{json .Config.Labels}}'], { encoding: 'utf8' }));
assert.equal(labels['com.docker.compose.project'], 'dima-b0'); assert.equal(labels['com.docker.compose.project.config_files'], resolve('scripts/local-backend/compose.yaml'));
const base = 'http://127.0.0.1:8787', runId = randomUUID();
const require = createRequire(resolve('packages/client/package.json'));
const { RealtimeClient } = require('@supabase/realtime-js');
async function api(actor, path, method = 'GET', body) {
  const response = await fetch(`${base}/api/v1/${path}`, { method, headers: { Authorization: `Bearer ${actor.token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
  const data = await response.json(); assert.equal(response.status, 200, data.error?.code); return data;
}
async function actor(tag) {
  const email = `b5-wire-${runId}-${tag}@example.test`, password = randomBytes(24).toString('base64url');
  const created = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: admin, Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }) });
  assert.equal(created.status, 200); const user = await created.json();
  const signed = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(signed.status, 200); const result = { userId: user.id, token: (await signed.json()).access_token, deviceId: randomUUID() };
  const profile = await api(result, 'me');
  await api(result, 'me', 'PATCH', { displayName: `Synthetic wire ${tag}`, timezone: 'UTC', intent: 'learning', appearance: 'light', reducedMotion: false, onboarded: true, expectedRevision: profile.data.profile?.revision ?? 0, operationId: randomUUID() });
  result.me = (await api(result, 'rooms/me')).data; return result;
}
async function command(person, body) {
  const result = await api(person, 'rooms', 'POST', { operationId: randomUUID(), expectedRevision: person.me.revision, ...body });
  person.me = result.data; return result;
}

const owner = await actor('owner');
const made = await command(owner, { type: 'create', deviceId: owner.deviceId, title: 'Synthetic wire trace', description: 'One-client protocol diagnosis', language: 'en', topic: 'Protocol trace', offeringId: null, presetId: 'classic', acknowledgeVisibility: true, visibilityVersion: 1 });
const roomId = made.receipt.roomId, trace = [], started = performance.now();
let mode = 'sdk', client = null, raw = null, failure = null;
const evidence = { runId, startedAt: new Date().toISOString(), sdkVersion: require('@supabase/realtime-js/package.json').version, trace, cleanup: false };
const events = new Set(['phx_join','phx_reply','phx_error','phx_close','phx_leave','heartbeat','access_token','broadcast','system','presence_state','presence_diff']);
const ref = value => value == null ? null : /^\d{1,10}$/.test(String(value)) ? String(value) : 'other';
function note(value) { trace.push({ mode, elapsedMs: Math.round(performance.now() - started), ...value }); }
function frame(direction, text) {
  let value; try { value = JSON.parse(text); } catch { note({ direction, event: 'non-json' }); return; }
  const msg = Array.isArray(value) ? { join_ref: value[0], ref: value[1], topic: value[2], event: value[3], payload: value[4] } : value;
  const row = { direction, event: events.has(msg.event) ? msg.event : 'other', ref: ref(msg.ref), joinRef: ref(msg.join_ref), topic: msg.topic === `realtime:room:${roomId}` ? 'own-room' : msg.topic === 'phoenix' ? 'phoenix' : 'other' };
  if (['ok','error'].includes(msg.payload?.status)) row.status = msg.payload.status;
  const reason = msg.payload?.response?.reason ?? msg.payload?.message ?? msg.payload?.reason;
  if (typeof reason === 'string') row.reason = /too many channels|too_many_channels/i.test(reason) ? 'too-many-channels' : /unauthorized/i.test(reason) ? 'unauthorized' : 'other';
  note(row);
}
class TraceSocket extends globalThis.WebSocket {
  constructor(url, protocols) {
    super(url, protocols);
    this.addEventListener('open', () => note({ transport: 'open' }));
    this.addEventListener('close', () => note({ transport: 'closed' }));
    this.addEventListener('error', () => note({ transport: 'error' }));
    this.addEventListener('message', event => frame('in', event.data));
  }
  send(data) { frame('out', data); return super.send(data); }
}
async function until(check) { const end = performance.now() + 10000; while (!check()) { if (performance.now() > end) throw new Error('WIRE_WAIT_TIMEOUT'); await delay(25); } }
async function grant() { return (await api(owner, `rooms/${roomId}/realtime`, 'POST', {})).data; }
async function pulse(intent) { await command(owner, { type: 'setIntent', roomId, deviceId: owner.deviceId, controlVersion: owner.me.membership.controlVersion, intent }); await delay(750); }
try {
  const credentials = await grant();
  client = new RealtimeClient(credentials.url, { params: { apikey: credentials.anonKey }, transport: TraceSocket, timeout: 10000, logger: () => {} });
  await client.setAuth(credentials.token);
  let subscribed = false;
  client.channel(credentials.topic, { config: { private: true, broadcast: { self: false, ack: false }, presence: { enabled: false } } })
    .on('broadcast', { event: '*' }, () => note({ callback: 'broadcast' }))
    .subscribe(status => { note({ callback: ['SUBSCRIBED','CHANNEL_ERROR','CLOSED','TIMED_OUT'].includes(status) ? status : 'other' }); if (status === 'SUBSCRIBED') subscribed = true; });
  await until(() => subscribed); await delay(500); await pulse('reading');
  await client.setAuth((await grant()).token); await delay(250); await pulse('practice');
  await client.removeAllChannels(); await client.disconnect(); client = null; await delay(300);
  mode = 'raw';
  const credentials2 = await grant(), url = new URL(`${credentials2.url}/websocket`);
  url.protocol = 'ws:'; url.searchParams.set('apikey', credentials2.anonKey); url.searchParams.set('vsn', '1.0.0');
  raw = new TraceSocket(url); await until(() => raw.readyState === globalThis.WebSocket.OPEN);
  raw.send(JSON.stringify({ topic: `realtime:${credentials2.topic}`, event: 'phx_join', payload: { config: { private: true, broadcast: { self: false, ack: false }, presence: { enabled: false }, postgres_changes: [] }, access_token: credentials2.token }, ref: '1', join_ref: '1' }));
  await until(() => trace.some(row => row.mode === 'raw' && row.event === 'phx_reply' && row.ref === '1' && row.status === 'ok'));
  await delay(500); await pulse('project'); raw.close(); await until(() => raw.readyState === globalThis.WebSocket.CLOSED); raw = null;
} catch (error) { failure = error?.name ?? 'WIRE_FAILURE'; }
finally {
  if (client) { await client.removeAllChannels().catch(() => {}); await client.disconnect(); }
  if (raw) raw.close();
  mode = 'cleanup'; owner.me = (await api(owner, `rooms/me?roomId=${roomId}`)).data;
  const time = (await api(owner, 'time')).data;
  await command(owner, { type: 'leave', roomId, deviceId: owner.deviceId, controlVersion: owner.me.membership.controlVersion, expectedTimeRevision: time.revision, fromSessionId: null, timeControlVersion: null });
  const room = (await api(owner, `rooms/${roomId}`)).data; await command(owner, { type: 'close', roomId, roomVersion: room.version });
  evidence.cleanup = true; evidence.failure = failure;
  writeFileSync(`docs/evidence/B5_ROOM_WIRE_${runId}.json`, JSON.stringify(evidence, null, 2) + '\n');
}
console.log(JSON.stringify({ trace, failure, cleanup: evidence.cleanup, credentialsPrinted: false }));
if (failure) process.exitCode = 1;
