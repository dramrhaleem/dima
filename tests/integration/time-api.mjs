import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readEnv, clientEnvPath, runtimeRoot } from '../../scripts/local-backend/env.mjs';
import { ageSyntheticTimeSession, expireSyntheticTimeJobLease } from '../helpers/time-fixture.mjs';

const base = process.env.DIMA_TEST_API ?? 'http://127.0.0.1:8787';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const env = readEnv(clientEnvPath);
assert.equal(env.SUPABASE_URL, 'http://127.0.0.1:54321');
const admin = readEnv(resolve(runtimeRoot, 'server.env')).SUPABASE_SERVICE_ROLE_KEY;
const dispatchToken = readEnv(resolve('.local/worker-preview.env')).DIMA_JOBS_TOKEN;
assert.ok(admin && dispatchToken, 'Local service and dispatcher test credentials are configured');
const results = [];
const pass = name => results.push({ name, status: 'passed' });
const runId = randomUUID();
const settings = { focusMinutes: 5, shortBreakMinutes: 1, longBreakMinutes: 5, longBreakAfter: 4 };
const rest = async (path, method = 'GET', body, token = admin, key = admin) => {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method, headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000),
  });
  const data = response.status === 204 ? null : await response.json();
  return { status: response.status, data };
};
const rpc = async (name, body = {}) => {
  const response = await rest(`rpc/${name}`, 'POST', body);
  assert.equal(response.status, 200, `RPC ${name} failed: ${JSON.stringify(response.data)}`);
  return response.data;
};
async function request(actor, path = 'time', method = 'GET', body, extra = {}) {
  return fetch(`${base}/api/v1/${path}`, {
    method, headers: { ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}), 'Content-Type': 'application/json', ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
  });
}
async function load(actor) {
  const response = await request(actor);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  actor.state = (await response.json()).data;
  return actor.state;
}
async function createActor(tag) {
  const email = `b4-api-${runId}-${tag}@example.test`;
  const password = randomBytes(24).toString('base64url');
  const created = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: admin, Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }) });
  assert.equal(created.status, 200);
  const user = await created.json();
  const signIn = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(signIn.status, 200);
  const actor = { userId: user.id, token: (await signIn.json()).access_token, deviceId: randomUUID() };
  let response = await request(actor, 'me');
  assert.equal(response.status, 200);
  const profile = (await response.json()).data.profile;
  response = await request(actor, 'me', 'PATCH', { displayName: 'B4 synthetic', timezone: 'UTC', intent: 'work', appearance: 'light', reducedMotion: false, onboarded: true, expectedRevision: profile?.revision ?? 0, operationId: randomUUID() });
  assert.equal(response.status, 200);
  await load(actor);
  return actor;
}
const command = (actor, body) => ({ operationId: randomUUID(), expectedRevision: actor.state.revision, ...body });
async function send(actor, body, expectedStatus = 200) {
  const response = await request(actor, 'time', 'POST', body);
  const result = await response.json();
  assert.equal(response.status, expectedStatus, `${body.type}: ${JSON.stringify(result.error)}`);
  if (result.data) actor.state = result.data;
  return result;
}
// Earlier isolated runs may leave older due jobs; exercise the real queue without assuming first-page position.
async function claimTargetTimeJob(id) {
  const deadline = Date.now() + 60000;
  for (let batch = 0; batch < 100 && Date.now() < deadline; batch += 1) {
    const claims = await rpc('claim_time_jobs', { p_limit: 20 });
    const target = claims.find(item => item.id === id);
    for (const item of claims.filter(item => item.id !== id)) {
      await rpc('execute_time_job', { p_job: item.id, p_claim: item.claimToken });
    }
    if (target) return target;
    if (!claims.length) break;
  }
  assert.fail('Expected synthetic time job was not reached through the bounded normal queue');
}
const interval = actor => actor.state.intervals.find(i => i.sessionId === actor.state.active?.id && i.endAt === null);
const controlled = actor => ({ sessionId: actor.state.active.id, deviceId: actor.deviceId, controlVersion: actor.state.active.controlVersion });
const start = (actor, mode = 'open', previousSessionId = null) => command(actor, { type: 'start', deviceId: actor.deviceId, mode, category: 'work', title: 'Synthetic focus', enrollmentId: null, taskId: null, settings: mode === 'solo' ? settings : null, previousSessionId });
const finish = actor => command(actor, { type: 'finish', ...controlled(actor), intervalId: interval(actor)?.id ?? null });
const pause = actor => command(actor, { type: 'pause', ...controlled(actor), intervalId: interval(actor).id });
const a = await createActor('main');
const b = await createActor('other');
let response = await request(null);
assert.equal(response.status, 401);
pass('Private time rejects missing identity');
const learningBefore = await (await request(a, 'learning')).json();
const firstCommand = start(a);
const startCommands = [firstCommand, { ...firstCommand, operationId: randomUUID(), deviceId: randomUUID() }];
const race = await Promise.all(startCommands.map(body => request(a, 'time', 'POST', body)));
assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
const raceResults = await Promise.all(race.map(r => r.json()));
assert.equal(raceResults.find(r => r.error)?.error.code, 'ACTIVE_SESSION');
a.state = raceResults.find(r => !r.error).data;
a.deviceId = a.state.active.deviceId;
const winningCommand = startCommands[race.findIndex(response => response.status === 200)];
{
  const replay = await send(a, winningCommand);
  assert.equal(replay.replayed, true);
  await send(a, { ...winningCommand, title: 'Different retry' }, 409);
}
assert.equal((await rest(`time_sessions?user_id=eq.${a.userId}&status=in.(running,paused,needsReview)`)).data.length, 1);
pass('TM01 concurrent starts create exactly one active account session; conflict returns current session');
const firstInterval = interval(a);
const paused = await send(a, pause(a));
assert.equal(paused.data.active.status, 'paused');
assert.equal(paused.data.totals.eligibleSeconds, 0);
await send(a, start(a), 409);
await send(a, command(a, { type: 'resume', ...controlled(a) }));
assert.notEqual(interval(a).id, firstInterval.id);
pass('Paused session keeps account lock and pending credit; Resume opens a separate nonoverlapping interval');
const beforeTakeover = interval(a);
const oldControl = { ...controlled(a) };
const oldOfflineFinish = finish(a);
const deviceB = randomUUID();
await send(a, command(a, { type: 'claimControl', sessionId: a.state.active.id, controlVersion: a.state.active.controlVersion, deviceId: deviceB }));
a.deviceId = deviceB;
assert.equal(interval(a).boundaryAt, beforeTakeover.boundaryAt);
assert.equal(a.state.intervals.find(i => i.id === beforeTakeover.id).endAt, interval(a).startAt);
const stalePause = await send(a, command(a, { type: 'pause', ...oldControl, intervalId: beforeTakeover.id }), 409);
assert.equal(stalePause.error.code, 'CONTROL_LOST');
pass('TM06 takeover partitions periods without resetting cap; old controller cannot pause new period');
const newIntervalId = interval(a).id;
const oldReportedEnd = beforeTakeover.startAt;
await send(a, command(a, { type: 'offlineStop', originalCommand: oldOfflineFinish, reportedEndAt: oldReportedEnd, confirmPersonal: true }));
assert.equal(a.state.active.status, 'running');
assert.equal(interval(a).id, newIntervalId);
assert.equal(a.state.intervals.find(i => i.id === beforeTakeover.id).eligibility, 'personal');
assert.equal(a.state.intervals.find(i => i.id === firstInterval.id).eligibility, 'eligible');
const tombstoneReplay = await send(a, oldOfflineFinish);
assert.equal(tombstoneReplay.replayed, true);
assert.equal(interval(a).id, newIntervalId);
pass('TM05 offline correction touches only original period, preserves earlier valid time and newer device work; late original request is tombstoned');
const stop = finish(a);
const stopped = await send(a, stop);
assert.equal(a.state.active, null);
response = await request(a, 'time/receipts', 'POST', { command: stop });
assert.equal(response.status, 200);
const known = await response.json();
assert.deepEqual(known.receipt, stopped.receipt);
assert.equal(known.replayed, true);
await send(a, command(a, { type: 'offlineStop', originalCommand: stop, reportedEndAt: a.state.intervals.find(i => i.id === stop.intervalId).startAt, confirmPersonal: true }));
assert.equal(a.state.corrections.length, stopped.data.corrections.length);
pass('TM04 lost-response receipt recovers original immutable result before correction classification');

