import { createClient } from '@supabase/supabase-js';
import { ApiError, checksResponseSchema, createCheckResponseSchema, createCheckSchema, healthSchema, type FoundationConfig } from '@dima/contracts';
import type { SocialCommand, PublicationCommand } from '@dima/contracts';

/** Cookie-authenticated web client; the account header prevents cross-account writes. */
export function createCommunityClient(owner: string) {
  async function request<T>(path: string, signal: AbortSignal, command?: SocialCommand | PublicationCommand): Promise<T> {
    const response = await fetch(`/api/v1${path}`, {
      method: command ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal,
      headers: { 'X-Dima-Account-Id': owner, ...(command ? { 'Content-Type': 'application/json' } : {}) },
      body: command ? JSON.stringify(command) : undefined,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(payload?.error?.code ?? 'REQUEST_FAILED', response.status);
    if (payload?.data?.accountId && payload.data.accountId !== owner) throw new ApiError('ACCOUNT_CHANGED', 409);
    return payload.data as T;
  }
  return { read: <T>(path: string, signal: AbortSignal) => request<T>(path, signal), command: <T>(path: string, command: SocialCommand | PublicationCommand, signal: AbortSignal) => request<T>(path, signal, command) };
}

export function createFoundationClient(config: FoundationConfig) {
  // B0 only: session is memory-only. Native secure persistence is an M0 gate.
  const authClient = createClient(config.supabaseUrl, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  let token: string | undefined;
  const base = config.apiBaseUrl.replace(/\/$/, '');

  async function request(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(`${base}/api/v1${path}`, {
      method,
      credentials: 'omit',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new ApiError(typeof payload?.error?.code === 'string' ? payload.error.code : 'REQUEST_FAILED', response.status);
    }
    return response.json();
  }

  return {
    async health() { return healthSchema.parse(await request('/health')); },
    async authenticate(email: string, password: string, signup: boolean) {
      token = undefined;
      const { data, error } = signup
        ? await authClient.auth.signUp({ email, password })
        : await authClient.auth.signInWithPassword({ email, password });
      if (error || !data.session) throw new ApiError('SIGN_IN_FAILED', 401);
      token = data.session.access_token;
    },
    async list() { return checksResponseSchema.parse(await request('/foundation/checks')).data; },
    async save(label: string) { return createCheckResponseSchema.parse(await request('/foundation/checks', 'POST', createCheckSchema.parse({ label }))).data; },
    async signOut() {
      token = undefined;
      // Always clear local state; a failed network logout is surfaced to the caller.
      const { error } = await authClient.auth.signOut({ scope: 'local' });
      if (error) throw new ApiError('SIGN_OUT_FAILED', 503);
    },
  };
}

export * from './milestones';
export * from './profile-settings';
