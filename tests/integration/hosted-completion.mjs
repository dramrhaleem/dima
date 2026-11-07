// Bounded hosted completion-feature smoke. Never run implicitly.
// Run only after deployment: node tests/integration/hosted-completion.mjs --run-hosted
// One disposable account; no catalog changes, real-member writes, email or ranking activity.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
if (!process.argv.includes('--run-hosted')) throw new Error('Explicit --run-hosted required; this script creates and deletes one disposable account.');
const secretPath = '/home/amro/.local/state/dima-production/worker-secrets.json';
assert.equal(statSync(secretPath).mode & 0o077, 0, 'Credentials must be owner-only');
const env = JSON.parse(readFileSync(secretPath, 'utf8'));
assert.equal(env.SUPABASE_URL, 'https://vblsmzgbodqnlxlplnby.supabase.co');
assert.ok(env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_ANON_KEY);
const origin = 'https://dima.study', runId = randomUUID(), actors = [], results = [], cleanup = [];
const secrets = new Set(Object.values(env));
const redact = value => { let out = String(value); for (const secret of secrets) if (typeof secret === 'string' && secret.length > 10) out = out.replaceAll(secret, '[redacted]'); return out; };
const pass = name => { results.push({ name, status: 'passed' }); console.log(JSON.stringify({ passed: name })); };
async function http(actor, path, method = 'GET', body) {
  const response = await fetch(`${origin}/api/v1/${path}`, { method, headers: { ...(actor ? { Authorization: `Bearer ${actor.token}`, 'X-Dima-Account-Id': actor.id } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
  return { status: response.status, body: await response.json().catch(() => null) };
}
async function admin(path, method = 'GET', body) {
  return fetch(`${env.SUPABASE_URL}/auth/v1/admin/${path}`, { method, headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
}
async function createActor() {
  const email = `completion-disposable-${runId}@example.test`, password = randomBytes(32).toString('base64url'); secrets.add(password);
  const created = await admin('users', 'POST', { email, password, email_confirm: true, user_metadata: { validation_run: runId, disposable: true } });
  assert.equal(created.status, 200, 'Create disposable account');
  const user = await created.json(); assert.match(user.id, /^[0-9a-f-]{36}$/i);
  const actor = { id: user.id, email }; actors.push(actor);
  const signed = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(20000) });
  assert.equal(signed.status, 200, 'Disposable password sign in');
  const session = await signed.json(); actor.token = session.access_token; secrets.add(actor.token); secrets.add(session.refresh_token);
  const profile = await http(actor, 'me'); assert.equal(profile.status, 200);
  const saved = await http(actor, 'me', 'PATCH', { operationId: randomUUID(), expectedRevision: profile.body.data.profile?.revision ?? 0, displayName: 'Dima temporary validation', timezone: 'UTC', intent: 'learning', appearance: 'light', reducedMotion: false, onboarded: true });
  assert.equal(saved.status, 200, 'Onboard disposable account');
  return actor;
}
let failure;
try {
  assert.equal((await http(null, 'profile-settings')).status, 401);
  assert.equal((await http(null, 'shared-milestones')).status, 401);
  assert.equal((await http(null, 'account/export')).status, 401);
  pass('Anonymous settings, milestones and export are denied');
  const actor = await createActor(), handle = `check-${runId.replaceAll('-', '').slice(0, 20)}`;
  let settings = await http(actor, 'profile-settings'); assert.equal(settings.status, 200); assert.equal(settings.body.data.accountId, actor.id); assert.equal(settings.body.data.publicLink, false);
  assert.equal((await http(null, `profiles/public/${handle}`)).status, 404);
  const command = { type: 'setPublicLink', operationId: randomUUID(), expectedRevision: settings.body.data.revision, handle, publicLink: true, bio: 'Temporary validation profile.' };
  assert.equal((await http(actor, 'profile-settings', 'POST', command)).status, 422, 'Enabling requires explicit consent');
  settings = await http(actor, 'profile-settings', 'POST', { ...command, operationId: randomUUID(), consentVersion: 1 });
  assert.equal(settings.status, 200); assert.equal(settings.body.data.publicLink, true);
  const publicProfile = await http(null, `profiles/public/${handle}`); assert.equal(publicProfile.status, 200);
  assert.deepEqual(Object.keys(publicProfile.body.data).sort(), ['bio', 'displayName', 'handle']);
  assert.deepEqual(publicProfile.body.data, { handle, displayName: 'Dima temporary validation', bio: command.bio });
  settings = await http(actor, 'profile-settings', 'POST', { ...command, operationId: randomUUID(), expectedRevision: settings.body.data.revision, consentVersion: 1, publicLink: false });
  assert.equal(settings.status, 200); assert.equal(settings.body.data.publicLink, false);
  assert.equal((await http(null, `profiles/public/${handle}`)).status, 404, 'Disabled link is immediately unavailable');
  pass('Public link starts private, requires consent, exposes exactly three fields, and disables');
  const rhythm = await http(actor, 'profile-settings', 'POST', { type: 'setRhythmGoal', operationId: randomUUID(), expectedRevision: settings.body.data.revision, days: 4 });
  assert.equal(rhythm.status, 200); assert.equal(rhythm.body.data.nextGoal.days, 4); assert.equal(rhythm.body.data.nextGoal.effectiveWeek, rhythm.body.data.nextEffectiveWeek); assert.equal(rhythm.body.data.currentGoal, null);
  settings = await http(actor, 'profile-settings'); assert.equal(settings.status, 200); assert.deepEqual(settings.body.data.nextGoal, rhythm.body.data.nextGoal);
  pass('Personal rhythm persists for next week without rewriting the current week');
  const milestones = await http(actor, 'shared-milestones'); assert.equal(milestones.status, 200);
  for (const field of ['candidates', 'mine', 'feed']) assert.deepEqual(milestones.body.data[field], []);
  const invalidScope = `smoke-unavailable-${runId}`;
  assert.equal((await http(actor, 'shared-milestones/preview', 'POST', { scopeId: invalidScope })).status, 404);
  assert.equal((await http(actor, 'shared-milestones', 'POST', { type: 'publish', operationId: randomUUID(), scopeId: invalidScope, previewToken: '0'.repeat(32), audience: 'accepted-followers', acknowledgeSharing: true })).status, 404);
  pass('Fresh account has no eligible milestones; nonexistent scope cannot preview or publish');
  const initialLearning = await http(actor, 'learning'); assert.equal(initialLearning.status, 200);
  let learning = initialLearning.body.data;
  const learn = async command => {
    const response = await http(actor, 'learning', 'POST', { ...command, expectedRevision: learning.state.revision, operationId: randomUUID() });
    assert.equal(response.status, 200, `Private learning ${command.type}: ${response.body?.error?.code ?? 'unexpected response'}`);
    learning = response.body.data; assert.equal(learning.accountId, actor.id); return response.body;
  };
  const activity = (id, position) => ({ id, title: id === 'keep' ? 'Read the introduction' : 'Practice the new skill', position, kind: 'reading', minutes: 20, estimateSource: 'user', requirement: 'required', sourceUrl: `https://example.edu/${id}`, prerequisiteIds: [] });
  const draft = { id: `private-${runId}`, title: 'Temporary private outline validation', sourceUrl: 'https://example.edu', courses: [{ id: 'course', title: 'Course', position: 0, modules: [{ id: 'module', title: 'Getting started', position: 0, tasks: [activity('keep', 0)] }] }] };
  await learn({ type: 'saveDraft', draft });
  await learn({ type: 'enroll', offeringId: draft.id, taskIds: ['keep'], priorTaskIds: [], targetDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) });
  const enrollmentId = learning.state.enrollments.find(item => item.offeringId === draft.id).id;
  await learn({ type: 'complete', enrollmentId, taskId: 'keep', effortMinutes: 10 });
  const beforeUpgrade = globalThis.structuredClone(learning.state.enrollments.find(item => item.id === enrollmentId));
  const workBefore = globalThis.structuredClone(learning.state.workEvents);
  assert.equal(beforeUpgrade.completions.length, 1); assert.equal(workBefore.length, 1);
  assert.equal(workBefore[0].completionClaimId, beforeUpgrade.completions[0].claimId);
  draft.courses[0].modules[0].tasks.push(activity('added', 1));
  await learn({ type: 'saveDraft', draft });
  const preview = await learn({ type: 'previewUpgrade', enrollmentId, includeNewRequired: true });
  assert.ok(preview.previewId);
  const details = learning.state.upgradePreviews.find(item => item.id === preview.previewId);
  assert.deepEqual(details.mapped, ['keep']); assert.deepEqual(details.added, ['added']);
  await learn({ type: 'applyUpgrade', previewId: preview.previewId, acknowledgeChanges: true });
  const reread = await http(actor, 'learning'); assert.equal(reread.status, 200); learning = reread.body.data;
  const upgraded = learning.state.enrollments.find(item => item.id === enrollmentId);
  assert.deepEqual(upgraded.taskIds, ['keep', 'added']);
  assert.deepEqual(upgraded.completions, beforeUpgrade.completions, 'Existing completion claim and timestamps preserved');
  assert.deepEqual(learning.state.workEvents, workBefore, 'Upgrade creates no additional work or credit');
  assert.equal(upgraded.upgradeHistory.length, 1);
  for (const field of ['snapshot', 'taskIds', 'priorTaskIds', 'completions', 'estimates', 'remaining']) assert.deepEqual(upgraded.upgradeHistory[0][field], beforeUpgrade[field], `Archive preserves ${field}`);
  const privateMilestones = await http(actor, 'shared-milestones'); assert.equal(privateMilestones.status, 200);
  assert.deepEqual(privateMilestones.body.data.candidates, [], 'Private completion never becomes public milestone eligibility');
  pass('Private outline update previews and applies while preserving original claim, work history and prior scope archive');
  const exported = await http(actor, 'account/export'); assert.equal(exported.status, 200); assert.equal(exported.body.accountId, actor.id);
  for (const field of ['profilePreferences', 'rhythmGoals', 'sharedMilestones', 'encouragements']) assert.ok(Array.isArray(exported.body[field]), `Export includes ${field}`);
  assert.equal(exported.body.profilePreferences.length, 1); assert.equal(exported.body.profilePreferences[0].handle, handle); assert.equal(exported.body.profilePreferences[0].public_link, false);
  assert.equal(exported.body.rhythmGoals.length, 1); assert.equal(exported.body.rhythmGoals[0].days, 4);
  assert.deepEqual(exported.body.sharedMilestones, []); assert.deepEqual(exported.body.encouragements, []);
  for (const field of ['profilePreferences', 'rhythmGoals', 'sharedMilestones', 'encouragements']) for (const row of exported.body[field]) assert.equal('user_id' in row, false);
  assert.deepEqual(exported.body.learning.enrollments.find(item => item.id === enrollmentId), upgraded);
  assert.deepEqual(exported.body.learning.workEvents, workBefore);
  pass('Owner export includes saved preferences, rhythm, upgraded private history and empty owned milestone sections');
} catch (error) { failure = { name: error.name, message: redact(error.message).slice(0, 1000), stack: redact(error.stack).slice(0, 3000) }; }
finally {
  for (const actor of actors) {
    try {
      const current = await admin(`users/${actor.id}`); assert.equal(current.status, 200);
      const record = await current.json(); assert.equal(record.email, actor.email); assert.equal(record.user_metadata.validation_run, runId); assert.equal(record.user_metadata.disposable, true);
      assert.equal((await admin(`users/${actor.id}`, 'DELETE')).status, 200);
      assert.equal((await admin(`users/${actor.id}`)).status, 404);
      cleanup.push({ id: actor.id, deleted: true, verifiedAbsent: true });
    } catch (error) { cleanup.push({ id: actor.id, deleted: false, error: redact(error.message).slice(0, 500) }); }
  }
}
const report = { runId, at: new Date().toISOString(), origin, projectRef: 'vblsmzgbodqnlxlplnby', scope: 'Disposable-account completion smoke; no browser, shared catalog mutation, real-user mutation, public-course milestone publish or load claim', harnessSha256: createHash('sha256').update(readFileSync('tests/integration/hosted-completion.mjs')).digest('hex'), ok: !failure && cleanup.every(item => item.deleted), results, failure: failure ?? null, syntheticAccounts: actors.length, cleanup };
writeFileSync('docs/evidence/B7_HOSTED_COMPLETION_SMOKE.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ok: report.ok, passed: results.length, failure: failure?.message ?? null, cleanup: cleanup.map(item => ({ deleted: item.deleted, verifiedAbsent: item.verifiedAbsent })) }));
if (!report.ok) process.exitCode = 1;