const stopRace = await createActor('stop-race');
await send(stopRace, start(stopRace));
const racingOriginal = finish(stopRace);
const racingCorrection = command(stopRace, { type: 'offlineStop', originalCommand: racingOriginal, reportedEndAt: interval(stopRace).startAt, confirmPersonal: true });
const stopResponses = await Promise.all([request(stopRace, 'time', 'POST', racingCorrection), request(stopRace, 'time', 'POST', racingOriginal)]);
assert.deepEqual(stopResponses.map(r => r.status), [200, 200]);
await load(stopRace);
assert.equal(stopRace.state.active, null);
assert.ok(stopRace.state.corrections.length <= 1);
if (stopRace.state.corrections.length) assert.equal(stopRace.state.totals.eligibleSeconds, 0);
pass('Atomic original Stop/reconciliation race chooses one outcome with no late eligible credit');
await send(a, { ...stop, operationId: randomUUID(), expectedRevision: a.state.revision }, 409);
response = await request(a, 'time/receipts', 'POST', { command: { ...stop, operationId: randomUUID() } });
assert.equal(response.status, 404);
const current = await load(a);
const manualEnd = new Date(Date.now() - 3600_000).toISOString();
const manualStart = new Date(Date.parse(manualEnd) - 1800_000).toISOString();
const manual = command(a, { type: 'manual', category: 'work', title: 'Manual personal work', startAt: manualStart, endAt: manualEnd });
await send(a, manual);
await send(a, command(a, { type: 'manual', category: 'work', title: 'Overlap', startAt: new Date(Date.parse(manualStart) + 60_000).toISOString(), endAt: manualEnd }), 409);
const adjacent = command(a, { type: 'manual', category: 'learning', title: 'Adjacent', startAt: new Date(Date.parse(manualStart) - 1800_000).toISOString(), endAt: manualStart });
await send(a, adjacent);
assert.ok(a.state.totals.personalSeconds >= 3600);
response = await request(a, 'time?limit=50');
assert.equal(response.status, 200);
const fullHistory = (await response.json()).data;
assert.equal(fullHistory.intervals.filter(i => i.source === 'manual').length, 2);
assert.ok(fullHistory.intervals.filter(i => i.source === 'manual').every(i => i.eligibility === 'personal'));
response = await request(a, 'time?limit=1');
const compactControl = (await response.json()).data;
assert.ok(compactControl.sessions.length <= 2);
assert.equal(compactControl.totals.personalSeconds, fullHistory.totals.personalSeconds);
assert.equal(compactControl.totals.eligibleSeconds, fullHistory.totals.eligibleSeconds);
assert.equal(a.state.sessions.length, 1, 'Manual command returns its affected session only when no session is active');
await send(a, command(a, { type: 'manual', category: 'work', title: 'Timer overlap', startAt: firstInterval.startAt, endAt: stopped.receipt.acceptedAt }), 409);
pass('TM07 manual work remains personal; timer/manual and manual/manual overlap rejected, adjacent periods accepted');
assert.ok(a.state.revision > current.revision);
const learningAfter = await (await request(a, 'learning')).json();
assert.deepEqual(learningAfter.data.state, learningBefore.data.state);
pass('AC02 Work needs no course; all timer/manual commands leave learning completion and effort unchanged');
let other = await request(b, 'time', 'POST', command(b, { type: 'correctInterval', sessionId: stop.sessionId, intervalId: firstInterval.id, reportedEndAt: firstInterval.startAt, confirmPersonal: true }));
assert.equal(other.status, 404);
response = await request(a, `time?sessionId=${stop.sessionId}`);
assert.equal(response.status, 200);
assert.ok((await response.json()).data.intervals.some(i => i.id === firstInterval.id));
response = await request(a, 'time?limit=1');
assert.equal(response.status, 200);
const page = (await response.json()).data;
assert.ok(page.nextCursor);
response = await request(a, `time?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`);
assert.equal(response.status, 200);
assert.notEqual((await response.json()).data.sessions[0].id, page.sessions[0].id);
response = await request(a, 'time', 'POST', start(a), { 'X-Dima-Account-Id': b.userId });
assert.equal(response.status, 409);
response = await request(a, 'time', 'POST', start(a), { Origin: 'https://foreign.example' });
assert.equal(response.status, 403);
pass('Owner-only history/detail, stable cursor, account-switch and Origin protections');
const isolated = await rest(`time_sessions?user_id=eq.${a.userId}`, 'GET', undefined, b.token, env.SUPABASE_ANON_KEY);
assert.equal(isolated.status, 200);
assert.deepEqual(isolated.data, []);
for (const name of ['execute_time_command', 'claim_time_jobs', 'time_bump']) {
  const denied = await rest(`rpc/${name}`, 'POST', name === 'execute_time_command' ? { p_actor: a.userId, p_command: start(a) } : name === 'time_bump' ? { p_actor: a.userId, p_key: 'forged', p_type: 'forged' } : { p_limit: 1 }, a.token, env.SUPABASE_ANON_KEY);
  assert.ok([401, 403].includes(denied.status));
}
const deniedInsert = await rest('time_accounts', 'POST', { user_id: a.userId, revision: 999 }, a.token, env.SUPABASE_ANON_KEY);
assert.ok([401, 403].includes(deniedInsert.status));
pass('RLS isolates account reads and direct authenticated table/RPC mutations are denied');
const invalidJob = await rest('time_jobs', 'POST', { user_id: b.userId, dedupe_key: randomUUID(), interval_id: firstInterval.id, boundary_at: firstInterval.boundaryAt, next_run_at: firstInterval.boundaryAt });
assert.equal(invalidJob.status, 409);
assert.equal(invalidJob.data.code, '23503');
const invalidCorrection = await rest('time_corrections', 'POST', { user_id: b.userId, session_id: stop.sessionId, interval_id: firstInterval.id, previous_end_at: firstInterval.startAt, reported_end_at: firstInterval.startAt, reason: 'manual-correction', created_at: new Date().toISOString() });
assert.equal(invalidCorrection.status, 409);
assert.equal(invalidCorrection.data.code, '23503');
pass('Composite database constraints reject cross-account job and correction references even through service-level writes');

