// Focused synthetic outbox/Worker regressions. No production clock or test endpoint.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { mutateSyntheticRoomHint, duringSyntheticRoomHintLock } from '../helpers/room-fixture.mjs';
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
  const email = `b5-hints-${runId}-${tag}@example.test`, password = randomBytes(24).toString('base64url');
  const created = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: admin, Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }) });
  assert.equal(created.status, 200); const user = await created.json();
  const signed = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(signed.status, 200); const result = { userId: user.id, token: (await signed.json()).access_token, deviceId: randomUUID() };
  const profile = await api(result, 'me');
  await api(result, 'me', 'PATCH', { displayName: `Synthetic hints ${tag}`, timezone: 'UTC', intent: 'learning', appearance: 'light', reducedMotion: false, onboarded: true, expectedRevision: profile.data.profile?.revision ?? 0, operationId: randomUUID() });
  result.me = (await api(result, 'rooms/me')).data; return result;
}
async function command(person, body) {
  const result = await api(person, 'rooms', 'POST', { operationId: randomUUID(), expectedRevision: person.me.revision, ...body });
  person.me = result.data; return result;
}

const cooldownOnly = process.argv.includes('--cooldown-wake-only');
const evidence = { runId, mode: cooldownOnly ? 'cross-request-cooldown-wake' : 'fast-and-durable', startedAt: new Date().toISOString(), cases: [], cleanup: [], credentialsPrinted: false };
const people = [], rooms = [], realtimeClients = [];
async function rpc(name, body, token = admin) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, { method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
async function dispatch() {
  const response = await fetch(`${base}/api/internal/jobs/dispatch`, { method: 'POST',
    headers: { Authorization: `Bearer ${readEnv(resolve(runtimeRoot, 'jobs.env')).DIMA_JOBS_TOKEN}`, 'Content-Type': 'application/json' },
    body: '{}', signal: AbortSignal.timeout(45000) });
  assert.equal(response.status, 200); return (await response.json()).data;
}
async function row(roomId) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/room_outbox?room_id=eq.${roomId}&select=version,pending,attempts,claim_token,lease_until`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${admin}` }, signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200); return (await response.json())[0];
}
async function until(check, timeout = 10000) {
  const end = performance.now() + timeout;
  while (performance.now() < end) { if (await check()) return; await delay(50); }
  throw new Error('Synthetic producer observation deadline exceeded');
}
async function claim(roomId) {
  const result = await rpc('claim_room_hints', { p_limit: 1, p_rooms: [roomId] });
  assert.equal(result.status, 200); assert.equal(result.data.length, 1); return result.data[0];
}
async function ack(claimed, extra = {}) {
  const result = await rpc('ack_room_hint_result', { p_room: claimed.roomId, p_claim: claimed.claimToken, p_version: claimed.version, ...extra });
  assert.equal(result.status, 200); return result.data;
}
try {
  if (cooldownOnly) {
    const owner = await actor('wake'); people.push(owner);
    const made = await command(owner, { type: 'create', deviceId: owner.deviceId, title: 'Synthetic cross-request wake', description: 'Scoped Worker lifetime regression', language: 'en', topic: 'Hints', offeringId: null, presetId: 'classic', acknowledgeVisibility: true, visibilityVersion: 1 });
    const roomId = made.receipt.roomId; rooms.push({ id: roomId, owner });
    const grant = (await api(owner, `rooms/${roomId}/realtime`, 'POST', {})).data;
    const realtime = new RealtimeClient(grant.url, { params: { apikey: grant.anonKey }, logger: () => {}, timeout: 10000 });
    realtimeClients.push(realtime); await realtime.setAuth(grant.token);
    let subscribed = false; const arrivals = [];
    realtime.channel(grant.topic, { config: { private: true, broadcast: { self: false, ack: false }, presence: { enabled: false } } })
      .on('broadcast', { event: 'invalidate' }, message => { arrivals.push({ version: message.payload.version, phase: message.payload.phase, at: performance.now() }); })
      .subscribe(status => { if (status === 'SUBSCRIBED') subscribed = true; });
    await until(() => subscribed);
    const warm = await command(owner, { type: 'setIntent', roomId, deviceId: owner.deviceId, controlVersion: owner.me.membership.controlVersion, intent: 'reading' });
    await until(() => arrivals.some(item => item.version >= warm.data.room.hintVersion));
    const warmAt = arrivals.find(item => item.version >= warm.data.room.hintVersion).at;
    // Let the previous completed owner's fetch settle, then create a distinct
    // ordinary owner that must wait on its retained2s watermark cooldown.
    await delay(100);
    const ordinary = await command(owner, { type: 'setIntent', roomId, deviceId: owner.deviceId, controlVersion: owner.me.membership.controlVersion, intent: 'practice' });
    await delay(200);
    assert.equal(arrivals.some(item => item.version >= ordinary.data.room.hintVersion), false, 'The ordinary descriptor must still be pending before the urgent request');
    const transitionStarted = performance.now();
    const urgent = await command(owner, { type: 'startRun', roomId, deviceId: owner.deviceId, controlVersion: owner.me.membership.controlVersion, roomVersion: owner.me.room.version });
    await until(() => arrivals.some(item => item.version >= urgent.data.room.hintVersion && item.phase === 'focus'), 2000);
    const observed = arrivals.find(item => item.version >= urgent.data.room.hintVersion && item.phase === 'focus');
    const urgentObservedMs = Math.round(observed.at - transitionStarted), sinceWarmMs = Math.round(observed.at - warmAt);
    assert.ok(urgentObservedMs < 1000, 'Urgent request must wake promptly');
    assert.ok(sinceWarmMs < 1500, 'The newer phase must arrive before the ordinary2s pacing window');
    evidence.cases.push({ name: 'A subsequent Worker request wakes an existing ordinary cooldown owner', passed: true,
      pendingObservedMs: 200, urgentObservedMs, sinceWarmMs, ordinaryVersionObservedBeforeUrgent: false });
  } else {
  for (let index = 0; index < 8; index++) people.push(await actor(String(index)));
  for (let index = 0; index < 4; index++) {
    const made = await command(people[index], { type: 'create', deviceId: people[index].deviceId, title: `Synthetic producer ${index}`, description: 'Scoped delivery regression', language: 'en', topic: 'Hints', offeringId: null, presetId: 'classic', acknowledgeVisibility: true, visibilityVersion: 1 });
    rooms.push({ id: made.receipt.roomId, owner: people[index] });
  }
  const selected = rooms[0], owner = selected.owner, roomId = selected.id;
  for (const member of people.slice(4)) await command(member, { type: 'join', roomId, deviceId: member.deviceId, acknowledgeVisibility: true, visibilityVersion: 1 });
  // Fast publication deliberately leaves durable rows pending. The normal
  // dispatcher establishes a clean baseline for the SQL lease regressions.
  await dispatch();
  assert.ok((await Promise.all(rooms.map(room => row(room.id)))).every(value => !value.pending));
  for (const token of [env.SUPABASE_ANON_KEY, owner.token]) {
    const denied = await rpc('ack_room_hint_result', { p_room: roomId, p_claim: randomUUID(), p_version: 1 }, token);
    assert.ok([401, 403].includes(denied.status));
  }
  evidence.cases.push({ name: 'ACK remains service-only', passed: true });

  // Real SQL handoff: a producer finds the second claim busy, and its version
  // is exposed by the authoritative ACK instead of disappearing at pass2.
  await mutateSyntheticRoomHint(owner.userId, roomId, 'emit');
  const first = await claim(roomId);
  await mutateSyntheticRoomHint(owner.userId, roomId, 'emit');
  assert.equal((await rpc('claim_room_hints', { p_limit: 1, p_rooms: [roomId] })).data.length, 0);
  assert.deepEqual(await ack(first), { accepted: true, pending: true });
  const second = await claim(roomId);
  await mutateSyntheticRoomHint(owner.userId, roomId, 'emit');
  assert.equal((await rpc('claim_room_hints', { p_limit: 1, p_rooms: [roomId] })).data.length, 0);
  assert.deepEqual(await ack(second), { accepted: true, pending: true });
  const third = await claim(roomId);
  assert.deepEqual(await ack(third, { p_version: third.version + 1 }), { accepted: false, pending: false });
  assert.equal((await row(roomId)).claim_token === third.claimToken, true);
  assert.deepEqual(await ack(third), { accepted: true, pending: false });
  assert.deepEqual(await ack(second), { accepted: false, pending: false });
  evidence.cases.push({ name: 'Second-pass handoff and stale/future ACK fences', passed: true });

  // Force a row lock in the maintenance UPDATE before claim acquisition.
  await mutateSyntheticRoomHint(owner.userId, roomId, 'emit');
  await mutateSyntheticRoomHint(owner.userId, roomId, 'exhaust');
  const before = await row(roomId); const started = performance.now();
  const timed = await duringSyntheticRoomHintLock(owner.userId, roomId, () => rpc('claim_room_hints', { p_limit: 1, p_rooms: [roomId] }));
  const elapsedMs = Math.round(performance.now() - started);
  assert.equal(timed.data.code, '57014'); assert.ok(timed.status >= 400); assert.ok(elapsedMs < 8000);
  const after = await row(roomId);
  assert.equal(JSON.stringify(after) === JSON.stringify(before), true, 'Timed-out transaction must not change a lease');
  await mutateSyntheticRoomHint(owner.userId, roomId, 'reset');
  evidence.cases.push({ name: 'Actual REST hoisted2s timeout rolls back held-row claim', passed: true, sqlstate: timed.data.code, elapsedMs });

  // Deliberately discard a successful committed claim response. No new server or
  // production override: this simulates unknown receipt, not a measured WAN loss.
  const lost = await claim(roomId);
  assert.equal((await row(roomId)).pending, true);
  assert.equal((await rpc('claim_room_hints', { p_limit: 1, p_rooms: [roomId] })).data.length, 0);
  await mutateSyntheticRoomHint(owner.userId, roomId, 'expire');
  const recovered = await claim(roomId);
  assert.equal(recovered.claimToken !== lost.claimToken, true);
  assert.deepEqual(await ack(lost), { accepted: false, pending: false });
  assert.deepEqual(await ack(recovered), { accepted: true, pending: false });
  evidence.cases.push({ name: 'Simulated lost committed response retains lease and recovers', passed: true, networkLossMeasured: false });

  const latest = new Map(), received = new Map(), leases = [], broadcastViolations = [];
  for (const room of rooms) {
    const grant = (await api(room.owner, `rooms/${room.id}/realtime`, 'POST', {})).data;
    const realtime = new RealtimeClient(grant.url, { params: { apikey: grant.anonKey }, logger: () => {}, timeout: 10000 });
    realtimeClients.push(realtime); await realtime.setAuth(grant.token); let subscribed = false;
    latest.set(room.id, 0); received.set(room.id, []);
    realtime.channel(grant.topic, { config: { private: true, broadcast: { self: false, ack: false }, presence: { enabled: false } } })
      .on('broadcast', { event: '*' }, message => {
        if (message.event !== 'invalidate' || JSON.stringify(Object.keys(message.payload ?? {}).sort()) !== JSON.stringify(['count', 'phase', 'version'])
          || JSON.stringify(Object.keys(message.payload?.count ?? {}).sort()) !== JSON.stringify(['connected', 'reserved'])) { broadcastViolations.push('Unexpected broadcast shape'); return; }
        latest.set(room.id, Math.max(latest.get(room.id), message.payload.version)); received.get(room.id).push(message.payload.version);
      })
      .subscribe(status => { if (status === 'SUBSCRIBED') subscribed = true; });
    await until(() => subscribed);
    await mutateSyntheticRoomHint(room.owner.userId, room.id, 'emit'); leases.push(await claim(room.id));
  }
  // Four independent leased rows prove the fast path neither waits for nor
  // acknowledges SQL claims. All four real SDK receivers observe their latest
  // committed version from eight simultaneous requests under actual workerd.
  const results = await Promise.all(people.map(person => command(person, { type: 'setIntent', roomId: person.me.membership.roomId, deviceId: person.deviceId, controlVersion: person.me.membership.controlVersion, intent: 'reading' })));
  const expected = new Map(rooms.map(room => [room.id, Math.max(...results.filter(result => result.receipt.roomId === room.id).map(result => result.data.room.hintVersion))]));
  await until(() => rooms.every(room => latest.get(room.id) >= expected.get(room.id)));
  for (const lease of leases) {
    const current = await row(lease.roomId);
    assert.equal(current.pending, true); assert.equal(current.claim_token, lease.claimToken);
  }
  evidence.cases.push({ name: 'Real workerd fast publishers deliver four latest hints without touching held outbox leases', passed: true, concurrentCommands: 8, rooms: 4, receivedLatestVersion: true });

  // A trusted phase transition is urgent even immediately after ordinary
  // delivery; it still leaves the same durable recovery lease untouched.
  owner.me = (await api(owner, 'rooms/me')).data;
  const transitionStarted = performance.now();
  const startedRun = await command(owner, { type: 'startRun', roomId, deviceId: owner.deviceId, controlVersion: owner.me.membership.controlVersion, roomVersion: owner.me.room.version });
  await until(() => latest.get(roomId) >= startedRun.data.room.hintVersion, 2000);
  const phaseObservedMs = Math.round(performance.now() - transitionStarted);
  assert.ok(phaseObservedMs <= 2000); assert.equal((await row(roomId)).claim_token, leases[0].claimToken);
  evidence.cases.push({ name: 'Urgent StartRun is received within2s without clearing durable recovery', passed: true, phaseObservedMs });
  for (const lease of leases) assert.deepEqual(await ack(lease), { accepted: true, pending: true });
  const deliveriesBeforeRecovery = rooms.map(room => received.get(room.id).length);
  const recoveredDelivery = await dispatch();
  assert.ok(recoveredDelivery.hintsDelivered >= 4);
  await until(() => rooms.every((room, index) => received.get(room.id).length > deliveriesBeforeRecovery[index]));
  assert.ok((await Promise.all(rooms.map(room => row(room.id)))).every(value => !value.pending));
  assert.deepEqual(broadcastViolations, []);
  evidence.cases.push({ name: 'Normal dispatcher republishes and acknowledges pending fast-path recovery versions', passed: true, rooms: 4 });
  // No post-commit producer is invoked by this guarded fixture. One real
  // dispatcher must drain more than its 3-row claim batch, rather than wait30s.
  for (const room of rooms) await mutateSyntheticRoomHint(room.owner.userId, room.id, 'emit');
  assert.equal((await Promise.all(rooms.map(room => row(room.id)))).filter(value => value.pending).length, 4);
  const dispatchStarted = performance.now();
  const dispatchResult = await dispatch();
  assert.ok(dispatchResult.hintsDelivered >= 4);
  assert.ok((await Promise.all(rooms.map(room => row(room.id)))).every(value => !value.pending));
  evidence.cases.push({ name: 'One real dispatcher drains four independently queued rooms across claim batches', passed: true,
    rooms: 4, hintsDelivered: dispatchResult.hintsDelivered, durationMs: Math.round(performance.now() - dispatchStarted) });
  }
} finally {
  for (const realtime of realtimeClients) { await realtime.removeAllChannels(); await realtime.disconnect(); }
  for (const person of people) {
    try {
      person.me = (await api(person, 'rooms/me')).data;
      if (person.me.membership) {
        const time = (await api(person, 'time')).data;
        await command(person, { type: 'leave', roomId: person.me.membership.roomId, deviceId: person.deviceId, controlVersion: person.me.membership.controlVersion, expectedTimeRevision: time.revision, fromSessionId: null, timeControlVersion: null });
      }
      evidence.cleanup.push({ account: people.indexOf(person), released: true });
    } catch { evidence.cleanup.push({ account: people.indexOf(person), released: false }); }
  }
  for (const room of rooms) {
    try { const current = (await api(room.owner, `rooms/${room.id}`)).data; await command(room.owner, { type: 'close', roomId: room.id, roomVersion: current.version }); evidence.cleanup.push({ room: rooms.indexOf(room), closed: true }); }
    catch { evidence.cleanup.push({ room: rooms.indexOf(room), closed: false }); }
  }
  evidence.checkedAt = new Date().toISOString();
  writeFileSync(`docs/evidence/B5_HINT_PRODUCER_${runId}.json`, JSON.stringify(evidence, null, 2) + '\n');
}
assert.ok(evidence.cleanup.every(item => item.released ?? item.closed));
console.log(JSON.stringify({ cases: evidence.cases, cleanup: true, credentialsPrinted: false }));
