import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readEnv, clientEnvPath, runtimeRoot } from '../../scripts/local-backend/env.mjs';

async function fixtureClient(userId) {
  const env = readEnv(clientEnvPath);
  assert.equal(env.SUPABASE_URL, 'http://127.0.0.1:54321', 'Time fixtures are local only');
  const key = readEnv(resolve(runtimeRoot, 'server.env')).SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const identity = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers });
  assert.equal(identity.status, 200);
  assert.match((await identity.json()).email, /^b4-[a-z0-9-]+@example\.test$/i, 'Only isolated B4 synthetic identities may be aged');
  return async (path, method = 'GET', body) => {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.ok(response.ok, `Synthetic time fixture request failed: ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
}
/** Test-only aging; no production clock parameter or unrestricted fixture endpoint exists. */
export async function ageSyntheticTimeSession(userId, sessionId, seconds) {
  assert.ok(Number.isFinite(seconds) && seconds > 0 && seconds <= 20000);
  const request = await fixtureClient(userId);
  const sessions = await request(`time_sessions?user_id=eq.${userId}&select=id,created_at,lease_until,status`);
  assert.equal(sessions.length, 1, 'Aging requires an isolated account with only one session');
  assert.equal(sessions[0].id, sessionId);
  const intervals = await request(`time_intervals?user_id=eq.${userId}&session_id=eq.${sessionId}&select=id,start_at,end_at,boundary_at,created_at,effective_end_at`);
  assert.equal(intervals.length, 1, 'Aging requires one initial interval');
  assert.equal(intervals[0].effective_end_at, null);
  assert.ok(sessions[0].status === 'running' && intervals[0].end_at === null || sessions[0].status === 'paused' && intervals[0].end_at !== null, 'Only initial running/paused fixtures can be aged');
  const shift = value => new Date(Date.parse(value) - seconds * 1000).toISOString();
  const interval = intervals[0];
  await request(`time_intervals?id=eq.${interval.id}&user_id=eq.${userId}`, 'PATCH', { start_at: shift(interval.start_at), end_at: interval.end_at ? shift(interval.end_at) : null, boundary_at: shift(interval.boundary_at), created_at: shift(interval.created_at) });
  await request(`time_jobs?interval_id=eq.${interval.id}&user_id=eq.${userId}`, 'PATCH', { boundary_at: shift(interval.boundary_at), next_run_at: shift(interval.boundary_at) });
  await request(`time_sessions?id=eq.${sessionId}&user_id=eq.${userId}`, 'PATCH', { created_at: shift(sessions[0].created_at), lease_until: shift(sessions[0].lease_until) });
  return { intervalId: interval.id, startAt: shift(interval.start_at), boundaryAt: shift(interval.boundary_at) };
}
export async function expireSyntheticTimeJobLease(userId, jobId, attempts) {
  const request = await fixtureClient(userId);
  const rows = await request(`time_jobs?id=eq.${jobId}&user_id=eq.${userId}&select=id`);
  assert.equal(rows.length, 1);
  assert.ok(attempts === undefined || Number.isInteger(attempts) && attempts >= 1 && attempts <= 5);
  await request(`time_jobs?id=eq.${jobId}&user_id=eq.${userId}`, 'PATCH', {
    lease_until: new Date(Date.now() - 1000).toISOString(),
    ...(attempts === undefined ? {} : { attempts }),
  });
}