// Each aged boundary fixture uses a fresh account; no existing fixtures or real user data reset.
const solo = await createActor('solo');
await send(solo, start(solo, 'solo'));
const soloId = solo.state.active.id;
const agedSolo = await ageSyntheticTimeSession(solo.userId, soloId, 301);
await load(solo);
assert.equal(solo.state.active, null);
const soloSession = solo.state.sessions.find(s => s.id === soloId);
assert.equal(Date.parse(soloSession.finalizedAt), Date.parse(agedSolo.boundaryAt));
assert.equal(solo.state.totals.eligibleSeconds, 300);
assert.equal(solo.state.sessions.length, 1);
pass('TM02 sleeping Solo settles at stored boundary, with exactly one round and no break/following-round credit');
await send(solo, start(solo, 'solo', soloId));
assert.equal(solo.state.active.roundIndex, 2);
await send(solo, finish(solo));
await send(solo, start(solo, 'solo', soloId), 409);
pass('Next Solo round requires explicit Start and cannot branch twice from the same prior round');

const pausedSolo = await createActor('paused-solo');
await send(pausedSolo, start(pausedSolo, 'solo'));
await ageSyntheticTimeSession(pausedSolo.userId, pausedSolo.state.active.id, 10);
await load(pausedSolo);
const oldSoloBoundary = interval(pausedSolo).boundaryAt;
await send(pausedSolo, pause(pausedSolo));
const remaining = pausedSolo.state.active.remainingSeconds;
await send(pausedSolo, command(pausedSolo, { type: 'resume', ...controlled(pausedSolo) }));
assert.ok(Math.abs((Date.parse(interval(pausedSolo).boundaryAt) - Date.parse(interval(pausedSolo).startAt)) / 1000 - remaining) < 0.0011);
assert.ok(Date.parse(interval(pausedSolo).boundaryAt) >= Date.parse(oldSoloBoundary));
pass('Solo Pause/Resume preserves remaining accepted duration and records a new deadline');

