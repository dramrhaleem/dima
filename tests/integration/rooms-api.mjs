import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { openSync, writeFileSync, fsyncSync, closeSync, linkSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { readEnv, clientEnvPath, runtimeRoot } from '../../scripts/local-backend/env.mjs';
import { ageSyntheticRoomLease, ageSyntheticRoomRun, grantSyntheticRoomModerator, ageSyntheticOpenSession, setSyntheticRoomArchiveAge, ageSyntheticRoomActivity, duringSyntheticProfileSave } from '../helpers/room-fixture.mjs';

const base = process.env.DIMA_TEST_API ?? 'http://127.0.0.1:8787';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const env = readEnv(clientEnvPath);
assert.equal(env.SUPABASE_URL, 'http://127.0.0.1:54321');
const admin = readEnv(resolve(runtimeRoot, 'server.env')).SUPABASE_SERVICE_ROLE_KEY;
assert.ok(admin);
const runId = randomUUID();
const results = [];
const pass = name => results.push({ name, status: 'passed' });
const consent = { acknowledgeVisibility: true, visibilityVersion: 1 };
const solo = { mode: 'solo', category: 'work', title: 'Synthetic independent work', enrollmentId: null, taskId: null,
  settings: { focusMinutes: 5, shortBreakMinutes: 1, longBreakMinutes: 5, longBreakAfter: 4 } };
async function request(actor, path, method = 'GET', body, extra = {}) {
  const response = await fetch(`${base}/api/v1/${path}`, {
    method, headers: { ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}), 'Content-Type': 'application/json', ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function rest(path, method = 'GET', body, actor) {
  const token = actor === null ? env.SUPABASE_ANON_KEY : actor?.token ?? admin;
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method, headers: { apikey: actor === undefined ? admin : env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, data: response.status === 204 ? null : await response.json() };
}
async function rpc(name, body = {}) {
  const response = await rest(`rpc/${name}`, 'POST', body);
  assert.ok([200, 204].includes(response.status), `${name} (${response.status}): ${JSON.stringify(response.data)}`);
  return response.data;
}
async function claimTargetJob(kind, id) {
  for (let batch = 0; batch < 50; batch += 1) {
    const jobs = await rpc(kind === 'account' ? 'claim_room_account_jobs' : 'claim_room_jobs', { p_limit: 10 });
    const target = jobs.find(item => item.id === id);
    for (const job of jobs.filter(item => item.id !== id)) {
      await rpc(kind === 'account' ? 'execute_room_account_job' : 'execute_room_job', {
        [kind === 'account' ? 'p_actor' : 'p_room']: job.id, p_claim: job.claimToken,
      });
    }
    if (target) return target;
    if (!jobs.length) break;
  }
  assert.fail(`Expected due synthetic ${kind} job was not claimable within the bounded queue drain`);
}
async function loadMe(actor, roomId) {
  const response = await request(actor, `rooms/me${roomId ? `?roomId=${roomId}` : ''}`);
  assert.equal(response.status, 200, JSON.stringify(response.body.error));
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  actor.me = response.body.data;
  return actor.me;
}
async function loadTime(actor) {
  const response = await request(actor, 'time');
  assert.equal(response.status, 200, JSON.stringify(response.body.error));
  actor.time = response.body.data;
  return actor.time;
}
async function load(actor, roomId) { await loadTime(actor); await loadMe(actor, roomId); }
async function createActor(tag, profileMode = 'onboarded') {
  const email = `b5-api-${runId}-${tag}@example.test`;
  const password = randomBytes(24).toString('base64url');
  const created = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: admin, Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }) });
  assert.equal(created.status, 200);
  const user = await created.json();
  const signedIn = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(signedIn.status, 200);
  const actor = { userId: user.id, token: (await signedIn.json()).access_token, deviceId: randomUUID() };
  if (profileMode === 'missing') return actor;
  const profile = await request(actor, 'me');
  assert.equal(profile.status, 200);
  const saved = await request(actor, 'me', 'PATCH', { displayName: `Synthetic ${tag}`, timezone: 'UTC', intent: 'learning', appearance: 'light', reducedMotion: false, onboarded: profileMode === 'onboarded',
    expectedRevision: profile.body.data.profile?.revision ?? 0, operationId: randomUUID() });
  assert.equal(saved.status, 200);
  if (profileMode === 'onboarded') await load(actor);
  return actor;
}
const command = (actor, body) => ({ operationId: randomUUID(), expectedRevision: actor.me.revision, ...body });
const timeCommand = (actor, body) => ({ operationId: randomUUID(), expectedRevision: actor.time.revision, ...body });
async function sendRoom(actor, body, status = 200, extra) {
  const response = await request(actor, 'rooms', 'POST', body, extra);
  assert.equal(response.status, status, `${body.type}: ${JSON.stringify(response.body.error)}`);
  if (response.body.data) actor.me = response.body.data;
  if (response.body.time) actor.time = response.body.time;
  return response.body;
}
async function sendTime(actor, body, status = 200) {
  const response = await request(actor, 'time', 'POST', body);
  assert.equal(response.status, status, `${body.type}: ${JSON.stringify(response.body.error)}`);
  if (response.body.data) actor.time = response.body.data;
  await loadMe(actor);
  return response.body;
}
const presence = actor => ({ roomId: actor.me.membership.roomId, deviceId: actor.deviceId, controlVersion: actor.me.membership.controlVersion });
const controlled = actor => ({ sessionId: actor.time.active.id, deviceId: actor.deviceId, controlVersion: actor.time.active.controlVersion });
const openInterval = actor => actor.time.intervals.find(i => i.sessionId === actor.time.active?.id && i.endAt === null);
const finish = actor => timeCommand(actor, { type: 'finish', ...controlled(actor), intervalId: openInterval(actor)?.id ?? null });
const moveIntent = actor => ({ expectedTimeRevision: actor.time.revision, fromSessionId: actor.time.active?.id ?? null, timeControlVersion: actor.time.active?.controlVersion ?? null });
const create = actor => command(actor, { type: 'create', deviceId: actor.deviceId, title: 'Synthetic focus room', description: 'Private API acceptance room', language: 'en', topic: 'API acceptance', offeringId: null, presetId: 'classic', ...consent });
const join = (actor, roomId) => command(actor, { type: 'join', roomId, deviceId: actor.deviceId, ...consent });
async function snapshot(actor, roomId = actor.me.membership.roomId) {
  const response = await request(actor, `rooms/${roomId}/snapshot`);
  assert.equal(response.status, 200, JSON.stringify(response.body.error));
  actor.me = response.body.data.me;
  return response.body.data;
}
async function startRun(actor) {
  const state = await snapshot(actor);
  return sendRoom(actor, command(actor, { type: 'startRun', ...presence(actor), roomVersion: state.room.version }));
}
async function joinRound(actor, link = {}) {
  await load(actor);
  const state = await snapshot(actor);
  return sendRoom(actor, command(actor, { type: 'joinRound', ...presence(actor), runId: state.room.run.id, roundIndex: state.room.phase.roundIndex,
    expectedTimeRevision: actor.time.revision, category: 'work', enrollmentId: null, taskId: null, ...link }));
}

