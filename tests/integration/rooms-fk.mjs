// Focused local synthetic FK-cycle regression; immutable application histories are retained.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readEnv, clientEnvPath, runtimeRoot } from '../../scripts/local-backend/env.mjs';
import { ageSyntheticRoomLease, duringSyntheticProfileSave, grantSyntheticRoomModerator, probeSyntheticRoomFkCycle } from '../helpers/room-fixture.mjs';
const expectedDeadlock = process.argv.includes('--expect-deadlock');
assert.ok(process.argv.slice(2).every(arg => arg === '--expect-deadlock'));
const env = readEnv(clientEnvPath), admin = readEnv(resolve(runtimeRoot, 'server.env')).SUPABASE_SERVICE_ROLE_KEY;
assert.equal(env.SUPABASE_URL, 'http://127.0.0.1:54321');
const base = 'http://127.0.0.1:8787', runId = randomUUID();
async function api(actor, path, method = 'GET', body) {
  const response = await fetch(`${base}/api/v1/${path}`, { method, headers: { Authorization: `Bearer ${actor.token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
  const data = await response.json(); assert.equal(response.status, 200, data.error?.code); return data;
}
async function actor(tag) {
  const email = `b5-fk-${runId}-${tag}@example.test`, password = randomBytes(24).toString('base64url');
  const created = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: admin, Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }) });
  assert.equal(created.status, 200); const user = await created.json();
  const signed = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(signed.status, 200); const result = { userId: user.id, token: (await signed.json()).access_token, deviceId: randomUUID() };
  const profile = await api(result, 'me');
  await api(result, 'me', 'PATCH', { displayName: `Synthetic FK ${tag}`, timezone: 'UTC', intent: 'learning', appearance: 'light', reducedMotion: false, onboarded: true, expectedRevision: profile.data.profile?.revision ?? 0, operationId: randomUUID() });
  result.me = (await api(result, 'rooms/me')).data; return result;
}
async function command(person, body) {
  const result = await api(person, 'rooms', 'POST', { operationId: randomUUID(), expectedRevision: person.me.revision, ...body });
  person.me = result.data; return result;
}
const owner = await actor('owner'), member = await actor('member');
const created = await command(owner, { type: 'create', deviceId: owner.deviceId, title: 'Synthetic FK cycle', description: 'Local rollback-only lock regression', language: 'en', topic: 'FK evidence', offeringId: null, presetId: 'classic', acknowledgeVisibility: true, visibilityVersion: 1 });
const roomId = created.receipt.roomId, evidence = { runId, expectedDeadlock, checkedAt: new Date().toISOString(), cases: [], cleanup: false };
async function join(person) {
  return command(person, { type: 'join', roomId, deviceId: person.deviceId, acknowledgeVisibility: true, visibilityVersion: 1 });
}
try {
  await join(member);
  evidence.cases.push(await probeSyntheticRoomFkCycle(owner.userId, roomId, member.userId, 'owner'));
  await ageSyntheticRoomLease(owner.userId, roomId, member.userId);
  evidence.cases.push(await probeSyntheticRoomFkCycle(owner.userId, roomId, member.userId, 'membership'));
  for (const result of evidence.cases) {
    if (expectedDeadlock) assert.ok(result.deadlocks > 0, `${result.edge} must reproduce the original cycle`);
    else { assert.equal(result.deadlocks, 0); assert.equal(result.held.ok, true); assert.equal(result.writer.ok, true); }
  }
  if (!expectedDeadlock) {
    await grantSyntheticRoomModerator(owner.userId);
    for (const type of ['ban', 'suspendAccount']) {
      const target = await actor(type); await join(target);
      const membershipId = target.me.membership.id;
      await ageSyntheticRoomLease(owner.userId, roomId, target.userId);
      await duringSyntheticProfileSave(target.userId, () => command(owner, { type, roomId, targetMembershipId: membershipId, reason: type === 'ban' ? 'spam' : 'privacy' }));
      evidence.cases.push({ edge: `actual-expired-target-${type}`, completedBeforeHeldAccountReleased: true });
    }
  }
} finally {
  owner.me = (await api(owner, `rooms/me?roomId=${roomId}`)).data;
  if (owner.me.membership) {
    const time = (await api(owner, 'time')).data;
    await command(owner, { type: 'leave', roomId, deviceId: owner.deviceId, controlVersion: owner.me.membership.controlVersion,
      expectedTimeRevision: time.revision, fromSessionId: null, timeControlVersion: null });
  }
  const room = (await api(owner, `rooms/${roomId}`)).data;
  await command(owner, { type: 'close', roomId, roomVersion: room.version });
  evidence.cleanup = true;
  writeFileSync(`docs/evidence/B5_ROOM_FK_${expectedDeadlock ? 'BEFORE' : 'AFTER'}_${runId}.json`, JSON.stringify(evidence, null, 2) + '\n');
}
console.log(JSON.stringify({ cases: evidence.cases, cleanup: evidence.cleanup, credentialsPrinted: false }));
