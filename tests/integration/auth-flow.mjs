import assert from 'node:assert/strict';
import { randomBytes, createHmac } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { readEnv, clientEnvPath, runtimeRoot } from '../../scripts/local-backend/env.mjs';
import { waitForLocalOtp } from '../helpers/local-mail.mjs';

const base = process.env.DIMA_TEST_API ?? 'http://127.0.0.1:8787';
assert.ok(['http://127.0.0.1:8787', 'http://localhost:8787'].includes(base), 'Auth checks require the local Workers origin');
const env = readEnv(clientEnvPath);
assert.equal(env.SUPABASE_URL, 'http://127.0.0.1:54321', 'Auth checks must not run against hosted services');
const jar = new Map();
const results = [];
const pass = name => results.push({ name, status: 'passed' });
function saveCookies(response, target = jar) {
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(';'); const index = pair.indexOf('=');
    const name = pair.slice(0, index); const value = pair.slice(index + 1);
    if (/;\s*Max-Age=0(?:;|$)/i.test(header)) target.delete(name); else target.set(name, value);
  }
}
async function request(path, { body, origin = base, cookies = jar, ...options } = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options, method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
    headers: { ...(origin ? { Origin: origin } : {}), ...(cookies?.size ? { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  if (cookies) saveCookies(response, cookies);
  return response;
}
function decodeSession(cookies) {
  const names = [...cookies.keys()].filter(name => name === 'dima-auth' || /^dima-auth\.\d+$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const value = names.map(name => decodeURIComponent(cookies.get(name))).join('');
  assert.ok(value.startsWith('base64-'), 'Expected SDK-encoded local cookie session');
  return JSON.parse(Buffer.from(value.slice(7), 'base64url').toString('utf8'));
}
function replaceSession(cookies, session) {
  for (const name of [...cookies.keys()]) if (name === 'dima-auth' || /^dima-auth\.\d+$/.test(name)) cookies.delete(name);
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
  if (value.length <= 3180) cookies.set('dima-auth', value);
  else for (let offset = 0, part = 0; offset < value.length; offset += 3180, part++) cookies.set(`dima-auth.${part}`, value.slice(offset, offset + 3180));
}
function expireSession(session) {
  const { JWT_SECRET } = readEnv(resolve(runtimeRoot, 'docker.env'));
  const [header, payload] = session.access_token.split('.');
  assert.equal(JSON.parse(Buffer.from(header, 'base64url').toString()).alg, 'HS256', 'Expiry proof expects the configured local HS256 Auth signer');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  const now = Math.floor(Date.now() / 1000); claims.exp = now - 120; claims.iat = now - 3720;
  const body = `${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  return { ...session, access_token: `${body}.${createHmac('sha256', JWT_SECRET).update(body).digest('base64url')}`, expires_at: claims.exp, expires_in: 0 };
}
const authorize = await fetch(`${env.SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(`${base}/auth/callback`)}`, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
assert.ok([302, 303, 400].includes(authorize.status), 'Browser OAuth authorize must reach real Auth without an apikey header');
const authorizeBody = await authorize.text();
assert.ok(!/api.?key.{0,20}(?:required|missing|invalid)/i.test(authorizeBody), 'OAuth authorize must not be rejected by the gateway apikey guard');
pass('Browser OAuth authorize without apikey reaches real Auth or its controlled provider-disabled response');
let response = await request('/api/v1/auth/session');
assert.equal(response.status, 200); const anonymous = await response.json(); assert.equal(anonymous.data.user, null); pass('Anonymous session exposes provider availability without tokens');
for (const origin of [null, 'https://untrusted.example']) {
  response = await request('/api/v1/auth/otp', { body: { email: 'unused@example.test' }, origin });
  assert.equal(response.status, 403);
} pass('Missing and foreign browser Origin rejected before OTP sending');
const email = `dima-b1-auth-${randomBytes(8).toString('hex')}@example.test`;
const sentAt = Date.now();
response = await request('/api/v1/auth/otp', { body: { email, next: '/app/rooms/future-room?tab=lobby' } });
assert.equal(response.status, 200, 'OTP request did not succeed'); assert.equal((await response.json()).data.sent, true);
const token = await waitForLocalOtp(email, { after: sentAt }); pass('Real Auth delivers a six-digit OTP to the local SMTP inbox');
const incorrectToken = token === '000000' ? '111111' : '000000';
response = await request('/api/v1/auth/verify', { body: { email, token: incorrectToken } });
assert.equal(response.status, 401); pass('Incorrect OTP cannot establish a session');
response = await request('/api/v1/auth/verify', { body: { email, token, next: '/app/rooms/future-room?tab=lobby' } });
assert.equal(response.status, 200, 'Real emailed OTP did not verify');
const verification = await response.text(); assert.ok(!/access_token|refresh_token|"user"/.test(verification), 'Verification JSON must not serialize the session');
assert.equal(JSON.parse(verification).data.next, '/app/rooms/future-room?tab=lobby');
const sessionCookies = response.headers.getSetCookie().filter(cookie => /^dima-auth(?:\.|=)/.test(cookie) && !cookie.includes('Max-Age=0'));
assert.ok(sessionCookies.length > 0, 'Verification must set session cookies');
assert.ok(sessionCookies.every(cookie => cookie.includes('HttpOnly') && cookie.includes('SameSite=Lax') && cookie.includes('Path=/')));
pass('Real OTP establishes HttpOnly SameSite session and preserves the deep link without JSON tokens');
response = await request('/api/v1/auth/session'); assert.equal(response.status, 200);
let body = await response.json(); const userId = body.data.user.id;
assert.equal(body.data.user.email, email); assert.match(response.headers.get('cache-control'), /no-store/);
assert.deepEqual(Object.keys(body.data.user).sort(), ['email', 'id']); pass('Reload verifies the signed-in user from cookies and exposes only minimal account fields');
response = await request('/api/v1/auth/verify', { body: { email, token }, cookies: new Map() });
assert.equal(response.status, 401); pass('Consumed OTP cannot be replayed in another browser');
const originalSession = decodeSession(jar); const expiredSession = expireSession(originalSession);
let expiredResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${expiredSession.access_token}` }, signal: AbortSignal.timeout(5000) });
assert.ok([401, 403].includes(expiredResponse.status), 'Locally signed expired JWT must be rejected by real Auth');
assert.ok(/expired/i.test(await expiredResponse.text()), 'Auth must reject the crafted local token for expiry rather than another reason');
replaceSession(jar, expiredSession);
response = await request('/api/v1/auth/session'); assert.equal(response.status, 200);
body = await response.json(); assert.equal(body.data.user.id, userId);
const refreshed = decodeSession(jar);
assert.ok(refreshed.access_token !== expiredSession.access_token, 'Refresh must replace the expired access token');
assert.ok(refreshed.refresh_token !== originalSession.refresh_token, 'Refresh token should rotate');
assert.ok(refreshed.expires_at > Date.now() / 1000);
assert.ok(response.headers.getSetCookie().some(cookie => cookie.includes('HttpOnly')));
pass('A genuinely expired JWT is rejected directly, then the real refresh token rotates the server cookie session');
response = await request('/api/v1/auth/session'); assert.equal((await response.json()).data.user.id, userId); pass('Refreshed session remains usable on a subsequent request');
const canceledJar = new Map([['dima-return', encodeURIComponent('/app/rooms/future-room')], ['dima-auth-code-verifier', 'synthetic-canceled-verifier'], ['dima-auth-flow-abcdefgh-code-verifier', 'synthetic-slot'], ['dima-auth-flows-code-verifier', 'synthetic-index']]);
response = await request('/auth/callback?error=access_denied&error_description=private-provider-detail', { cookies: canceledJar, origin: null });
assert.equal(response.status, 303); const location = new URL(response.headers.get('location'));
assert.equal(location.pathname, '/auth'); assert.equal(location.searchParams.get('next'), '/app/rooms/future-room'); assert.ok(!location.toString().includes('private-provider-detail'));
assert.equal(canceledJar.size, 0); pass('Canceled OAuth returns to auth with safe intent and clears PKCE/return cookies');
if (!anonymous.data.providers.google) {
  response = await request('/api/v1/auth/google', { body: { next: '/app/today' }, cookies: new Map() });
  assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'PROVIDER_UNAVAILABLE');
  pass('Unconfigured Google sign-in fails closed');
}
const signedInCopy = new Map(jar);
response = await request('/api/v1/auth/logout', { body: {} }); assert.equal(response.status, 200); body = await response.json();
assert.equal(body.data.signedOut, true); assert.equal(body.data.serverRevoked, true); assert.ok(![...jar.keys()].some(name => name.startsWith('dima-auth')));
response = await request('/api/v1/auth/session'); assert.equal((await response.json()).data.user, null); pass('Logout revokes the real refresh session and removes browser identity');
replaceSession(signedInCopy, expireSession(decodeSession(signedInCopy)));
response = await request('/api/v1/auth/session', { cookies: signedInCopy }); assert.equal(response.status, 200); assert.equal((await response.json()).data.user, null);
assert.ok(![...signedInCopy.keys()].some(name => name.startsWith('dima-auth'))); pass('Revoked refresh session cannot recover an expired cookie session and is cleared');
mkdirSync('docs/evidence', { recursive: true });
writeFileSync('docs/evidence/B1_AUTH_RESULTS.json', JSON.stringify({ checkedAt: new Date().toISOString(), base, environment: 'local Workers + real GoTrue + local SMTP/Mailpit; no mocked successful authentication', googleLiveLoginVerified: false, expiredAccessTokenTest: 'Synthetic local account token re-signed as expired using local secret in memory; genuine refresh token and Auth service', results }, null, 2) + '\n');
console.log(JSON.stringify({ passed: results.length, failed: 0, credentialsPrinted: false, googleLiveLoginVerified: false }));