// Onboarding lives in the RPC transaction, including direct authenticated REST reads.
for (const profileMode of ['missing', 'false']) {
  const actor = await createActor(`onboarding-${profileMode}`, profileMode);
  const roomId = randomUUID(), body = create({ ...actor, me: { revision: 0 } });
  const beforeProfile = await rest(`account_profiles?user_id=eq.${actor.userId}&select=onboarded,revision`, 'GET', undefined, actor);
  assert.equal(beforeProfile.status, 200);
  assert.deepEqual(beforeProfile.data.map(row => row.onboarded), profileMode === 'missing' ? [] : [false]);
  for (const [path, method, input] of [
    ['rooms/me', 'GET'], [`rooms/${roomId}/snapshot`, 'GET'], ['rooms/reports', 'GET'],
    [`rooms/${roomId}/realtime`, 'POST', {}], ['rooms', 'POST', body],
  ]) {
    const denied = await request(actor, path, method, input);
    assert.equal(denied.status, 409, `${profileMode} ${path}`);
    assert.equal(denied.body.error.code, 'ONBOARDING_REQUIRED');
  }
  for (const [name, input, caller] of [
    ['read_room_me', { p_room: null }, actor],
    ['read_room_snapshot', { p_room: roomId }, actor],
    ['read_room_reports', { p_status: 'open', p_limit: 1 }, actor],
    ['read_room_realtime_grant', { p_actor: actor.userId, p_room: roomId }, undefined],
    ['execute_room_command', { p_actor: actor.userId, p_command: body }, undefined],
  ]) {
    const denied = await rest(`rpc/${name}`, 'POST', input, caller);
    assert.equal(denied.status, 409, `${profileMode} ${name}`);
    assert.equal(denied.data.message, 'ONBOARDING_REQUIRED');
  }
  for (const [table, field] of [['room_accounts', 'user_id'], ['room_operations', 'user_id'], ['room_memberships', 'user_id'], ['rooms', 'owner_id'], ['time_sessions', 'user_id'], ['round_participations', 'user_id']]) {
    const rows = await rest(`${table}?${field}=eq.${actor.userId}&select=*`);
    assert.equal(rows.status, 200); assert.deepEqual(rows.data, [], `${profileMode} ${table} side effects`);
  }
  assert.deepEqual((await rest(`account_profiles?user_id=eq.${actor.userId}&select=onboarded,revision`, 'GET', undefined, actor)).data, beforeProfile.data);
  const hiddenHelper = await rest('rpc/rooms_require_onboarded', 'POST', { p_actor: actor.userId }, actor);
  assert.equal(hiddenHelper.status, 403);
}
for (const [name, input] of [
  ['read_room_me', { p_room: null }],
  ['read_room_snapshot', { p_room: randomUUID() }],
  ['read_room_reports', { p_status: 'open', p_limit: 1 }],
  ['read_room_realtime_grant', { p_actor: randomUUID(), p_room: randomUUID() }],
  ['execute_room_command', { p_actor: randomUUID(), p_command: { operationId: randomUUID(), type: 'leave' } }],
]) {
  const denied = await rest(`rpc/${name}`, 'POST', input);
  assert.equal(denied.status, 401, name); assert.equal(denied.data.message, 'AUTH_REQUIRED');
}
pass('missing/false onboarding denied in HTTP and all five private RPCs, no side effects; helper inaccessible and absent actors denied');

