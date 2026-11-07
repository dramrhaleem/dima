// Run with node --experimental-strip-types. Uses actual local HTTP, RLS and official WebSockets.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, openSync, closeSync, fsyncSync, renameSync, linkSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { readEnv, runtimeRoot, clientEnvPath } from '../../scripts/local-backend/env.mjs';
import { signRoomRealtimeToken } from '../../apps/web/src/server/realtime-token.ts';
import { subscribeRoom } from '../../packages/client/src/realtime.ts';
import { ageSyntheticRoomLease } from '../helpers/room-fixture.mjs';
const require = createRequire(resolve('packages/client/package.json'));
const { RealtimeClient } = require('@supabase/realtime-js');
const config = readEnv(resolve(runtimeRoot, 'docker.env'));
assert.equal(config.DIMA_REPO_ROOT, process.cwd()); assert.equal(config.DIMA_BACKEND_ROOT, runtimeRoot);
for (const name of ['dima-b0-db', 'dima-b0-realtime']) {
  const labels = JSON.parse(execFileSync('docker', ['inspect', name, '--format', '{{json .Config.Labels}}'], { encoding: 'utf8' }));
  assert.equal(labels['com.docker.compose.project'], 'dima-b0');
  assert.equal(labels['com.docker.compose.project.config_files'], resolve('scripts/local-backend/compose.yaml'));
}
const buildRoot = JSON.parse(readFileSync('.local/worker-build.json', 'utf8')).directory;
assert.equal(readFileSync(resolve(buildRoot, '.dima-build-owner'), 'utf8'), process.cwd());
const build = JSON.parse(readFileSync(resolve(buildRoot, '.dima-build-inputs.json'), 'utf8'));
const env = readEnv(clientEnvPath); assert.equal(env.SUPABASE_URL, 'http://127.0.0.1:54321');
const service = readEnv(resolve(runtimeRoot, 'server.env')).SUPABASE_SERVICE_ROLE_KEY;
const base = 'http://127.0.0.1:8787/api/v1';
const run = randomUUID(); const actors = []; const subscriptions = []; const results = [];
const secrets = new Set([service, config.JWT_SECRET, config.POSTGRES_PASSWORD]);
const redact = value => { let text = String(value); for (const secret of secrets) if (secret) text = text.replaceAll(secret, '[REDACTED]'); return text; };
const pass = name => { results.push({ name, status: 'passed' }); console.log(JSON.stringify({ passed: name })); };
async function http(actor, path, method = 'GET', body) {
  const response = await fetch(`${base}/${path}`, { method, headers: { ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  return { status: response.status, body: await response.json() };
}
async function me(actor, roomId) { const r = await http(actor, `rooms/me${roomId ? `?roomId=${roomId}` : ''}`); assert.equal(r.status, 200); actor.me = r.body.data; return actor.me; }
async function command(actor, body) {
  await me(actor, body.roomId);
  const r = await http(actor, 'rooms', 'POST', { operationId: randomUUID(), expectedRevision: actor.me.revision, ...body });
  assert.equal(r.status, 200, redact(JSON.stringify(r.body.error))); actor.me = r.body.data; return r.body;
}
async function actor(tag) {
  const email = `b5-realtime-${run}-${tag}@example.test`; const password = randomBytes(24).toString('base64url'); secrets.add(password);
  const created = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }) });
  assert.equal(created.status, 200); const user = await created.json();
  const a = { id: user.id, email, deviceId: randomUUID() }; actors.push(a);
  const signed = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(signed.status, 200); const session = await signed.json(); a.token = session.access_token; secrets.add(a.token); secrets.add(session.refresh_token);
  const profile = await http(a, 'me'); assert.equal(profile.status, 200);
  const saved = await http(a, 'me', 'PATCH', { operationId: randomUUID(), expectedRevision: profile.body.data.profile?.revision ?? 0, displayName: `Synthetic realtime ${tag}`, timezone: 'UTC', intent: 'learning', appearance: 'light', reducedMotion: false, onboarded: true });
  assert.equal(saved.status, 200); await me(a); return a;
}
async function credentials(actor, roomId) {
  const r = await http(actor, `rooms/${roomId}/realtime`, 'POST', {}); assert.equal(r.status, 200, redact(JSON.stringify(r.body.error))); secrets.add(r.body.data.token); return r.body.data;
}
function scope(credentials, seatExpiresAt) {
  const claims = JSON.parse(Buffer.from(credentials.token.split('.')[1], 'base64url').toString());
  return { roomId: claims.dima_room_id, membershipId: claims.dima_membership_id, generation: claims.dima_generation, seatExpiresAt, topic: credentials.topic };
}
async function capability(original, grant) { const signed = await signRoomRealtimeToken(grant, config.JWT_SECRET); secrets.add(signed.token); return { ...original, ...signed }; }
async function until(check, label, timeout = 15000) { const end = globalThis.performance.now() + timeout; while (!check()) { if (globalThis.performance.now() >= end) throw new Error(`Timed out: ${label}`); await sleep(50); } }
async function open(grant) {
  const states = []; const hints = []; const abort = new globalThis.AbortController();
  const handle = await subscribeRoom({ grant, signal: abort.signal, onStatus: state => states.push(state), onInvalidate: hint => hints.push(hint) });
  const sub = { handle, states, hints, close: () => { abort.abort(); handle.close(); } }; subscriptions.push(sub);
  await until(() => states.includes('connected'), 'authorized subscription'); return sub;
}
async function denied(grant) {
  const client = new RealtimeClient(grant.url, { params: { apikey: grant.anonKey }, logger: () => {}, timeout: 10000 });
  let observed;
  try {
    await client.setAuth(grant.token);
    client.channel(grant.topic, { config: { private: true, presence: { enabled: false } } }).subscribe((state, error) => {
      if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT'].includes(state)) observed = { state, message: error?.message ?? '' };
    });
    await until(() => !!observed, 'explicit private-read denial');
    assert.equal(observed.state, 'CHANNEL_ERROR'); assert.match(observed.message, /You do not have permissions to read/);
  } finally { await client.removeAllChannels(); await client.disconnect(); }
}
async function publish(topic, version) {
  const hint = { version, phase: 'lobby', count: { reserved: 2, connected: 2 } };
  const response = await fetch(`${env.SUPABASE_URL}/realtime/v1/api/broadcast`, { method: 'POST', headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ topic, event: 'invalidate', private: true, payload: hint }] }), signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 202); return hint;
}
let failure;
try {
  const owner = await actor('owner'); const member = await actor('member'); const outsider = await actor('outsider');
  const created = await command(owner, { type: 'create', deviceId: owner.deviceId, title: 'Synthetic Realtime acceptance', description: 'Local authorization and lifecycle checks', topic: 'Realtime acceptance', offeringId: null, language: 'en', presetId: 'classic', acknowledgeVisibility: true, visibilityVersion: 1 });
  const roomId = created.receipt.roomId;
  await command(member, { type: 'join', roomId, deviceId: member.deviceId, acknowledgeVisibility: true, visibilityVersion: 1 });
  const ownerGrant = await credentials(owner, roomId); const memberGrant = await credentials(member, roomId);
  const claims = JSON.parse(Buffer.from(memberGrant.token.split('.')[1], 'base64url').toString());
  assert.equal(claims.role, 'anon'); assert.equal(claims.aud, 'realtime'); assert.equal(claims.iss, 'dima-room-realtime'); assert.equal('sub' in claims, false);
  assert.ok(claims.exp <= claims.iat + 120); assert.ok(claims.exp * 1000 <= Date.parse(member.me.membership.seatExpiresAt));
  assert.notEqual((await credentials(member, roomId)).token, memberGrant.token);
  assert.equal((await http(outsider, `rooms/${roomId}/realtime`, 'POST', {})).status, 403);
  pass('Authorized API issues fresh two-minute-or-lease no-sub capabilities; nonmember cannot obtain one');

  const scoped = { token: memberGrant.token };
  const auth = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${scoped.token}` } });
  assert.ok([401, 403].includes(auth.status)); assert.equal((await http(scoped, 'me')).status, 401); assert.equal((await http(scoped, 'rooms/me')).status, 401);
  const privateRest = await fetch(`${env.SUPABASE_URL}/rest/v1/room_memberships?limit=1`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${scoped.token}` } });
  assert.ok([401, 403].includes(privateRest.status));
  pass('Room capability is rejected by GoTrue user endpoint, private REST and account/room application APIs');

  const ownerSub = await open(ownerGrant); const memberSub = await open(memberGrant);
  const expected = await publish(ownerGrant.topic, 70001);
  await until(() => ownerSub.hints.some(h => h.version === expected.version) && memberSub.hints.some(h => h.version === expected.version), 'private hint fanout');
  assert.deepEqual(memberSub.hints.find(h => h.version === expected.version), expected);
  pass('Two real authorized subscriptions receive only phase/version/count through the production adapter');

  await denied({ ...memberGrant, topic: `room:${randomUUID()}` });
  await denied(await capability(memberGrant, { ...scope(memberGrant, member.me.membership.seatExpiresAt), generation: claims.dima_generation + 1 }));
  await denied({ ...memberGrant, token: member.token });
  pass('Wrong room, wrong generation and broad Auth JWT are denied by actual private-channel RLS');

  const directPublish = await fetch('http://127.0.0.1:54326/api/broadcast', { method: 'POST', headers: { Host: 'realtime-dev.supabase-realtime', Authorization: `Bearer ${memberGrant.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ topic: memberGrant.topic, event: 'invalidate', private: true, payload: expected }] }), signal: AbortSignal.timeout(10000) });
  assert.ok([401, 403].includes(directPublish.status));
  const writeClient = new RealtimeClient(memberGrant.url, { params: { apikey: memberGrant.anonKey }, logger: () => {}, timeout: 5000 });
  try {
    await writeClient.setAuth(memberGrant.token);
    let joined = false;
    const writeChannel = writeClient.channel(memberGrant.topic, { config: { private: true, broadcast: { ack: true }, presence: { enabled: false } } })
      .subscribe(state => { if (state === 'SUBSCRIBED') joined = true; });
    await until(() => joined, 'authorized receive channel before forbidden send');
    const result = await writeChannel.send({ type: 'broadcast', event: 'invalidate', payload: { ...expected, version: 79999 } });
    assert.equal(result, 'error', 'Server must explicitly reject private WebSocket publishing');
    await sleep(1000);
    assert.equal(ownerSub.hints.some(h => h.version === 79999), false);
  } finally { await writeClient.removeAllChannels(); await writeClient.disconnect(); }
  pass('Receive-only room token cannot publish over official HTTP or authorized WebSocket; another receiver sees no forged hint');

  const short = await capability(ownerGrant, { ...scope(ownerGrant, owner.me.membership.seatExpiresAt), seatExpiresAt: new Date(Date.now() + 3500).toISOString() });
  const expiring = await open(short);
  await until(() => expiring.states.includes('closed'), 'server expiration closes channel', 12000);
  await expiring.handle.updateGrant(await credentials(owner, roomId));
  await until(() => expiring.states.at(-1) === 'connected', 'fresh grant restores a closed channel');
  await publish(ownerGrant.topic, 70002); await until(() => expiring.hints.some(h => h.version === 70002), 'hint after closed recovery');
  expiring.close();
  pass('Actual short-token server CLOSED is restored by a fresh grant and receives a later hint');

  const oldMemberGrant = memberGrant; const oldScope = scope(memberGrant, member.me.membership.seatExpiresAt);
  await command(member, { type: 'takeControl', roomId, deviceId: randomUUID(), controlVersion: member.me.membership.controlVersion });
  await denied(oldMemberGrant);
  const currentGrant = await credentials(member, roomId);
  await memberSub.handle.updateGrant(currentGrant); await publish(currentGrant.topic, 70003);
  await until(() => memberSub.hints.some(h => h.version === 70003), 'fresh generation retains authorized receive');
  pass('Control generation revokes old credentials on join; current authorized grant keeps read-only subscription working');

  await command(owner, { type: 'ban', roomId, targetMembershipId: member.me.membership.id, reason: 'spam' });
  assert.equal((await http(member, `rooms/${roomId}/snapshot`)).status, 403);
  assert.equal((await http(member, `rooms/${roomId}/realtime`, 'POST', {})).status, 403);
  await denied(currentGrant);
  // The service throttles changed access-token messages. Wait beyond its documented10s window.
  await sleep(10500);
  const freshRevoked = await capability(currentGrant, { ...oldScope, generation: member.me.membership.controlVersion });
  const priorCloses = memberSub.states.filter(state => state === 'closed').length;
  await memberSub.handle.updateGrant(freshRevoked);
  await until(() => memberSub.states.filter(state => state === 'closed').length > priorCloses, 'changed-token RLS reauthorization revokes removed member');
  pass('Ban revokes private HTTP and new subscriptions; changed-token refresh closes the cached-policy channel');

  await ageSyntheticRoomLease(owner.id, roomId, owner.id);
  assert.equal((await http(owner, `rooms/${roomId}/snapshot`)).status, 403);
  assert.equal((await http(owner, `rooms/${roomId}/realtime`, 'POST', {})).status, 403);
  await denied(ownerGrant);
  pass('Expired owner seat cannot access roster or obtain/join with a room capability');
} catch (error) {
  failure = { name: error.name, message: redact(error.message).slice(0, 1000), stack: redact(error.stack).slice(0, 6000) };
} finally {
  for (const sub of subscriptions) sub.close();
}
const report = { runId: run, codeEvidence: { harnessSha256: createHash('sha256').update(readFileSync('tests/integration/rooms-realtime.mjs')).digest('hex'), buildFingerprint: build.fingerprint, builtAt: build.builtAt }, at: new Date().toISOString(), scope: 'Local real Auth/PostgREST/Realtime + current application APIs; no hosted/load claim', ok: !failure, results, failure: failure ?? null, syntheticAccounts: actors.length };
const reportText = JSON.stringify(report, null, 2) + '\n';
// Report the bounded result before persistence so an I/O failure cannot hide
// the test assertion. A failed temp write never truncates previous evidence.
console.log(JSON.stringify({ runId: run, ok: report.ok, passed: results.length, failure: failure?.message ?? null, reportBytes: Buffer.byteLength(reportText) }));
function saveEvidence(target, immutable) {
  const temporary = `${target}.${run}.tmp`;
  const descriptor = openSync(temporary, 'wx', 0o644);
  try { writeFileSync(descriptor, reportText); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  if (immutable) { linkSync(temporary, target); unlinkSync(temporary); }
  else renameSync(temporary, target);
}
try {
  saveEvidence(resolve(`docs/evidence/B5_PRIVATE_REALTIME_${run}.json`), true);
  saveEvidence(resolve('docs/evidence/B5_PRIVATE_REALTIME_RESULTS.json'), false);
} catch (error) {
  console.error(JSON.stringify({ event: 'evidence-write-failed', runId: run, code: error.code ?? null, reportBytes: Buffer.byteLength(reportText) }));
  throw error;
}
if (failure) process.exitCode = 1;
