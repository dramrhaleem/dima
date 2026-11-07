import { createClient } from '@supabase/supabase-js';
import { timeCommandSchema, timeReceiptQuerySchema } from '@dima/contracts';
import { apiPreflight, AuthHttpError, authFailure, authJson, mutationOriginAllowed, readJson, requestAuth } from './auth';
import { environment } from './foundation';
import { dispatchRoomJobs, scheduleRoomHints } from './room-jobs';

type TimeEnvironment = { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string; DIMA_JOBS_TOKEN?: string };
function writer() {
  const env = environment() as TimeEnvironment;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new AuthHttpError('SERVICE_NOT_CONFIGURED', 503);
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15000) }) },
  });
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function historyParameters(request: Request) {
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some(key => !['sessionId', 'category', 'cursor', 'limit'].includes(key))) throw new AuthHttpError('INVALID_INPUT', 422);
  const sessionId = query.get('sessionId');
  const category = query.get('category');
  const limit = Number(query.get('limit') ?? 30);
  const cursor = query.get('cursor')?.split('|');
  if ((sessionId && !uuid.test(sessionId)) || (category && !['learning', 'work'].includes(category)) ||
      !Number.isInteger(limit) || limit < 1 || limit > 50 ||
      (cursor && (cursor.length !== 2 || !Number.isFinite(Date.parse(cursor[0])) || !uuid.test(cursor[1])))) {
    throw new AuthHttpError('INVALID_INPUT', 422);
  }
  return { p_session: sessionId, p_category: category, p_before: cursor?.[0] ?? null, p_before_id: cursor?.[1] ?? null, p_limit: limit };
}
export async function timeHandler(request: Request, receiptsOnly = false): Promise<Response> {
  if (request.method === 'OPTIONS') return apiPreflight(request, receiptsOnly ? 'POST, OPTIONS' : 'GET, POST, OPTIONS');
  let apply = (response: Response) => response;
  try {
    if (!['GET', 'POST'].includes(request.method) || (receiptsOnly && request.method !== 'POST')) throw new AuthHttpError('METHOD_NOT_ALLOWED', 405);
    if (request.method === 'POST' && !mutationOriginAllowed(request)) throw new AuthHttpError('ORIGIN_NOT_ALLOWED', 403);
    const auth = await requestAuth(request);
    apply = auth.apply;
    if (!auth.user) throw new AuthHttpError('AUTH_REQUIRED', 401);
    const actor = auth.user.id;
    const expectedAccount = request.headers.get('X-Dima-Account-Id');
    if (request.method === 'POST' && ((expectedAccount !== null && expectedAccount !== actor) || (!request.headers.get('authorization') && expectedAccount === null))) {
      throw new AuthHttpError('ACCOUNT_CHANGED', 409);
    }
    const { data: profile, error: profileError } = await auth.db.from('account_profiles').select('onboarded').eq('user_id', actor).maybeSingle();
    if (profileError) throw new AuthHttpError('STORAGE_UNAVAILABLE', 503);
    if (!profile?.onboarded) throw new AuthHttpError('ONBOARDING_REQUIRED', 409);
    const db = writer();
    if (request.method === 'GET') {
      const { data, error } = await db.rpc('read_time_state', { p_actor: actor, ...historyParameters(request) });
      if (error) throw new AuthHttpError(error.code === 'PT404' ? 'NOT_FOUND' : 'STORAGE_UNAVAILABLE', error.code === 'PT404' ? 404 : 503);
      return apply(authJson({ data }));
    }
    const raw = await readJson(request, 12000);
    const parsed = receiptsOnly ? timeReceiptQuerySchema.safeParse(raw) : timeCommandSchema.safeParse(raw);
    if (!parsed.success) throw new AuthHttpError('INVALID_INPUT', 422);
    const command = 'command' in parsed.data ? parsed.data.command : parsed.data;
    const { data, error } = await db.rpc(receiptsOnly ? 'read_time_receipt' : 'execute_time_command', { p_actor: actor, p_command: command });
    if (error) throw new AuthHttpError(error.code === '23P01' ? 'TIME_OVERLAP' : 'STORAGE_UNAVAILABLE', error.code === '23P01' ? 409 : 503);
    if (!data.error && !receiptsOnly && command.type !== 'renew') {
      scheduleRoomHints((data.data?.sessions ?? []).map((session: { roomId?: string | null }) => session.roomId));
    }
    return apply(authJson(data, data.error?.status ?? 200));
  } catch (error) {
    return apply(authFailure(error));
  }
}

/** Dedicated server secret. Public requests cannot pick accounts, jobs, timestamps or batches. */
export async function timeDispatchHandler(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') throw new AuthHttpError('METHOD_NOT_ALLOWED', 405);
    const token = (environment() as TimeEnvironment).DIMA_JOBS_TOKEN;
    if (!token) throw new AuthHttpError('SERVICE_NOT_CONFIGURED', 503);
    const actual = request.headers.get('authorization') ?? '';
    const expected = `Bearer ${token}`;
    let different = actual.length ^ expected.length;
    for (let index = 0; index < expected.length; index++) different |= (actual.charCodeAt(index) || 0) ^ expected.charCodeAt(index);
    if (different) throw new AuthHttpError('FORBIDDEN', 403);
    const raw = await readJson(request, 64);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length) throw new AuthHttpError('INVALID_INPUT', 422);
    const db = writer();
    const { data: jobs, error: claimError } = await db.rpc('claim_time_jobs', { p_limit: 10 });
    if (claimError) throw new AuthHttpError('STORAGE_UNAVAILABLE', 503);
    let completed = 0;
    let retried = 0;
    for (const job of jobs as { id: string; claimToken: string }[]) {
      const { data, error } = await db.rpc('execute_time_job', { p_job: job.id, p_claim: job.claimToken });
      if (error) {
        await db.rpc('fail_time_job', { p_job: job.id, p_claim: job.claimToken });
        retried++;
      } else if (data.status === 'done') completed++;
    }
    const { data: status, error: statusError } = await db.rpc('time_job_status');
    if (statusError) throw new AuthHttpError('STORAGE_UNAVAILABLE', 503);
    const roomResults = await dispatchRoomJobs(db);
    const { data: roomStatus, error: roomStatusError } = await db.rpc('room_job_status');
    if (roomStatusError) throw new AuthHttpError('STORAGE_UNAVAILABLE', 503);
    return authJson({ data: { claimed: jobs.length, completed, retried, ...status, ...roomResults, ...roomStatus } });
  } catch (error) {
    return authFailure(error);
  }
}