const oldDeadline = await createActor('old-deadline');
await send(oldDeadline, start(oldDeadline, 'solo'));
await send(oldDeadline, pause(oldDeadline));
const agedPaused = await ageSyntheticTimeSession(oldDeadline.userId, oldDeadline.state.active.id, 400);
await load(oldDeadline);
await send(oldDeadline, command(oldDeadline, { type: 'resume', ...controlled(oldDeadline) }));
const resumedInterval = interval(oldDeadline).id;
const oldJob = (await rest(`time_jobs?user_id=eq.${oldDeadline.userId}&interval_id=eq.${agedPaused.intervalId}`)).data[0];
const oldClaim = await claimTargetTimeJob(oldJob.id);
await rpc('execute_time_job', { p_job: oldClaim.id, p_claim: oldClaim.claimToken });
await load(oldDeadline);
assert.equal(oldDeadline.state.active.status, 'running');
assert.equal(interval(oldDeadline).id, resumedInterval);
pass('An overdue original Solo boundary job cannot finalize a later resumed interval');

const cap = await createActor('cap');
await send(cap, start(cap));
const capId = cap.state.active.id;
const agedCap = await ageSyntheticTimeSession(cap.userId, capId, 14401);
await load(cap);
assert.equal(cap.state.active.status, 'needsReview');
assert.equal(cap.state.totals.eligibleSeconds, 0);
assert.equal(cap.state.totals.pendingSeconds, 14400);
await send(cap, start(cap), 409);
await send(cap, command(cap, { type: 'review', ...controlled(cap), acceptCap: true }));
assert.equal(cap.state.active, null);
assert.equal(cap.state.totals.eligibleSeconds, 14400);
assert.equal(Date.parse(cap.state.intervals[0].endAt), Date.parse(agedCap.boundaryAt));
pass('TM03 four-hour Open cap produces NeedsReview, blocks another session and requires explicit review');