const a = await createActor('owner');
const profiledRead = await request(a, 'rooms/me');
assert.equal(profiledRead.status, 200);
assert.match(profiledRead.headers.get('Server-Timing'), /rpc;dur=/);
assert.doesNotMatch(profiledRead.headers.get('Server-Timing'), /(?:^|,\s*)profile;dur=/);
const b = await createActor('learner');
const c = await createActor('third');
const d = await createActor('moderator');
await grantSyntheticRoomModerator(d.userId);
await loadMe(d);
let response = await request(null, 'rooms/options');
assert.equal(response.status, 200); assert.equal(response.body.data.offerings.length, 2);
assert.ok(JSON.stringify(response.body).length < 1000);
assert.equal((await request(null, 'rooms/me')).status, 401);
response = await request(null, 'rooms', 'GET', undefined, { Origin: 'http://127.0.0.1:4174' });
assert.equal(response.status, 200); assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:4174');
assert.equal((await request(null, 'rooms', 'GET', undefined, { Origin: 'https://foreign.example' })).status, 403);
for (const table of ['rooms', 'room_memberships', 'round_participations', 'room_reports', 'room_operations']) {
  assert.ok([401, 403].includes((await rest(`${table}?limit=1`, 'GET', undefined, null)).status));
  assert.ok([401, 403].includes((await rest(`${table}?limit=1`, 'GET', undefined, b)).status));
}
assert.ok([401, 403].includes((await rest('rpc/execute_room_command', 'POST', { p_actor: a.userId, p_command: create(a) }, b)).status));
pass('Public compact options and directory CORS; private identity and raw table/RPC privilege closure');

const createdCommand = create(a);
await sendRoom(a, { ...createdCommand, acknowledgeVisibility: false }, 422);
const created = await sendRoom(a, createdCommand);
const room = created.receipt.roomId;
assert.equal(a.me.membership.isOwner, true); assert.equal(a.me.membership.isHost, true);
assert.equal(a.time.active, null);
const replay = await sendRoom(a, createdCommand);
assert.deepEqual(replay.receipt, created.receipt); assert.equal(replay.replayed, true);
await sendRoom(a, { ...createdCommand, title: 'Changed retry title' }, 409);
await sendRoom(b, join(b, room)); await sendRoom(c, join(c, room));
assert.equal((await snapshot(b)).participants.length, 3);
assert.equal(b.time.active, null);
response = await request(null, `rooms/${room}`);
assert.equal(response.status, 200);
const publicText = JSON.stringify(response.body);
assert.ok(!publicText.includes('Synthetic learner') && !publicText.includes(b.userId) && !publicText.includes('participants'));
assert.equal((await request(d, `rooms/${room}/snapshot`)).status, 403);
pass('RF02 explicit consent creates Watching membership, no time; idempotency and public/private projections');

const beforeRenew = (await request(null, `rooms/${room}`)).body.data.hintVersion;
const beforeOperations = (await rest(`room_operations?user_id=eq.${b.userId}&select=operation_id`)).data.length;
const renewCommand = command(b, { type: 'renewPresence', ...presence(b) });
const renewed = await sendRoom(b, renewCommand);
const renewedAgain = await sendRoom(b, renewCommand);
assert.deepEqual(renewedAgain.receipt, renewed.receipt);
assert.equal(renewedAgain.data.membership.lastSeenAt, renewed.data.membership.lastSeenAt);
assert.equal((await request(null, `rooms/${room}`)).body.data.hintVersion, beforeRenew);
assert.equal((await rest(`room_operations?user_id=eq.${b.userId}&select=operation_id`)).data.length, beforeOperations);
await sendTime(b, timeCommand(b, { type: 'start', deviceId: b.deviceId, ...solo, previousSessionId: null }), 409);
pass('One bounded presence heartbeat has no permanent receipt or ordinary broadcast; Watching blocks unconfirmed Solo');

// Private course/task linkage must remain invisible to every other room viewer.
let learning = (await request(b, 'learning')).body.data;
const privateId = `private-b5-${randomUUID().slice(0, 8)}`;
const draft = { id: privateId, title: 'SECRET private curriculum', sourceUrl: 'https://example.edu/private', courses: [{ id: 'c', title: 'SECRET course', position: 0,
  modules: [{ id: 'm', title: 'SECRET module', position: 0, tasks: [{ id: 'private-task', title: 'SECRET personal task', position: 0, kind: 'reading', minutes: 30, estimateSource: 'user', requirement: 'required', sourceUrl: 'https://example.edu/private', prerequisiteIds: [] }] }] }] };
response = await request(b, 'learning', 'POST', { type: 'saveDraft', draft, operationId: randomUUID(), expectedRevision: learning.state.revision });
assert.equal(response.status, 200); learning = response.body.data;
response = await request(b, 'learning', 'POST', { type: 'enroll', offeringId: privateId, taskIds: ['private-task'], priorTaskIds: [], estimates: {}, targetDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10), operationId: randomUUID(), expectedRevision: learning.state.revision });
assert.equal(response.status, 200); learning = response.body.data;
const enrollmentId = learning.state.enrollments[0].id;
const learningBefore = (await request(b, 'learning')).body.data.state;
await startRun(a);
await ageSyntheticRoomRun(a.userId, room, 18 * 60);
await load(b);
const late = await snapshot(b);
const roundCommand = command(b, { type: 'joinRound', ...presence(b), runId: late.room.run.id, roundIndex: 1, expectedTimeRevision: b.time.revision, category: 'learning', enrollmentId, taskId: 'private-task' });
const roundRace = await Promise.all([request(b, 'rooms', 'POST', roundCommand), request(b, 'rooms', 'POST', { ...roundCommand, operationId: randomUUID() })]);
assert.deepEqual(roundRace.map(r => r.status).sort(), [200, 409]);
const acceptedRound = roundRace.find(r => r.status === 200).body;
b.me = acceptedRound.data; b.time = acceptedRound.time;
const winningRound = roundRace[0].status === 200 ? roundCommand : null;
if (winningRound) assert.equal((await sendRoom(b, winningRound)).replayed, true);
const firstSession = b.time.active.id;
const firstParticipation = b.time.active.participationId;
assert.ok(Date.parse(openInterval(b).boundaryAt) - Date.parse(openInterval(b).startAt) <= 420000);
assert.equal(Date.parse(b.time.active.roomDeadlineAt), Date.parse(late.room.phase.endsAt));
assert.ok(!JSON.stringify(await snapshot(a)).includes('SECRET'));
pass('RF03/RF09/RF13 late JoinRound receives at most remaining7min, one Session, no private course/task leakage');

