// Local-only integration: derived ranking defaults, explicit opt-out, eligibility and privacy.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readEnv, clientEnvPath, runtimeRoot } from '../../scripts/local-backend/env.mjs';
import { ageSyntheticTimeSession } from '../helpers/time-fixture.mjs';

const base = process.env.DIMA_TEST_API ?? 'http://127.0.0.1:8787';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const env = readEnv(clientEnvPath);
assert.equal(env.SUPABASE_URL, 'http://127.0.0.1:54321');
const admin = readEnv(resolve(runtimeRoot, 'server.env')).SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: admin, Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' };
const run = randomUUID(), actors = [], passes = [];
const pass = name => { passes.push(name); console.log(`PASS ${name}`); };
const cmd = (type, rest = {}) => ({ type, operationId: randomUUID(), expectedRevision: 0, ...rest });
async function request(actor, path, method = 'GET', body, status = 200) {
  const r = await fetch(`${base}/api/v1/${path}`, { method, headers: { ...(actor ? { Authorization: `Bearer ${actor.token}`, 'X-Dima-Account-Id': actor.id } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
  const result = await r.json().catch(() => null);
  assert.equal(r.status, status, `${method} ${path}: ${result?.error?.code ?? ''}`);
  return result.data;
}
function sqlFor(actor, sql) {
  assert.match(actor.id, /^[a-f0-9-]{36}$/);
  const label = spawnSync('docker', ['inspect', 'dima-b0-db', '--format', '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}'], { encoding: 'utf8' });
  assert.equal(label.stdout.trim(), `dima-b0|${resolve('scripts/local-backend/compose.yaml')}`);
  const result = spawnSync('docker', ['exec', '-i', 'dima-b0-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], { encoding: 'utf8', input: `BEGIN; DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id='${actor.id}' AND email='${actor.email}') THEN RAISE EXCEPTION 'Synthetic identity required'; END IF; END $$; ${sql}; COMMIT;` });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
async function account(tag) {
  const email = `b4-ranking-${run}-${tag}@example.test`, password = randomBytes(24).toString('base64url');
  const created = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, { method: 'POST', headers, body: JSON.stringify({ email, password, email_confirm: true }) });
  assert.equal(created.status, 200);
  const user = await created.json();
  const login = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(login.status, 200);
  const actor = { id: user.id, email, token: (await login.json()).access_token };
  actors.push(actor);
  await request(actor, 'me', 'PATCH', { displayName: `Ranking ${tag}`, timezone: 'UTC', intent: 'learning', appearance: 'light', reducedMotion: true, onboarded: true, expectedRevision: 0, operationId: randomUUID() });
  return actor;
}
let offeringId, reviewer;
try {
  const learner = await account('learner'), observer = await account('observer'), hidden = await account('hidden');
  reviewer = observer;
  // Represents a choice saved under the previous opt-in policy; never erase it.
  sqlFor(hidden, `INSERT INTO public.ranking_participation(user_id,scope_id,enabled,revision) VALUES('${hidden.id}','time',false,3)`);
  const before = sqlFor(learner, `SELECT count(*) FROM public.ranking_participation WHERE user_id='${learner.id}'`);
  for (const period of ['week', 'month']) {
    const board = await request(learner, `leaderboards/time?period=${period}`);
    assert.deepEqual(board.participation, { enabled: true, revision: 0, canParticipate: true });
    assert.ok(!board.rows.some(row => row.profileId === learner.id));
    assert.equal((await request(hidden, `leaderboards/time?period=${period}`)).participation.enabled, false);
  }
  assert.equal(sqlFor(learner, `SELECT count(*) FROM public.ranking_participation WHERE user_id='${learner.id}'`), before);
  assert.equal((await request(learner, 'sharing')).publicProfile, false);
  await request(null, 'leaderboards/time', 'GET', undefined, 401);
  pass('Defaults are derived on read, zero scores omitted, legacy hide preserved, anonymous access denied');

  let time = await request(learner, 'time');
  const deviceId = randomUUID();
  time = await request(learner, 'time', 'POST', cmd('start', { expectedRevision: time.revision, deviceId, mode: 'open', category: 'learning', title: 'Ranking fixture', enrollmentId: null, taskId: null, settings: null, previousSessionId: null }));
  const sessionId = time.active.id, controlVersion = time.active.controlVersion;
  const aged = await ageSyntheticTimeSession(learner.id, sessionId, 30);
  time = await request(learner, 'time', 'POST', cmd('finish', { expectedRevision: time.revision, deviceId, sessionId, controlVersion, intervalId: aged.intervalId }));
  assert.equal(time.active, null);
  let board = await request(observer, 'leaderboards/time');
  const ranked = board.rows.find(row => row.profileId === learner.id);
  assert.ok(time.totals.eligibleSeconds > 25);
  assert.ok(board.rows.every(row => row.score > 0));
  if (ranked) { assert.ok(ranked.score > 25); assert.equal(ranked.profileVisible, false); }
  else { assert.equal(board.rows.length, 50); assert.ok(board.rows.every(row => row.score >= time.totals.eligibleSeconds)); }
  await request(observer, `profiles/${learner.id}/shared`, 'GET', undefined, 404);
  pass('Accepted time supplies positive scores; top50 remains bounded and implicit defaults keep profiles private');

  const hide = cmd('setParticipation', { board: 'time', scopeId: null, enabled: false });
  await request(learner, 'leaderboards/participation', 'POST', hide);
  await request(learner, 'leaderboards/participation', 'POST', hide);
  assert.equal((await request(learner, 'leaderboards/time')).participation.revision, 1);
  assert.ok(!(await request(observer, 'leaderboards/time?period=month')).rows.some(row => row.profileId === learner.id));
  await request(learner, 'leaderboards/participation', 'POST', cmd('setParticipation', { board: 'time', scopeId: null, enabled: true }), 409);
  await request(learner, 'leaderboards/participation', 'POST', cmd('setParticipation', { board: 'time', scopeId: null, enabled: true, expectedRevision: 1 }));
  assert.equal((await request(learner, 'leaderboards/time')).participation.enabled, true);
  const blocked = await request(observer, 'blocks', 'POST', cmd('block', { targetId: learner.id }));
  assert.ok(!(await request(observer, 'leaderboards/time')).rows.some(row => row.profileId === learner.id));
  await request(observer, `blocks/${blocked.rows[0].id}/revoke`, 'POST', cmd('unblock', { blockId: blocked.rows[0].id }));
  sqlFor(learner, `INSERT INTO public.account_suspensions(user_id,reason,effective_at) VALUES('${learner.id}','Synthetic ranking test',now())`);
  assert.ok(!(await request(observer, 'leaderboards/time')).rows.some(row => row.profileId === learner.id));
  sqlFor(learner, `UPDATE public.account_suspensions SET revoked_at=now() WHERE user_id='${learner.id}' AND reason='Synthetic ranking test'`);
  pass('Hide, reload, replay, stale revision, rejoin, block and suspension respected');

  // Hide the explicit time choice again: course default must not inherit profile discovery.
  await request(learner, 'leaderboards/participation', 'POST', cmd('setParticipation', { board: 'time', scopeId: null, enabled: false, expectedRevision: 2 }));
  // Publish only this run's synthetic outline so withdrawal can be checked without touching seed courses.
  sqlFor(reviewer, `INSERT INTO public.account_roles(user_id,role) VALUES('${reviewer.id}','admin')`);
  const draftId = `ranking-${run}`, source = 'https://example.edu/ranking';
  let learning = await request(learner, 'learning');
  learning = await request(learner, 'learning', 'POST', cmd('saveDraft', { expectedRevision: learning.state.revision, draft: { id: draftId, title: 'Ranking fixture course', sourceUrl: source, courses: [{ id: 'course', title: 'Course', position: 0, modules: [{ id: 'module', title: 'Module', position: 0, tasks: [{ id: 'read', title: 'Read the outline', position: 0, kind: 'reading', minutes: 5, estimateSource: 'user', requirement: 'required', sourceUrl: source, prerequisiteIds: [] }] }] }] } }));
  const submitted = await request(learner, 'publication-requests', 'POST', cmd('submit', { expectedRevision: learning.state.revision, draftId, provider: 'Synthetic test', summary: 'Isolated leaderboard fixture.', language: 'English', scopeLabel: 'Required work', orderPolicy: 'Source order', sourceNotes: 'Synthetic source metadata.', rightsAttested: true }));
  offeringId = submitted.offeringId;
  const review = (await request(reviewer, 'admin/reviews')).requests.find(item => item.id === submitted.requestId);
  await request(reviewer, 'admin/reviews', 'POST', cmd('review', { requestId: review.id, expectedRevision: review.revision, decision: 'approve', reason: 'Synthetic fixture.' }));
  const scope = (await request(learner, 'leaderboards/time')).scopes.find(item => item.offeringId === offeringId);
  assert.ok(scope);
  const coursePath = `leaderboards/course/${encodeURIComponent(scope.id)}`;
  assert.deepEqual((await request(observer, coursePath)).participation, { enabled: false, revision: 0, canParticipate: false });
  await request(observer, 'leaderboards/participation', 'POST', cmd('setParticipation', { board: 'course', scopeId: scope.id, enabled: false }), 404);
  learning = await request(learner, 'learning');
  const date = new Date(); date.setUTCDate(date.getUTCDate() + 30);
  learning = await request(learner, 'learning', 'POST', cmd('enroll', { expectedRevision: learning.state.revision, offeringId, taskIds: ['read'], priorTaskIds: ['read'], targetDate: date.toISOString().slice(0, 10), estimates: {} }));
  assert.equal((await request(learner, coursePath)).participation.enabled, true);
  assert.ok(!(await request(observer, coursePath)).rows.some(row => row.profileId === learner.id));
  const implicitCourseRow = (await request(observer, `${coursePath}?period=overall`)).rows.find(row => row.profileId === learner.id);
  assert.equal(implicitCourseRow?.score, 1); assert.equal(implicitCourseRow.profileVisible, false);
  await request(observer, `profiles/${learner.id}/shared`, 'GET', undefined, 404);
  const courseBlock = await request(observer, 'blocks', 'POST', cmd('block', { targetId: learner.id }));
  assert.ok(!(await request(observer, `${coursePath}?period=overall`)).rows.some(row => row.profileId === learner.id));
  await request(observer, `blocks/${courseBlock.rows[0].id}/revoke`, 'POST', cmd('unblock', { blockId: courseBlock.rows[0].id }));
  sqlFor(learner, `INSERT INTO public.account_suspensions(user_id,reason,effective_at) VALUES('${learner.id}','Synthetic ranking test',now())`);
  assert.ok(!(await request(observer, `${coursePath}?period=overall`)).rows.some(row => row.profileId === learner.id));
  sqlFor(learner, `UPDATE public.account_suspensions SET revoked_at=now() WHERE user_id='${learner.id}' AND reason='Synthetic ranking test'`);
  assert.equal((await request(observer, `${coursePath}?period=overall`)).rows.find(row => row.profileId === learner.id)?.score, 1);
  const hideCourse = cmd('setParticipation', { board: 'course', scopeId: scope.id, enabled: false });
  await request(learner, 'leaderboards/participation', 'POST', hideCourse);
  assert.ok(!(await request(observer, `${coursePath}?period=overall`)).rows.some(row => row.profileId === learner.id));
  assert.equal((await request(learner, 'leaderboards/time')).participation.enabled, false);
  await request(learner, 'leaderboards/participation', 'POST', cmd('setParticipation', { board: 'course', scopeId: scope.id, enabled: true, expectedRevision: 1 }));
  const item = (await request(reviewer, 'admin/catalog')).offerings.find(value => value.id === offeringId);
  await request(reviewer, 'admin/catalog', 'POST', cmd('setPublication', { offeringId, published: false, expectedRevision: item.revision, reason: 'Synthetic fixture completed.' }));
  const unavailable = await request(learner, coursePath);
  assert.equal(unavailable.unavailable, true); assert.equal(unavailable.participation.canParticipate, false); assert.deepEqual(unavailable.rows, []);
  await request(learner, 'leaderboards/participation', 'POST', cmd('setParticipation', { board: 'course', scopeId: scope.id, enabled: false, expectedRevision: 2 }));
  assert.equal((await request(learner, coursePath)).participation.enabled, false);
  pass('Course defaults require enrollment; baseline, independent opt-out and withdrawn-board hiding work');
} finally {
  if (offeringId && reviewer) {
    const item = (await request(reviewer, 'admin/catalog')).offerings.find(value => value.id === offeringId);
    if (item?.status === 'published') await request(reviewer, 'admin/catalog', 'POST', cmd('setPublication', { offeringId, published: false, expectedRevision: item.revision, reason: 'Synthetic test cleanup.' }));
  }
  for (const actor of actors) {
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${actor.id}`, { method: 'DELETE', headers });
    assert.ok(r.ok, `Synthetic account cleanup failed: ${r.status}`);
  }
}
assert.equal(passes.length, 4);
console.log(JSON.stringify({ passed: passes.length, credentialsPrinted: false, localOnly: true }));
