// Scoped SQL settlement counters/parity. Every measurement rolls back; no global stats reset.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { measureSyntheticRoomReadCost, probeSyntheticRoomSchedulePolicy, probeSyntheticRoomSettlementParity } from '../helpers/room-fixture.mjs';
import { readEnv, clientEnvPath, runtimeRoot } from '../../scripts/local-backend/env.mjs';
const env = readEnv(clientEnvPath), admin = readEnv(resolve(runtimeRoot, 'server.env')).SUPABASE_SERVICE_ROLE_KEY;
assert.equal(env.SUPABASE_URL, 'http://127.0.0.1:54321');
const ownership = readEnv(resolve(runtimeRoot, 'docker.env'));
assert.equal(ownership.DIMA_REPO_ROOT, resolve('.')); assert.equal(ownership.DIMA_BACKEND_ROOT, runtimeRoot);
const labels = JSON.parse(execFileSync('docker', ['inspect', 'dima-b0-db', '--format', '{{json .Config.Labels}}'], { encoding: 'utf8' }));
assert.equal(labels['com.docker.compose.project'], 'dima-b0'); assert.equal(labels['com.docker.compose.project.config_files'], resolve('scripts/local-backend/compose.yaml'));
const base = 'http://127.0.0.1:8787', runId = randomUUID();
async function api(actor, path, method = 'GET', body) {
  const response = await fetch(`${base}/api/v1/${path}`, { method, headers: { Authorization: `Bearer ${actor.token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
  const data = await response.json(); assert.equal(response.status, 200, data.error?.code); return data;
}
async function actor(tag) {
  const email = `b5-readcost-${runId}-${tag}@example.test`, password = randomBytes(24).toString('base64url');
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

const before = process.argv.includes('--before');
const evidence = { runId, phase: before ? 'before030' : 'after030', startedAt: new Date().toISOString(), cases: [], cleanup: false, credentialsPrinted: false };
let owner, roomId;
try {
  owner = await actor('owner');
  roomId = (await command(owner, { type: 'create', deviceId: owner.deviceId, title: 'Synthetic read cost', description: 'Rollback-only SQL cost counters', language: 'en', topic: 'Read cost', offeringId: null, presetId: 'classic', acknowledgeVisibility: true, visibilityVersion: 1 })).receipt.roomId;
  for (const kind of ['me', 'snapshot', 'grant', 'intent']) {
    const result = await measureSyntheticRoomReadCost(owner.userId, roomId, kind);
    evidence.cases.push(result);
    assert.equal(result.settlementCalls, kind === 'grant' ? 1 : before ? 2 : 1);
    assert.equal(result.jobTupleUpdates, before ? result.scheduleCalls : 0);
    assert.ok(result.scheduleCalls >= 1);
    assert.equal(result.publicProjectionCalls, ({ me: before ? 3 : 2, snapshot: before ? 4 : 2, grant: 1, intent: before ? 4 : 3 })[kind]);
  }
  evidence.schedulePolicy = await probeSyntheticRoomSchedulePolicy(owner.userId, roomId);
  for (const result of evidence.schedulePolicy) assert.equal(result.passed, before && result.name === 'already-idle-no-tuple-update' ? false : true, result.name);
  if (!before) {
    const current = (await api(owner, `rooms/${roomId}`)).data;
    const started = await command(owner, { type: 'startRun', roomId, roomVersion: current.version, deviceId: owner.deviceId, controlVersion: owner.me.membership.controlVersion });
    const time = (await api(owner, 'time')).data;
    await command(owner, { type: 'joinRound', roomId, deviceId: owner.deviceId, controlVersion: owner.me.membership.controlVersion,
      runId: started.receipt.runId, roundIndex: 1, expectedTimeRevision: time.revision, category: 'work', enrollmentId: null, taskId: null });
    evidence.ledgerParity = [];
    for (const paused of [false, true]) {
      const result = await probeSyntheticRoomSettlementParity(owner.userId, roomId, paused);
      evidence.ledgerParity.push(result);
      assert.ok(result.equalState && result.exactDeadline && result.internalOnly && result.existingServiceAbi);
    }
  }
} finally {
  if (roomId) {
    owner.me = (await api(owner, 'rooms/me')).data;
    const time = (await api(owner, 'time')).data;
    await command(owner, { type: 'leave', roomId, deviceId: owner.deviceId, controlVersion: owner.me.membership.controlVersion, expectedTimeRevision: time.revision, fromSessionId: time.active?.id ?? null, timeControlVersion: time.active?.controlVersion ?? null });
    const current = (await api(owner, `rooms/${roomId}`)).data;
    await command(owner, { type: 'close', roomId, roomVersion: current.version });
    evidence.cleanup = true;
  }
  evidence.checkedAt = new Date().toISOString();
  writeFileSync(`docs/evidence/B5_ROOM_READ_COST_${before ? 'BEFORE' : 'AFTER'}_${runId}.json`, JSON.stringify(evidence, null, 2) + '\n');
}
assert.ok(evidence.cleanup);
console.log(JSON.stringify(evidence));