await joinRound(a);
const ownerSession = a.time.active.id;
const deadline = b.time.active.roomDeadlineAt;
await sendTime(b, timeCommand(b, { type: 'pause', ...controlled(b), intervalId: openInterval(b).id }));
assert.equal((await loadTime(a)).active.id, ownerSession);
const pausedEnd = b.time.intervals.find(i => i.sessionId === firstSession).endAt;
await sendTime(b, timeCommand(b, { type: 'resume', ...controlled(b) }));
assert.equal(b.time.active.roomDeadlineAt, deadline);
assert.ok(Date.parse(openInterval(b).startAt) >= Date.parse(pausedEnd));
assert.equal(openInterval(b).boundaryAt, deadline);
await sendTime(b, finish(b));
await joinRound(b, { category: 'learning', enrollmentId, taskId: 'private-task' });
assert.notEqual(b.time.active.id, firstSession); assert.equal(b.time.active.participationId, firstParticipation);
pass('RF04 personal pause excludes gap; Room Resume retains deadline; Finish/rejoin creates a new Session under one Participation');

const oldPresence = presence(b);
const oldController = controlled(b);
const oldInterval = openInterval(b);
const offlineIntent = finish(b);
const newDevice = randomUUID();
await sendTime(b, timeCommand(b, { type: 'claimControl', sessionId: b.time.active.id, controlVersion: b.time.active.controlVersion, deviceId: newDevice }));
b.deviceId = newDevice;
assert.equal(b.me.membership.deviceId, newDevice);
assert.equal(b.me.membership.controlVersion, b.time.active.controlVersion);
await sendRoom(b, command(b, { type: 'renewPresence', ...oldPresence }), 409);
await sendTime(b, timeCommand(b, { type: 'pause', ...oldController, intervalId: oldInterval.id }), 409);
const newerInterval = openInterval(b).id;
await sendTime(b, timeCommand(b, { type: 'offlineStop', originalCommand: offlineIntent, reportedEndAt: oldInterval.startAt, confirmPersonal: true }));
assert.equal(openInterval(b).id, newerInterval);
assert.equal(b.time.intervals.find(i => i.id === oldInterval.id).eligibility, 'personal');
assert.equal((await sendTime(b, offlineIntent)).replayed, true);
assert.equal(openInterval(b).id, newerInterval);
pass('RF11/RF16 Time takeover synchronizes presence; stale controller rejected; old offline intent cannot stop newer interval');

const retainedSession = b.time.active.id;
await ageSyntheticRoomLease(a.userId, room, b.userId);
assert.equal((await request(b, `rooms/${room}/snapshot`)).status, 403);
await load(b, room);
assert.equal(b.me.membership.status, 'expired'); assert.equal(b.time.active.id, retainedSession);
await sendTime(b, timeCommand(b, { type: 'pause', ...controlled(b), intervalId: openInterval(b).id }));
assert.equal((await sendTime(b, timeCommand(b, { type: 'resume', ...controlled(b) }), 409)).error.code, 'REJOIN_REQUIRED');
await sendRoom(b, join(b, room));
assert.equal(b.time.active.id, retainedSession); assert.equal(b.time.active.status, 'paused');
await sendTime(b, timeCommand(b, { type: 'resume', ...controlled(b) }));
assert.equal(b.time.active.roomDeadlineAt, deadline);
assert.deepEqual((await request(b, 'learning')).body.data.state, learningBefore);
pass('RF18/RF19 expired seat denies roster but preserves accepted Session; explicit rejoin reuses it and never completes learning');

const bMember = b.me.membership.id;
await load(a);
await sendRoom(a, command(a, { type: 'remove', ...presence(a), targetMembershipId: bMember, reason: 'disruptive' }));
assert.equal((await request(b, `rooms/${room}/snapshot`)).status, 403);
await load(b, room);
assert.equal(b.time.active, null); assert.equal(b.me.requestedAccess.reason, 'REMOVED_FOR_RUN');
await sendRoom(b, join(b, room), 403);
await sendRoom(b, command(b, { type: 'switchToSolo', ...presence(b), ...moveIntent(b), solo }));
assert.equal(b.time.active.mode, 'solo');
await sendTime(b, finish(b));
await sendRoom(b, join(b, room), 403);
pass('RF12 Remove revokes private reads and truncates own time; Start solo works without erasing same-run restriction');