for (const intent of ['finish', 'pause']) {
  const actor = await createActor(`cap-offline-${intent}`);
  await send(actor, start(actor));
  const original = intent === 'pause' ? pause(actor) : finish(actor);
  const aged = await ageSyntheticTimeSession(actor.userId, actor.state.active.id, 14401);
  await load(actor);
  const end = new Date(Date.parse(aged.startAt) + 12600_000).toISOString();
  await send(actor, command(actor, { type: 'offlineStop', originalCommand: original, reportedEndAt: end, confirmPersonal: true }));
  assert.equal(actor.state.active?.status ?? 'finalized', intent === 'pause' ? 'paused' : 'finalized');
  assert.equal(actor.state.totals.personalSeconds, 12600);
  assert.equal(actor.state.totals.eligibleSeconds, 0);
  const beforeLate = actor.state.revision;
  await send(actor, original);
  assert.equal(actor.state.revision, beforeLate);
}
pass('Capped early Offline Finish resolves review; Offline Pause preserves pause intent; delayed original cannot restore eligible time');

const takenCap = await createActor('taken-cap');
await send(takenCap, start(takenCap));
const pendingPause = pause(takenCap);
const agedTaken = await ageSyntheticTimeSession(takenCap.userId, takenCap.state.active.id, 14401);
await load(takenCap);
await send(takenCap, command(takenCap, { type: 'claimControl', sessionId: takenCap.state.active.id, deviceId: randomUUID(), controlVersion: takenCap.state.active.controlVersion }));
await send(takenCap, command(takenCap, { type: 'offlineStop', originalCommand: pendingPause, reportedEndAt: new Date(Date.parse(agedTaken.startAt) + 12000_000).toISOString(), confirmPersonal: true }));
assert.equal(takenCap.state.active.status, 'needsReview');
assert.equal(takenCap.state.active.controlVersion, 2);
pass('Old offline intent cannot change current control state after cap-review takeover');

const endedSolo = await createActor('boundary-intent');
await send(endedSolo, start(endedSolo, 'solo'));
const endedOriginal = finish(endedSolo);
const agedEnded = await ageSyntheticTimeSession(endedSolo.userId, endedSolo.state.active.id, 301);
await load(endedSolo);
await send(endedSolo, command(endedSolo, { type: 'offlineStop', originalCommand: endedOriginal, reportedEndAt: agedEnded.boundaryAt, confirmPersonal: true }));
assert.equal(endedSolo.state.totals.eligibleSeconds, 300);
assert.equal(endedSolo.state.corrections.length, 0);
pass('Offline intent at stored Solo boundary retains valid planned-boundary eligibility');

const jobsActor = await createActor('jobs');
await send(jobsActor, start(jobsActor, 'solo'));
const agedJob = await ageSyntheticTimeSession(jobsActor.userId, jobsActor.state.active.id, 301);
const ownJob = (await rest(`time_jobs?user_id=eq.${jobsActor.userId}&interval_id=eq.${agedJob.intervalId}`)).data[0];
const claim = await claimTargetTimeJob(ownJob.id);
await expireSyntheticTimeJobLease(jobsActor.userId, ownJob.id);
const recovered = await claimTargetTimeJob(ownJob.id);
assert.notEqual(recovered.claimToken, claim.claimToken);
assert.equal((await rpc('execute_time_job', { p_job: ownJob.id, p_claim: claim.claimToken })).status, 'stale');
const run = await rpc('execute_time_job', { p_job: ownJob.id, p_claim: recovered.claimToken });
assert.equal(run.status, 'done');
const repeated = await rpc('execute_time_job', { p_job: ownJob.id, p_claim: recovered.claimToken });
assert.equal(repeated.replayed, true);
await load(jobsActor);
assert.equal(jobsActor.state.totals.eligibleSeconds, 300);
const outbox = (await rest(`time_outbox?user_id=eq.${jobsActor.userId}&event_type=eq.boundary`)).data;
assert.equal(outbox.length, 1);
pass('OP01 crash after claim recovers expired lease; stale claimant rejected; repeated job creates one boundary effect/outbox event');

