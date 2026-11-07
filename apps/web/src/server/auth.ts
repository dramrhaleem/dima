import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { environment } from './foundation';

type AuthEnvironment = {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  DIMA_APP_ORIGIN?: string;
  DIMA_CLIENT_ORIGINS?: string;
  DIMA_GOOGLE_ENABLED?: string;
};
type CookieOptions = { maxAge?: number; expires?: Date; path?: string; sameSite?: boolean | 'lax' | 'strict' | 'none'; httpOnly?: boolean; secure?: boolean };
type CookieChange = { name: string; value: string; options: CookieOptions };
export class AuthHttpError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}
export function authEnvironment(): AuthEnvironment { return environment() as AuthEnvironment; }
export function appOrigin(env = authEnvironment()): string {
  try {
    const url = new URL(env.DIMA_APP_ORIGIN ?? '');
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error();
    return url.origin;
  } catch { throw new AuthHttpError('SERVICE_NOT_CONFIGURED', 503); }
}

const unsafePathCharacters = (value: string) => [...value].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || char === '\\');

/** Only destinations owned by the product; never authentication, APIs, or arbitrary origins. */
export function safeNext(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1600 || !value.startsWith('/') || value.startsWith('//')) return '/app/today';
  if (unsafePathCharacters(value)) return '/app/today';
  const url = new URL(value, 'https://dima.invalid');
  if (url.origin !== 'https://dima.invalid') return '/app/today';
  let decoded = url.pathname;
  try {
    for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(decoded); i++) decoded = decodeURIComponent(decoded);
  } catch { return '/app/today'; }
  if (unsafePathCharacters(decoded) || decoded.startsWith('//') || decoded.split('/').some(part => part === '.' || part === '..')) return '/app/today';
  if (!/^\/(?:app(?:\/[^?#]*)?|library(?:\/[^?#]*)?|courses\/[^?#]+|u\/[^?#]+)$/.test(url.pathname)) return '/app/today';
  return `${url.pathname}${url.search}${url.hash}`;
}
function allowedOrigin(origin: string, env: AuthEnvironment): boolean {
  return origin === appOrigin(env) || (env.DIMA_CLIENT_ORIGINS ?? '').split(',').map(x => x.trim()).includes(origin);
}
export function mutationOriginAllowed(request: Request, env = authEnvironment()): boolean {
  const origin = request.headers.get('origin');
  // A bearer credential is explicit, unlike ambient browser cookies. It is used exclusively below.
  const authorization = request.headers.get('authorization');
  if (authorization !== null) return /^Bearer [A-Za-z0-9._-]{20,4096}$/.test(authorization) && (!origin || allowedOrigin(origin, env));
  return origin !== null && origin === appOrigin(env);
}
export function authJson(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Origin, Cookie', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
}
export function authFailure(error: unknown): Response {
  return error instanceof AuthHttpError ? authJson({ error: { code: error.code } }, error.status) : authJson({ error: { code: 'TEMPORARILY_UNAVAILABLE' } }, 503);
}
export function apiPreflight(request: Request, methods = 'GET, PATCH, OPTIONS'): Response {
  try {
    const origin = request.headers.get('origin');
    if (!origin || !allowedOrigin(origin, authEnvironment())) throw new AuthHttpError('ORIGIN_NOT_ALLOWED', 403);
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': methods, 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Dima-Account-Id', 'Vary': 'Origin', 'Cache-Control': 'private, no-store' } });
  } catch (error) { return authFailure(error); }
}
export async function readJson(request: Request, maxBytes = 4096): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new AuthHttpError('JSON_REQUIRED', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AuthHttpError('INVALID_INPUT', 422);
  let length = 0; const parts: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > maxBytes) { await reader.cancel(); throw new AuthHttpError('BODY_TOO_LARGE', 413); }
    parts.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new AuthHttpError('INVALID_JSON', 400); }
}
function readCookies(request: Request): Array<{ name: string; value: string }> {
  const found = new Map<string, string>();
  for (const cookie of (request.headers.get('cookie') ?? '').split(';')) {
    const index = cookie.indexOf('='); if (index < 1) continue;
    const name = cookie.slice(0, index).trim();
    try { if (!found.has(name)) found.set(name, decodeURIComponent(cookie.slice(index + 1).trim())); } catch { /* Malformed values cannot establish a session. */ }
  }
  return [...found].map(([name, value]) => ({ name, value }));
}
function cookieHeader(cookie: CookieChange, secure: boolean): string {
  const parts = [`${cookie.name}=${encodeURIComponent(cookie.value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  if (cookie.options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(cookie.options.maxAge)}`);
  if (cookie.options.expires) parts.push(`Expires=${cookie.options.expires.toUTCString()}`);
  return parts.join('; ');
}
function temporaryAuthFailure(error: { status?: number; name?: string } | null): boolean {
  return !!error && ((error.status ?? 0) >= 500 || error.status === 429 || error.name === 'AuthRetryableFetchError');
}
function authContext(request: Request, env = authEnvironment()) {
  const origin = appOrigin(env);
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) throw new AuthHttpError('SERVICE_NOT_CONFIGURED', 503);
  const incomingOrigin = request.headers.get('origin');
  if (incomingOrigin && !allowedOrigin(incomingOrigin, env)) throw new AuthHttpError('ORIGIN_NOT_ALLOWED', 403);
  const secure = origin.startsWith('https:');
  const cookieName = secure ? '__Host-dima-auth' : 'dima-auth';
  const returnName = secure ? '__Host-dima-return' : 'dima-return';
  const cookies = readCookies(request);
  const updates = new Map<string, CookieChange>();
  const authorization = request.headers.get('authorization');
  if (authorization !== null && !/^Bearer [A-Za-z0-9._-]{20,4096}$/.test(authorization)) throw new AuthHttpError('AUTH_REQUIRED', 401);
  const fetcher: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) });
  const db = authorization
    ? createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { global: { headers: { Authorization: authorization }, fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
    : createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      global: { fetch: fetcher },
      cookieOptions: { name: cookieName, path: '/', httpOnly: true, secure, sameSite: 'lax' },
      cookies: {
        getAll: () => cookies,
        setAll: changes => { for (const change of changes) updates.set(change.name, change); },
      },
    });
  function setReturn(next: string) { updates.set(returnName, { name: returnName, value: safeNext(next), options: { maxAge: 600 } }); }
  function clearCookies(auth = true) {
    const names = new Set([...cookies.map(x => x.name), ...updates.keys(), returnName]);
    for (const name of names) if (name === returnName || (auth && (name === cookieName || name.startsWith(`${cookieName}.`) || name.startsWith(`${cookieName}-`)))) {
      updates.set(name, { name, value: '', options: { maxAge: 0, expires: new Date(0) } });
    }
  }
  function clearSession() {
    for (const name of new Set([...cookies.map(x => x.name), ...updates.keys()])) if (name === cookieName || name.startsWith(`${cookieName}.`)) updates.set(name, { name, value: '', options: { maxAge: 0, expires: new Date(0) } });
  }
  function clearVerifier() {
    for (const name of new Set([...cookies.map(x => x.name), ...updates.keys()])) if (name.startsWith(`${cookieName}-`) && /-code-verifier(?:\.\d+)?$/.test(name)) updates.set(name, { name, value: '', options: { maxAge: 0, expires: new Date(0) } });
  }
  function apply(response: Response): Response {
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Vary', 'Origin, Cookie');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'no-referrer');
    if (incomingOrigin && allowedOrigin(incomingOrigin, env)) response.headers.set('Access-Control-Allow-Origin', incomingOrigin);
    for (const change of updates.values()) response.headers.append('Set-Cookie', cookieHeader(change, secure));
    return response;
  }
  return { db, origin, authorization, apply, setReturn, clearCookies, clearSession, clearVerifier, returnTo: safeNext(cookies.find(x => x.name === returnName)?.value) };
}
export async function requestAuth(request: Request, env = authEnvironment()): Promise<{ db: SupabaseClient; user: User | null; apply: (response: Response) => Response }> {
  const context = authContext(request, env);
  const { data, error } = await context.db.auth.getUser(context.authorization?.slice(7));
  if (temporaryAuthFailure(error)) throw new AuthHttpError('AUTH_UNAVAILABLE', 503);
  if (error && !context.authorization) context.clearSession();
  return { db: context.db, user: error ? null : data.user, apply: context.apply };
}
function objectInput(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(x => !keys.includes(x))) throw new AuthHttpError('INVALID_INPUT', 422);
  return value as Record<string, unknown>;
}
function emailInput(value: unknown): string {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) throw new AuthHttpError('INVALID_INPUT', 422);
  return value.trim().toLowerCase();
}
export async function sessionHandler(request: Request): Promise<Response> {
  try {
    const auth = await requestAuth(request);
    return auth.apply(authJson({ data: { user: auth.user ? { id: auth.user.id, email: auth.user.email ?? null } : null, providers: { email: true, google: authEnvironment().DIMA_GOOGLE_ENABLED === 'true' } } }));
  } catch (error) { return authFailure(error); }
}
export async function authMutationHandler(request: Request, action: 'otp' | 'verify' | 'google' | 'logout'): Promise<Response> {
  let context: ReturnType<typeof authContext> | undefined;
  try {
    // Login/logout always use same-origin cookies; no bearer fallback for these endpoints.
    if (request.headers.get('origin') !== appOrigin() || request.headers.has('authorization')) throw new AuthHttpError('ORIGIN_NOT_ALLOWED', 403);
    const body = objectInput(await readJson(request), action === 'logout' ? [] : action === 'google' ? ['next'] : action === 'otp' ? ['email', 'next'] : ['email', 'token', 'next']);
    context = authContext(request);
    const next = safeNext(body.next);
    if (action === 'logout') {
      const { error } = await context.db.auth.signOut({ scope: 'local' });
      context.clearCookies();
      return context.apply(authJson({ data: { signedOut: true, serverRevoked: !error } }));
    }
    if (action === 'google') {
      if (authEnvironment().DIMA_GOOGLE_ENABLED !== 'true') throw new AuthHttpError('PROVIDER_UNAVAILABLE', 503);
      context.setReturn(next);
      const { data, error } = await context.db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${context.origin}/auth/callback`, skipBrowserRedirect: true } });
      if (error || !data.url) throw new AuthHttpError('SIGN_IN_UNAVAILABLE', 503);
      return context.apply(authJson({ data: { url: data.url } }));
    }
    const email = emailInput(body.email);
    if (action === 'otp') {
      const { error } = await context.db.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: `${context.origin}/auth/callback` } });
      if (error) throw new AuthHttpError(error.status === 429 ? 'RATE_LIMITED' : 'CODE_SEND_FAILED', error.status === 429 ? 429 : 503);
      // OTP is verified by code entry. No provider redirect is needed for the email flow.
      return context.apply(authJson({ data: { sent: true } }));
    }
    if (typeof body.token !== 'string' || !/^\d{6,10}$/.test(body.token)) throw new AuthHttpError('INVALID_INPUT', 422);
    const { data, error } = await context.db.auth.verifyOtp({ email, token: body.token, type: 'email' });
    if (error?.status === 429) throw new AuthHttpError('RATE_LIMITED', 429);
    if (error || !data.session || !data.user) throw new AuthHttpError(temporaryAuthFailure(error) ? 'AUTH_UNAVAILABLE' : 'CODE_INVALID_OR_EXPIRED', temporaryAuthFailure(error) ? 503 : 401);
    context.clearVerifier();
    return context.apply(authJson({ data: { next } }));
  } catch (error) {
    if (action === 'logout' && context) context.clearCookies();
    return context ? context.apply(authFailure(error)) : authFailure(error);
  }
}
export async function callbackHandler(request: Request): Promise<Response> {
  let context: ReturnType<typeof authContext> | undefined;
  try {
    context = authContext(request);
    const query = new URL(request.url).searchParams;
    const code = query.get('code');
    if (query.has('error') || !code || code.length > 4096) throw new AuthHttpError('CALLBACK_FAILED', 401);
    const { error, data } = await context.db.auth.exchangeCodeForSession(code);
    if (error || !data.user) throw new AuthHttpError('CALLBACK_FAILED', 401);
    const response = new Response(null, { status: 303, headers: { Location: `${context.origin}${context.returnTo}` } });
    context.clearCookies(false); context.clearVerifier();
    return context.apply(response);
  } catch {
    if (!context) return authFailure(new AuthHttpError('SERVICE_NOT_CONFIGURED', 503));
    const location = new URL('/auth', context.origin);
    location.searchParams.set('error', 'callback_failed'); location.searchParams.set('next', context.returnTo);
    context.clearCookies(false); context.clearVerifier();
    return context.apply(new Response(null, { status: 303, headers: { Location: location.toString() } }));
  }
}