const cMember = c.me.membership.id;
await sendRoom(a, command(a, { type: 'ban', roomId: room, targetMembershipId: cMember, reason: 'spam' }));
await loadMe(c, room); assert.equal(c.me.requestedAccess.state, 'banned');
const ban = (await snapshot(a)).bans.find(item => item.membershipId === cMember);
await sendRoom(a, command(a, { type: 'unban', roomId: room, banId: ban.id }));
await loadMe(c); await sendRoom(c, join(c, room));
await sendRoom(d, join(d, room));
await ageSyntheticRoomLease(a.userId, room, a.userId, 121);
await loadMe(c); await loadMe(d);
const hostRace = await Promise.all([request(c, 'rooms', 'POST', command(c, { type: 'claimHost', ...presence(c) })), request(d, 'rooms', 'POST', command(d, { type: 'claimHost', ...presence(d) }))]);
assert.deepEqual(hostRace.map(item => item.status).sort(), [200, 409]);
const host = hostRace[0].status === 200 ? c : d;
const receiver = host === c ? d : c;
await loadMe(host); await loadMe(receiver);
await loadMe(a); await sendRoom(a, command(a, { type: 'renewPresence', ...presence(a) }));
assert.equal(a.me.membership.isHost, false);
const hostState = await snapshot(host);
await sendRoom(host, command(host, { type: 'offerHost', ...presence(host), targetMembershipId: receiver.me.membership.id, roomVersion: hostState.room.version }));
const offer = (await snapshot(receiver)).transferOffer;
assert.ok(offer); assert.equal(receiver.me.membership.isHost, false);
await sendRoom(receiver, command(receiver, { type: 'block', roomId: room, targetMembershipId: host.me.membership.id }));
await sendRoom(receiver, command(receiver, { type: 'acceptHost', ...presence(receiver), offerId: offer.id }), 409);
const ownBlock = (await snapshot(receiver)).ownBlocks[0];
await sendRoom(receiver, command(receiver, { type: 'unblock', roomId: room, blockId: ownBlock.id }));
await sendRoom(receiver, command(receiver, { type: 'acceptHost', ...presence(receiver), offerId: offer.id }));
assert.equal(receiver.me.membership.isHost, true); assert.equal(receiver.me.membership.isOwner, false);
pass('RF07 ban/unban and one-winner host claim; returning old host cannot steal role; transfer requires acceptance and respects Block');

await load(a);
const sourceRun = (await snapshot(a)).room.run;
await sendRoom(a, command(a, { type: 'leave', ...presence(a), ...moveIntent(a) }));
assert.equal((await request(null, `rooms/${room}`)).body.data.run.id, sourceRun.id);
await loadMe(a, room); assert.equal(a.me.requestedAccess.canEdit, true);
const currentPublic = (await request(null, `rooms/${room}`)).body.data;
await sendRoom(a, command(a, { type: 'edit', roomId: room, roomVersion: currentPublic.version, title: currentPublic.title, description: currentPublic.description, language: 'en', topic: 'Next preset', offeringId: null, presetId: 'deep' }));
const edited = (await request(null, `rooms/${room}`)).body.data;
assert.equal(edited.run.presetId, 'classic'); assert.equal(edited.configuredPreset, 'deep');
assert.equal(edited.run.plannedEndAt, sourceRun.plannedEndAt);
pass('RF08 host departure preserves finite Run; owner can manage without seat; preset edits affect only next Run');

await sendRoom(c, command(c, { type: 'block', roomId: room, targetMembershipId: d.me.membership.id }));
const cView = await snapshot(c); const dView = await snapshot(d);
assert.ok(!cView.participants.some(p => p.membershipId === d.me.membership.id));
assert.ok(!dView.participants.some(p => p.membershipId === c.me.membership.id));
assert.equal(cView.room.reservedCount, dView.room.reservedCount);
await sendRoom(c, command(c, { type: 'report', roomId: room, targetMembershipId: d.me.membership.id, reason: 'privacy', details: 'Synthetic review only' }));
assert.equal((await request(c, 'rooms/reports')).status, 403);
const reports = await request(d, 'rooms/reports'); assert.equal(reports.status, 200);
const report = reports.body.data.reports.find(item => item.roomId === room);
assert.ok(report); assert.equal('reporterId' in report, false);
await sendRoom(d, command(d, { type: 'reviewReport', reportId: report.id }));
pass('SC03 Block filters both private rosters without evicting seats; reports are private to protected moderators');

// A fresh room isolates phase/deadline fixtures from prior ledger history.
const boundaryOwner = await createActor('boundary-owner');
const boundaryMember = await createActor('boundary-member');
const boundaryRoom = (await sendRoom(boundaryOwner, create(boundaryOwner))).receipt.roomId;
await sendRoom(boundaryMember, join(boundaryMember, boundaryRoom));
await startRun(boundaryOwner); await joinRound(boundaryMember);
await sendTime(boundaryMember, timeCommand(boundaryMember, { type: 'pause', ...controlled(boundaryMember), intervalId: openInterval(boundaryMember).id }));
await ageSyntheticRoomRun(boundaryOwner.userId, boundaryRoom, 1501);
await load(boundaryMember);
assert.equal(boundaryMember.time.active, null);
assert.equal((await snapshot(boundaryMember)).room.phase.kind, 'shortBreak');
const pausedSession = boundaryMember.time.sessions.find(s => s.mode === 'room');
assert.equal(pausedSession.finalizedAt, pausedSession.roomDeadlineAt);
const brokenJoin = command(boundaryMember, { type: 'joinRound', ...presence(boundaryMember), runId: (await snapshot(boundaryMember)).room.run.id, roundIndex: 1, expectedTimeRevision: boundaryMember.time.revision, category: 'work', enrollmentId: null, taskId: null });
await sendRoom(boundaryMember, brokenJoin, 409);
await sendRoom(boundaryMember, command(boundaryMember, { type: 'react', ...presence(boundaryMember), reaction: 'wave' }));
await sendRoom(boundaryMember, command(boundaryMember, { type: 'react', ...presence(boundaryMember), reaction: 'wellDone' }), 429);
await ageSyntheticRoomRun(boundaryOwner.userId, boundaryRoom, 300);
await load(boundaryMember);
assert.equal(boundaryMember.time.active, null);
assert.equal((await snapshot(boundaryMember)).room.phase.roundIndex, 2);
await joinRound(boundaryMember);
assert.equal(boundaryMember.time.active.roundIndex, 2);
pass('RF05/RF06/RF10 paused session settles at fixed boundary without Cron; break earns no time, reactions bounded, next round explicit');