const failedActor = await createActor('job-failed');
await send(failedActor, start(failedActor, 'solo'));
const agedFail = await ageSyntheticTimeSession(failedActor.userId, failedActor.state.active.id, 301);
const failJob = (await rest(`time_jobs?user_id=eq.${failedActor.userId}&interval_id=eq.${agedFail.intervalId}`)).data[0];
await claimTargetTimeJob(failJob.id);
await expireSyntheticTimeJobLease(failedActor.userId, failJob.id, 5);
const exhaustionClaims = await rpc('claim_time_jobs', { p_limit: 20 });
for (const item of exhaustionClaims) await rpc('execute_time_job', { p_job: item.id, p_claim: item.claimToken });
assert.equal((await rest(`time_jobs?id=eq.${failJob.id}`)).data[0].status, 'failed');
const dispatch = async (token, body = {}) => fetch(`${base}/api/internal/jobs/dispatch`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
response = await dispatch(null);
assert.equal(response.status, 403);
response = await dispatch(dispatchToken, { actor: a.userId });
assert.equal(response.status, 422);
response = await dispatch(dispatchToken);
assert.equal(response.status, 200);
assert.ok((await response.json()).data.failed >= 1);
pass('OP01 retry exhaustion becomes visible Failed; dispatcher requires dedicated secret and accepts no arbitrary actor/job input');
// Repair only this run's deliberately failed synthetic job after observing the operator state.
const repaired = await rest(`time_jobs?id=eq.${failJob.id}&user_id=eq.${failedActor.userId}`, 'PATCH', { status: 'pending', attempts: 0, next_run_at: new Date().toISOString(), lease_until: null, claim_token: null, last_error: null });
assert.equal(repaired.status, 204);
const repairClaim = await claimTargetTimeJob(failJob.id);
await rpc('execute_time_job', { p_job: repairClaim.id, p_claim: repairClaim.claimToken });
assert.equal((await rest(`time_jobs?id=eq.${failJob.id}`)).data[0].status, 'done');

await load(pausedSolo);
const renew = command(pausedSolo, { type: 'renew', ...controlled(pausedSolo) });
const revisionBefore = pausedSolo.state.revision;
const operationsBefore = (await rest(`time_operations?user_id=eq.${pausedSolo.userId}&select=operation_id`)).data.length;
const renewed = await send(pausedSolo, renew);
const renewedAgain = await send(pausedSolo, renew);
assert.deepEqual(renewedAgain.receipt, renewed.receipt);
assert.equal(pausedSolo.state.revision, revisionBefore);
assert.equal((await rest(`time_operations?user_id=eq.${pausedSolo.userId}&select=operation_id`)).data.length, operationsBefore);
assert.equal(renewed.data.sessions.length, 1, 'Renew returns just the affected active session');
assert.equal(renewed.data.sessions[0].id, pausedSolo.state.active.id);
pass('Lease renewal has bounded replay storage, unchanged time revision and no durable ledger growth');

const compactActor = await createActor('compact');
await send(compactActor, start(compactActor));
const affectedId = compactActor.state.active.id;
await send(compactActor, command(compactActor, { type: 'manual', category: 'work', title: 'Newer manual entry', startAt: new Date(Date.now() - 172800_000).toISOString(), endAt: new Date(Date.now() - 172740_000).toISOString() }));
const compactFinished = await send(compactActor, finish(compactActor));
assert.equal(compactFinished.data.sessions.length, 1);
assert.equal(compactFinished.data.sessions[0].id, affectedId);
assert.equal(compactFinished.data.sessions[0].status, 'finalized');
response = await request(compactActor, `time?sessionId=${affectedId}`);
assert.equal(response.status, 200);
assert.equal((await response.json()).data.sessions[0].status, 'finalized');
pass('Compact command snapshots retain affected older-created session; explicit history/detail remains available');

writeFileSync('docs/evidence/B4_TIME_API_RESULTS.json', JSON.stringify({ checkedAt: new Date().toISOString(), base, results, credentialsPrinted: false }, null, 2) + '\n');
console.log(JSON.stringify({ passed: results.length, failed: 0, credentialsPrinted: false }));
