// Local-only API regression for member-started shared cycles; no production traffic.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readEnv, clientEnvPath, runtimeRoot } from '../../scripts/local-backend/env.mjs';
import { ageSyntheticRoomRun } from '../helpers/room-fixture.mjs';

const base = process.env.DIMA_TEST_API ?? 'http://127.0.0.1:8787';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const env = readEnv(clientEnvPath);
assert.equal(env.SUPABASE_URL, 'http://127.0.0.1:54321');
const admin = readEnv(resolve(runtimeRoot, 'server.env')).SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: admin, Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' };
const run = randomUUID(), actors = [], passes = [];
const pass = name => { passes.push(name); console.log(`PASS ${name}`); };
async function request(actor, path, method = 'GET', body) {
  const response = await fetch(`${base}/api/v1/${path}`, { method, headers: { Authorization: `Bearer ${actor.token}`, 'X-Dima-Account-Id': actor.id, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
  const result = await response.json().catch(() => null);
  return { status: response.status, ...result };
}
async function read(actor, path) { const r = await request(actor, path); assert.equal(r.status, 200, r.error?.code); return r.data; }
async function account(tag) {
  const email = `b5-cycle-${run}-${tag}@example.test`, password = randomBytes(24).toString('base64url');
  const created = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, { method: 'POST', headers, body: JSON.stringify({ email, password, email_confirm: true }) });
  assert.equal(created.status, 200);
  const user = await created.json();
  const actor = { id: user.id, email, deviceId: randomUUID() }; actors.push(actor);
  const login = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(login.status, 200); actor.token = (await login.json()).access_token;
  const saved = await request(actor, 'me', 'PATCH', { displayName: `Cycle ${tag}`, timezone: 'UTC', intent: 'learning', appearance: 'light', reducedMotion: true, onboarded: true, expectedRevision: 0, operationId: randomUUID() });
  assert.equal(saved.status, 200, saved.error?.code); return actor;
}
function sqlFor(actor, query) {
  assert.match(actor.id, /^[a-f0-9-]{36}$/);
  const label = spawnSync('docker', ['inspect', 'dima-b0-db', '--format', '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}'], { encoding: 'utf8' });
  assert.equal(label.stdout.trim(), `dima-b0|${resolve('scripts/local-backend/compose.yaml')}`);
  const result = spawnSync('docker', ['exec', '-i', 'dima-b0-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], { encoding: 'utf8', input: `BEGIN; DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id='${actor.id}' AND email='${actor.email}') THEN RAISE EXCEPTION 'Synthetic identity required'; END IF; END $$; ${query}; COMMIT;` });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
async function command(actor, body) { const me = await read(actor, 'rooms/me'); return { operationId: randomUUID(), expectedRevision: me.revision, ...body }; }
async function send(actor, body, expected = 200) { const r = await request(actor, 'rooms', 'POST', body); assert.equal(r.status, expected, r.error?.code); return r; }
async function startCommand(actor, roomId) {
  const me = await read(actor, 'rooms/me'); const room = await read(actor, `rooms/${roomId}`);
  return { operationId: randomUUID(), expectedRevision: me.revision, type: 'startRun', roomId, deviceId: actor.deviceId, controlVersion: me.membership?.controlVersion ?? 1, roomVersion: room.version };
}
try {
  const owner = await account('owner'), first = await account('first'), second = await account('second'), outsider = await account('outsider');
  const created = await send(owner, await command(owner, { type: 'create', deviceId: owner.deviceId, title: 'Member cycle fixture', description: '', language: 'en', topic: 'Local testing', offeringId: null, presetId: 'classic', acknowledgeVisibility: true, visibilityVersion: 1 }));
  const roomId = created.receipt.roomId;
  const originalModerator = created.data.membership.id;
  for (const actor of [first, second]) await send(actor, await command(actor, { type: 'join', roomId, deviceId: actor.deviceId, acknowledgeVisibility: true, visibilityVersion: 1 }));
  for (const actor of [owner, first, second]) assert.equal((await read(actor, `rooms/${roomId}/snapshot`)).capabilities.canStartRun, true);
  const invalid = await startCommand(first, roomId);
  assert.equal((await send(first, { ...invalid, deviceId: randomUUID() }, 409)).error.code, 'CONTROL_LOST');
  assert.equal((await send(first, { ...invalid, roomVersion: invalid.roomVersion + 100 }, 409)).error.code, 'ROOM_VERSION_CONFLICT');
  assert.equal((await send(outsider, await startCommand(outsider, roomId), 403)).error.code, 'REJOIN_REQUIRED');
  pass('Only valid controlled membership can start; non-host capability is available and stale versions denied');

  const inputs = await Promise.all([startCommand(first, roomId), startCommand(second, roomId)]);
  const outcomes = await Promise.all([request(first, 'rooms', 'POST', inputs[0]), request(second, 'rooms', 'POST', inputs[1])]);
  assert.deepEqual(outcomes.map(x => x.status).sort(), [200, 409]);
  const winnerIndex = outcomes[0].status === 200 ? 0 : 1;
  const winner = [first, second][winnerIndex];
  assert.equal((await send(winner, inputs[winnerIndex])).replayed, true);
  assert.equal(sqlFor(owner, `SELECT count(*) FROM public.room_runs WHERE room_id='${roomId}' AND status='active'`), '1');
  assert.equal(sqlFor(owner, `SELECT current_host_membership_id FROM public.room_runs WHERE room_id='${roomId}' AND status='active'`), originalModerator);
  assert.equal(sqlFor(owner, `SELECT current_host_membership_id FROM public.rooms WHERE id='${roomId}'`), originalModerator);
  const snapshot = await read(winner, `rooms/${roomId}/snapshot`);
  assert.equal(snapshot.capabilities.canStartRun, false); assert.equal(snapshot.capabilities.canRemove, false); assert.equal(snapshot.capabilities.canEdit, false);
  assert.equal(snapshot.participants.find(p => p.membershipId === originalModerator).isHost, true);
  for (const actor of [owner, first, second]) { const time = await read(actor, 'time'); assert.equal(time.active, null); assert.equal(time.sessions.length, 0); }
  pass('Concurrent non-host requests create one cycle, replay is safe, moderation unchanged and personal time stays off');

  await ageSyntheticRoomRun(owner.id, roomId, 7801);
  const finished = await read(first, `rooms/${roomId}/snapshot`);
  assert.equal(finished.capabilities.canStartRun, true);
  const next = await startCommand(first, roomId);
  const expired = await startCommand(second, roomId);
  sqlFor(second, `UPDATE public.room_memberships SET last_seen_at=clock_timestamp()-interval '181 seconds' WHERE user_id='${second.id}' AND room_id='${roomId}'`);
  assert.equal((await send(second, expired, 403)).error.code, 'REJOIN_REQUIRED');
  await send(first, next);
  assert.equal(sqlFor(owner, `SELECT count(*) FROM public.room_runs WHERE room_id='${roomId}'`), '2');
  assert.equal((await read(first, 'time')).active, null);
  pass('Completed cycle returns to ready without automatic restart; expired seats denied and valid member can start next cycle');
} finally {
  const cleanup = await Promise.allSettled(actors.map(async actor => {
    const response = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${actor.id}`, { method: 'DELETE', headers });
    assert.ok(response.ok, `Synthetic account cleanup failed: ${response.status}`);
  }));
  assert.ok(cleanup.every(x => x.status === 'fulfilled'), 'Synthetic cleanup must finish for every created account');
}
assert.equal(passes.length, 3);
console.log(JSON.stringify({ passed: passes.length, credentialsPrinted: false, localOnly: true }));