const beforeBadSwitch = boundaryMember.time.active.id;
await sendRoom(boundaryMember, command(boundaryMember, { type: 'switchToSolo', ...presence(boundaryMember), ...moveIntent(boundaryMember), solo: { ...solo, enrollmentId: randomUUID() } }), 422);
await load(boundaryMember); assert.equal(boundaryMember.time.active.id, beforeBadSwitch); assert.equal(boundaryMember.me.membership.status, 'active');
await sendRoom(boundaryMember, command(boundaryMember, { type: 'switchToSolo', ...presence(boundaryMember), ...moveIntent(boundaryMember), solo }));
await loadTime(boundaryMember); // Control replies stay compact; history is requested explicitly.
const oldRoomSession = boundaryMember.time.sessions.find(s => s.id === beforeBadSwitch);
assert.equal(oldRoomSession.finalizedAt, boundaryMember.time.active.createdAt);
assert.equal(boundaryMember.me.membership.status, 'left'); assert.equal(boundaryMember.time.active.mode, 'solo');
const soloSession = boundaryMember.time.active.id;
await sendRoom(boundaryMember, command(boundaryMember, { type: 'leave', ...presence(boundaryMember), ...moveIntent(boundaryMember) }), 409);
await loadTime(boundaryMember); assert.equal(boundaryMember.time.active.id, soloSession);
await sendRoom(boundaryMember, command(boundaryMember, { type: 'switchToRoom', roomId: boundaryRoom, fromRoomId: null, presenceControlVersion: null, deviceId: boundaryMember.deviceId, ...moveIntent(boundaryMember), ...consent }));
assert.equal(boundaryMember.time.active, null); assert.equal(boundaryMember.me.membership.status, 'active');
assert.equal(boundaryMember.time.sessions.find(s => s.id === soloSession).status, 'finalized');
pass('RF21 invalid replacement preserves original state; Room↔Solo switch commits one shared cutoff and explicit Watching');

const closedMeta = (await request(null, `rooms/${boundaryRoom}`)).body.data;
await sendRoom(boundaryOwner, command(boundaryOwner, { type: 'close', roomId: boundaryRoom, roomVersion: closedMeta.version }));
assert.equal((await request(null, `rooms/${boundaryRoom}`)).body.data.status, 'closed');
await sendRoom(b, join(b, boundaryRoom), 403);
await ageSyntheticRoomRun(boundaryOwner.userId, boundaryRoom, 6000);
await load(boundaryMember, boundaryRoom);
assert.equal(boundaryMember.me.membership.status, 'left'); assert.equal(boundaryMember.me.requestedAccess.canRejoin, false);
const closedDone = (await request(null, `rooms/${boundaryRoom}`)).body.data;
assert.equal(closedDone.run.status, 'completed'); assert.equal(closedDone.phase.kind, 'completed');
assert.equal((await request(boundaryMember, `rooms/${boundaryRoom}/snapshot`)).status, 403);
pass('RF17/RF22 owner Close blocks new joins, permits current finite Run, then ends memberships without reopening');

// Full capacity uses only real admissions, then races the final seat.
const capacityOwner = await createActor('capacity-owner');
const capacityRoom = (await sendRoom(capacityOwner, create(capacityOwner))).receipt.roomId;
const candidates = [];
for (let offset = 0; offset < 20; offset += 4) candidates.push(...await Promise.all(Array.from({ length: 4 }, (_, index) => createActor(`seat-${offset + index}`))));
for (const actor of candidates.slice(0, 18)) await sendRoom(actor, join(actor, capacityRoom));
const finalSeat = await Promise.all(candidates.slice(18).map(actor => request(actor, 'rooms', 'POST', join(actor, capacityRoom))));
assert.deepEqual(finalSeat.map(item => item.status).sort(), [200, 409]);
assert.equal((await request(null, `rooms/${capacityRoom}`)).body.data.reservedCount, 20);
const occupant = candidates[18 + finalSeat.findIndex(item => item.status === 200)];
const waiting = candidates[18 + finalSeat.findIndex(item => item.status !== 200)];
await load(occupant); await load(waiting);
await startRun(capacityOwner); await joinRound(occupant);
const occupiedTime = occupant.time.active.id;
await ageSyntheticRoomLease(capacityOwner.userId, capacityRoom, occupant.userId);
assert.equal((await request(occupant, `rooms/${capacityRoom}/snapshot`)).status, 403);
await sendRoom(waiting, join(waiting, capacityRoom));
await load(occupant, capacityRoom);
assert.equal(occupant.time.active.id, occupiedTime);
assert.equal((await sendRoom(occupant, join(occupant, capacityRoom), 409)).error.code, 'ROOM_FULL');
assert.equal((await request(occupant, `rooms/${capacityRoom}/snapshot`)).status, 403);
await sendRoom(occupant, command(occupant, { type: 'switchToSolo', ...presence(occupant), ...moveIntent(occupant), solo }));
assert.equal(occupant.time.active.mode, 'solo'); assert.equal(occupant.me.membership.status, 'expired');
pass('RF14/RF19/RF20 one final seat winner; expired seat reused safely, denied rejoin has no roster, private atomic Solo exit remains available');

