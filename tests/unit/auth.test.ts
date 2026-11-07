import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({
  getUser: vi.fn(), signInWithOtp: vi.fn(), verifyOtp: vi.fn(), signInWithOAuth: vi.fn(), signOut: vi.fn(), exchangeCodeForSession: vi.fn(),
  onCookies: undefined as undefined | ((cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>) => void),
}));
vi.mock('../../apps/web/node_modules/@supabase/ssr', () => ({ createServerClient: vi.fn((_url, _key, options) => { fake.onCookies = options.cookies.setAll; return { auth: fake }; }) }));
vi.mock('../../apps/web/node_modules/@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ auth: fake })) }));
import { appOrigin, authMutationHandler, callbackHandler, mutationOriginAllowed, readJson, requestAuth, safeNext, sessionHandler } from '../../apps/web/src/server/auth';
const origin = 'http://127.0.0.1:8787';
const env = { DIMA_APP_ORIGIN: origin, SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_ANON_KEY: 'public-test-key', DIMA_CLIENT_ORIGINS: 'http://127.0.0.1:4174' };
const request = (body: unknown, headers: Record<string, string> = {}) => new Request(`${origin}/api/v1/auth/verify`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); fake.onCookies = undefined;
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubEnv('DIMA_GOOGLE_ENABLED', 'false');
  fake.getUser.mockResolvedValue({ data: { user: null }, error: { name: 'AuthSessionMissingError', status: 400 } });
  fake.signOut.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe('authentication boundaries', () => {
  it('retains supported deep links and discards external, auth and encoded traversal destinations', () => {
    for (const value of ['https://evil.example', '//evil.example', '/\\evil.example', '/%2f%2fevil.example', '/app/%252e%252e/auth/callback', '/auth/callback', '/api/v1/me', '/app/\nsettings']) expect(safeNext(value)).toBe('/app/today');
    expect(safeNext('/library?q=machine%20learning&tab=all')).toBe('/library?q=machine%20learning&tab=all');
    expect(safeNext('/app/rooms/future-room?tab=lobby#rules')).toBe('/app/rooms/future-room?tab=lobby#rules');
  });
  it('rejects untrusted or absent browser Origin and permits explicit bearer clients without cookies', () => {
    expect(mutationOriginAllowed(request({}), env)).toBe(true);
    expect(mutationOriginAllowed(request({}, { Origin: 'https://evil.example' }), env)).toBe(false);
    expect(mutationOriginAllowed(new Request(`${origin}/api/v1/me`, { method: 'PATCH' }), env)).toBe(false);
    expect(mutationOriginAllowed(new Request(`${origin}/api/v1/me`, { headers: { Authorization: `Bearer ${'a'.repeat(30)}` } }), env)).toBe(true);
    expect(() => appOrigin({ DIMA_APP_ORIGIN: 'http://public.example' })).toThrow();
    expect(() => appOrigin({ DIMA_APP_ORIGIN: `${origin}/redirect` })).toThrow();
  });
  it('never falls back to ambient cookies when an empty Authorization header is present', async () => {
    const emptyBearer = new Request(`${origin}/api/v1/me`, { method: 'PATCH', headers: { Authorization: '', Cookie: 'dima-auth=existing-session' } });
    expect(mutationOriginAllowed(emptyBearer, env)).toBe(false);
    await expect(requestAuth(emptyBearer, env)).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 });
    expect(fake.getUser).not.toHaveBeenCalled();
  });
  it('bounds streamed JSON and enforces content type', async () => {
    await expect(readJson(request({ label: 'a'.repeat(5000) }))).rejects.toMatchObject({ code: 'BODY_TOO_LARGE', status: 413 });
    await expect(readJson(request({}, { 'Content-Type': 'text/plain' }))).rejects.toMatchObject({ code: 'JSON_REQUIRED', status: 415 });
  });
  it('fails Google closed and never calls the provider when disabled', async () => {
    const response = await authMutationHandler(request({ next: '/app/rooms/room' }), 'google');
    expect(response.status).toBe(503);
    expect(fake.signInWithOAuth).not.toHaveBeenCalled();
  });
  it('rejects login CSRF before creating or sending any authentication request', async () => {
    const response = await authMutationHandler(request({ email: 'test@example.com' }, { Origin: 'https://evil.example' }), 'otp');
    expect(response.status).toBe(403); expect(fake.signInWithOtp).not.toHaveBeenCalled();
  });
  it('serializes verified session only as HttpOnly cookies and keeps tokens out of JSON', async () => {
    fake.verifyOtp.mockImplementation(async () => {
      fake.onCookies?.([{ name: 'dima-auth', value: 'session-secret', options: { maxAge: 3600 } }]);
      return { data: { user: { id: 'user-a' }, session: { access_token: 'session-secret' } }, error: null };
    });
    const response = await authMutationHandler(request({ email: 'test@example.com', token: '123456', next: '/app/settings' }), 'verify');
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('SameSite=Lax');
    expect(await response.json()).toEqual({ data: { next: '/app/settings' } });
  });
  it('retains a usable session on transient verification service failure', async () => {
    fake.getUser.mockResolvedValue({ data: { user: null }, error: { name: 'AuthRetryableFetchError', status: 503 } });
    const response = await sessionHandler(new Request(`${origin}/api/v1/auth/session`, { headers: { Cookie: 'dima-auth=existing' } }));
    expect(response.status).toBe(503); expect(response.headers.has('set-cookie')).toBe(false);
  });
  it('clears browser session on logout even when upstream revocation fails', async () => {
    fake.signOut.mockResolvedValue({ error: { status: 503 } });
    const response = await authMutationHandler(request({}, { Cookie: 'dima-auth=old; dima-auth.1=oldchunk' }), 'logout');
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await response.json()).toEqual({ data: { signedOut: true, serverRevoked: false } });
  });
  it('does not erase a pending OAuth verifier during an anonymous session check', async () => {
    const auth = await requestAuth(new Request(`${origin}/api/v1/auth/session`, { headers: { Cookie: 'dima-auth-code-verifier=pending; dima-return=%2Fapp%2Fsettings' } }));
    const response = auth.apply(Response.json({}));
    expect(response.headers.get('set-cookie') ?? '').not.toContain('code-verifier');
    expect(response.headers.get('set-cookie') ?? '').not.toContain('dima-return');
  });
  it('canceled callback preserves a safe destination, strips provider errors and clears flow cookies', async () => {
    const response = await callbackHandler(new Request(`${origin}/auth/callback?error=access_denied&error_description=private-detail`, { headers: { Cookie: 'dima-return=%2Fapp%2Frooms%2Ffuture; dima-auth-code-verifier=old; dima-auth-flow-abcdefgh-code-verifier=slot; dima-auth-flows-code-verifier=index' } }));
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/auth');
    expect(location.searchParams.get('next')).toBe('/app/rooms/future');
    expect(location.toString()).not.toContain('private-detail');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(response.headers.get('set-cookie')).toContain('dima-auth-flow-abcdefgh-code-verifier=;');
    expect(response.headers.get('set-cookie')).toContain('dima-auth-flows-code-verifier=;');
    expect(fake.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