// Fresh receipts never retain a roster, and realtime credentials cannot become user credentials.
const credentials = await request(waiting, `rooms/${capacityRoom}/realtime`, 'POST', {});
assert.equal(credentials.status, 200, JSON.stringify(credentials.body.error));
const scoped = { token: credentials.body.data.token };
const claims = JSON.parse(Buffer.from(scoped.token.split('.')[1], 'base64url').toString());
assert.equal(claims.role, 'anon'); assert.equal(claims.aud, 'realtime'); assert.equal('sub' in claims, false);
assert.equal(claims.dima_room_id, capacityRoom);
assert.equal((await request(scoped, 'me')).status, 401);
assert.ok([401, 403].includes((await rest('room_memberships?limit=1', 'GET', undefined, scoped)).status));
const receipts = (await rest(`room_operations?user_id=eq.${waiting.userId}&select=receipt`)).data;
assert.ok(receipts.every(row => !JSON.stringify(row.receipt).includes('participants') && !JSON.stringify(row.receipt).includes('displayName')));
await joinRound(waiting);
const suspendedSession = waiting.time.active.id;
await loadMe(d);
await sendRoom(d, command(d, { type: 'suspendRoom', roomId: capacityRoom, reason: 'privacy' }));
assert.equal((await request(waiting, `rooms/${capacityRoom}/snapshot`)).status, 403);
assert.equal((await request(waiting, `rooms/${capacityRoom}/realtime`, 'POST', {})).status, 403);
const suspended = (await request(null, `rooms/${capacityRoom}`)).body.data;
assert.equal(suspended.status, 'suspended'); assert.equal(suspended.run.status, 'cancelled');
await loadTime(waiting);
const preserved = waiting.time.sessions.find(session => session.id === suspendedSession);
assert.equal(preserved.status, 'finalized');
assert.equal(preserved.finalizedAt, suspended.run.cancelledAt);
assert.ok(waiting.time.intervals.filter(interval => interval.sessionId === suspendedSession).every(interval => interval.eligibility === 'eligible' && interval.endAt === suspended.run.cancelledAt));
pass('RF12/RF15 scoped no-sub realtime credential cannot access account data; suspension revokes membership and cancels Run; receipts contain no roster');

const hints = await rpc('claim_room_hints', { p_limit: 1, p_rooms: [capacityRoom] });
for (const hint of hints) {
  assert.deepEqual(Object.keys(hint.hint).sort(), ['count', 'phase', 'version']);
  assert.deepEqual(Object.keys(hint.hint.count).sort(), ['connected', 'reserved']);
  await rpc('ack_room_hint', { p_room: hint.roomId, p_claim: hint.claimToken, p_version: hint.version });
  await rpc('ack_room_hint', { p_room: hint.roomId, p_claim: hint.claimToken, p_version: hint.version });
}
assert.equal((await rest(`room_memberships?room_id=eq.${capacityRoom}&status=eq.active&select=id`)).data.length, 0);
pass('Durable room hint payload is version/phase/count only and duplicate acknowledgement is harmless');

// Administrative suspension must not launder an earlier Open cap into eligible credit.
const capped = await createActor('capped-open');
await sendRoom(capped, join(capped, room));
await sendRoom(capped, command(capped, { type: 'leave', ...presence(capped), ...moveIntent(capped) }));
await sendTime(capped, timeCommand(capped, { type: 'start', deviceId: capped.deviceId, ...solo, mode: 'open', settings: null, previousSessionId: null }));
await ageSyntheticOpenSession(capped.userId, capped.time.active.id, 14401);
await loadMe(d);
await sendRoom(d, command(d, { type: 'suspendAccount', roomId: room, targetMembershipId: capped.me.membership.id, reason: 'privacy' }));
await loadTime(capped);
assert.equal(capped.time.active.status, 'needsReview');
assert.equal(capped.time.totals.eligibleSeconds, 0);
assert.equal(capped.time.intervals[0].eligibility, 'pending');
pass('Moderation after an earlier four-hour Open cap preserves NeedsReview and pending eligibility');

const archiveOwner = await createActor('archive-owner');
const archiveRoom = (await sendRoom(archiveOwner, create(archiveOwner))).receipt.roomId;
await startRun(archiveOwner);
await ageSyntheticRoomActivity(archiveOwner.userId, archiveRoom);
assert.equal((await request(null, `rooms/${archiveRoom}`)).body.data.status, 'open');
await setSyntheticRoomArchiveAge(archiveOwner.userId, archiveRoom, 7 * 86400 + 3600);
const recentEnd = (await request(null, `rooms/${archiveRoom}`)).body.data;
assert.equal(recentEnd.status, 'open', 'Completed-by-clock Run end is newer than seven days even when Cron never settled it');
await setSyntheticRoomArchiveAge(archiveOwner.userId, archiveRoom, 8 * 86400);
assert.equal((await request(null, `rooms/${archiveRoom}`)).body.data.status, 'archived');
assert.ok(!(await request(null, 'rooms')).body.data.rooms.some(item => item.id === archiveRoom));
await loadMe(b); await sendRoom(b, join(b, archiveRoom), 403);
pass('RF20/RF22 effective archive age uses Run end, never cuts an active Run, and works before lifecycle jobs');

// New semantic relationships are enforced below the service, too.
const anyParticipation = (await rest(`round_participations?room_id=eq.${room}&select=*&limit=1`)).data[0];
const sourceSession = (await rest(`time_sessions?participation_id=eq.${anyParticipation.id}&select=*&limit=1`)).data[0];
const invalidSession = { ...sourceSession, id: randomUUID(), room_id: boundaryRoom, status: 'finalized' };
assert.equal((await rest('time_sessions', 'POST', invalidSession)).status, 409);
assert.equal((await rest('time_sessions', 'POST', { ...sourceSession, id: randomUUID(), room_deadline_at: null, status: 'finalized' })).status, 400);
assert.equal((await rest('room_access_cutoffs', 'POST', { room_id: boundaryRoom, membership_id: boundaryOwner.me.membership.id, run_id: anyParticipation.run_id, effective_at: new Date().toISOString(), reason: 'synthetic-invalid' })).status, 409);
pass('Database rejects cross-room Participation/cutoff linkage and Room Session without a deadline');

// FK lock compatibility is exercised while the real B1 profile transaction still holds its Account.
const profileRace = await createActor('profile-race');
await duringSyntheticProfileSave(profileRace.userId, () => rpc('rooms_queue_account', { p_actor: profileRace.userId, p_now: new Date().toISOString() }));
const accountClaim = await claimTargetJob('account', profileRace.userId);
assert.ok(accountClaim);
await rest(`room_account_jobs?user_id=eq.${profileRace.userId}`, 'PATCH', { lease_until: new Date(Date.now() - 1000).toISOString() });
const replacementClaim = await claimTargetJob('account', profileRace.userId);
assert.ok(replacementClaim); assert.notEqual(replacementClaim.claimToken, accountClaim.claimToken);
assert.equal((await rpc('execute_room_account_job', { p_actor: profileRace.userId, p_claim: accountClaim.claimToken })).status, 'stale');
assert.equal((await rpc('execute_room_account_job', { p_actor: profileRace.userId, p_claim: replacementClaim.claimToken })).status, 'done');
assert.equal((await rpc('execute_room_account_job', { p_actor: profileRace.userId, p_claim: replacementClaim.claimToken })).status, 'stale');
pass('Account-cutoff job enqueue does not deadlock B1 profile save; crashed lease reclaims and stale/replayed execution has no duplicate effect');

const archiveClaim = await claimTargetJob('room', archiveRoom);
assert.ok(archiveClaim);
await rest(`room_jobs?room_id=eq.${archiveRoom}`, 'PATCH', { lease_until: new Date(Date.now() - 1000).toISOString() });
const replacementLifecycle = await claimTargetJob('room', archiveRoom);
assert.ok(replacementLifecycle);
assert.equal((await rpc('execute_room_job', { p_room: archiveRoom, p_claim: archiveClaim.claimToken })).status, 'stale');
assert.equal((await rpc('execute_room_job', { p_room: archiveRoom, p_claim: replacementLifecycle.claimToken })).status, 'done');
const afterArchiveVersion = (await request(null, `rooms/${archiveRoom}`)).body.data.version;
await rpc('execute_room_job', { p_room: archiveRoom, p_claim: replacementLifecycle.claimToken });
assert.equal((await request(null, `rooms/${archiveRoom}`)).body.data.version, afterArchiveVersion);
pass('Lifecycle lease crash/replay archives once and preserves the already completed fixed Run');

await rest(`room_outbox?room_id=eq.${room}`, 'PATCH', { pending: true, attempts: 0, next_run_at: new Date().toISOString(), lease_until: null, claim_token: null });
const hintA = (await rpc('claim_room_hints', { p_limit: 1, p_rooms: [room] }))[0];
assert.ok(hintA);
await rest(`room_outbox?room_id=eq.${room}`, 'PATCH', { lease_until: new Date(Date.now() - 1000).toISOString() });
const hintB = (await rpc('claim_room_hints', { p_limit: 1, p_rooms: [room] }))[0];
assert.ok(hintB); assert.notEqual(hintA.claimToken, hintB.claimToken);
await rpc('ack_room_hint', { p_room: room, p_claim: hintA.claimToken, p_version: hintA.version });
assert.equal((await rest(`room_outbox?room_id=eq.${room}&select=claim_token`)).data[0].claim_token, hintB.claimToken);
await loadMe(a);
const latestMeta = (await request(null, `rooms/${room}`)).body.data;
await rpc('execute_room_command', { p_actor: a.userId, p_command: command(a, { type: 'edit', roomId: room, roomVersion: latestMeta.version, title: 'Latest synthetic hint', description: latestMeta.description, language: latestMeta.language, topic: latestMeta.topic, offeringId: null, presetId: latestMeta.configuredPreset }) });
await rpc('ack_room_hint', { p_room: room, p_claim: hintB.claimToken, p_version: hintB.version });
const pendingHint = (await rest(`room_outbox?room_id=eq.${room}&select=pending,version`)).data[0];
assert.equal(pendingHint.pending, true); assert.ok(pendingHint.version > hintB.version);
const hintC = (await rpc('claim_room_hints', { p_limit: 1, p_rooms: [room] }))[0];
await rpc('ack_room_hint', { p_room: room, p_claim: hintC.claimToken, p_version: hintC.version });
assert.equal((await rest(`room_outbox?room_id=eq.${room}&select=pending`)).data[0].pending, false);
pass('Coalesced durable outbox survives a crashed delivery, rejects stale ack and preserves a newer version during publication');

const evidencePath = resolve(`docs/evidence/B5_ROOMS_API_${runId}.json`);
const temporary = `${evidencePath}.tmp`;
const descriptor = openSync(temporary, 'wx', 0o600);
try {
  writeFileSync(descriptor, JSON.stringify({ runId, checkedAt: new Date().toISOString(), base, results, credentialsPrinted: false }, null, 2) + '\n');
  fsyncSync(descriptor);
} finally { closeSync(descriptor); }
// Keep earlier run evidence intact, including if a write is interrupted.
linkSync(temporary, evidencePath); unlinkSync(temporary);
console.log(JSON.stringify({ passed: results.length, failed: 0, credentialsPrinted: false, evidencePath }));
