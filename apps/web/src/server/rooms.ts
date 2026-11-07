import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js';
import { roomCommandSchema, type RoomRealtimeGrant } from '@dima/contracts';
import { ROOM_LANGUAGES } from '@dima/contracts/room-policy';
import { apiPreflight, AuthHttpError, authFailure, authJson, mutationOriginAllowed, readJson, requestAuth } from './auth';
import { environment } from './foundation';
import { issueRoomRealtimeToken } from './realtime';
import { scheduleCommittedRoomHints } from './room-hint-live';

type RoomEnvironment = { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
type Action = 'directory' | 'options' | 'me' | 'detail' | 'snapshot' | 'realtime' | 'reports';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function roomDatabase(privileged = true): SupabaseClient {
  const env = environment() as RoomEnvironment;
  const key = privileged ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY;
  if (!env.SUPABASE_URL || !key) throw new AuthHttpError('SERVICE_NOT_CONFIGURED', 503);
  return createClient(env.SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15000) }) },
  });
}
function databaseFailure(error: PostgrestError): never {
  if (/^PT[4-5][0-9]{2}$/.test(error.code) && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message)) {
    throw new AuthHttpError(error.message, Number(error.code.slice(2)));
  }
  if (error.code === '23P01') throw new AuthHttpError('TIME_OVERLAP', 409);
  if (['23505', '40001', '40P01'].includes(error.code)) throw new AuthHttpError('RETRY_CONFLICT', 409);
  throw new AuthHttpError('STORAGE_UNAVAILABLE', 503);
}
function queryParameters(request: Request, action: Action) {
  const query = new URL(request.url).searchParams;
  const allowed = action === 'directory' ? ['q', 'language', 'offeringId', 'topic', 'cursor', 'limit']
    : action === 'me' ? ['roomId'] : action === 'reports' ? ['status', 'limit'] : [];
  if ([...query.keys()].some(key => !allowed.includes(key))) throw new AuthHttpError('INVALID_INPUT', 422);
  return query;
}
function directoryParameters(query: URLSearchParams) {
  const search = query.get('q')?.trim() || null;
  const language = query.get('language') || null;
  const offering = query.get('offeringId') || null;
  const topic = query.get('topic')?.trim() || null;
  const limit = Number(query.get('limit') ?? 20);
  const cursor = query.get('cursor')?.split('|');
  if ((search && search.length > 80) || (topic && topic.length > 80) || (offering && offering.length > 120) ||
      (language && !ROOM_LANGUAGES.some(item => item.id === language)) || !Number.isInteger(limit) || limit < 1 || limit > 50 ||
      (cursor && (cursor.length !== 2 || !Number.isFinite(Date.parse(cursor[0])) || !uuid.test(cursor[1])))) {
    throw new AuthHttpError('INVALID_INPUT', 422);
  }
  return { p_query: search, p_language: language, p_offering: offering, p_topic: topic, p_limit: limit,
    p_before: cursor?.[0] ?? null, p_before_id: cursor?.[1] ?? null };
}

export async function roomsHandler(request: Request, action: Action = 'directory', roomId?: string): Promise<Response> {
  const allowedMethods = action === 'directory' ? 'GET, POST, OPTIONS' : action === 'realtime' ? 'POST, OPTIONS' : 'GET, OPTIONS';
  if (request.method === 'OPTIONS') return apiPreflight(request, allowedMethods);
  let apply = (response: Response) => response;
  const started = performance.now();
  const durations: Record<string, number> = {};
  const localTiming = (() => {
    try {
      const local = ['127.0.0.1', 'localhost', '[::1]'];
      return local.includes(new URL(request.url).hostname)
        && local.includes(new URL((environment() as RoomEnvironment).SUPABASE_URL ?? '').hostname);
    } catch { return false; }
  })();
  async function measured<T>(name: string, operation: () => PromiseLike<T>): Promise<T> {
    const before = performance.now();
    try { return await operation(); }
    finally { if (localTiming) durations[name] = (durations[name] ?? 0) + performance.now() - before; }
  }
  function finish(makeResponse: () => Response): Response {
    const before = performance.now();
    const response = apply(makeResponse());
    if (localTiming) {
      durations.response = performance.now() - before;
      durations.total = performance.now() - started;
      response.headers.set('Server-Timing', Object.entries(durations).map(([name, duration]) => `${name};dur=${duration.toFixed(2)}`).join(', '));
    }
    return response;
  }
  try {
    if (!allowedMethods.split(', ').includes(request.method)) throw new AuthHttpError('METHOD_NOT_ALLOWED', 405);
    if (roomId && !uuid.test(roomId)) throw new AuthHttpError('INVALID_INPUT', 422);
    const query = queryParameters(request, action);
    const isPublic = request.method === 'GET' && ['directory', 'options', 'detail'].includes(action);
    if (isPublic) {
      const origin = request.headers.get('origin');
      const cors = origin ? apiPreflight(request, allowedMethods) : null;
      if (cors && cors.status !== 204) return cors;
      const db = roomDatabase(false);
      const name = action === 'directory' ? 'list_public_rooms' : action === 'options' ? 'read_room_options' : 'read_public_room';
      const parameters = action === 'directory' ? directoryParameters(query) : action === 'detail' ? { p_room: roomId } : {};
      const { data, error } = await measured('rpc', () => db.rpc(name, parameters));
      if (error) databaseFailure(error);
      if (data === null) throw new AuthHttpError('NOT_FOUND', 404);
      return finish(() => {
        const response = authJson({ data });
        if (origin && cors) response.headers.set('Access-Control-Allow-Origin', cors.headers.get('Access-Control-Allow-Origin')!);
        return response;
      });
    }
    if (request.method === 'POST' && !mutationOriginAllowed(request)) throw new AuthHttpError('ORIGIN_NOT_ALLOWED', 403);
    const auth = await measured('auth', () => requestAuth(request));
    apply = auth.apply;
    if (!auth.user) throw new AuthHttpError('AUTH_REQUIRED', 401);
    const actor = auth.user.id;
    const expectedAccount = request.headers.get('X-Dima-Account-Id');
    if (request.method === 'POST' && ((expectedAccount !== null && expectedAccount !== actor) || (!request.headers.get('authorization') && expectedAccount === null))) {
      throw new AuthHttpError('ACCOUNT_CHANGED', 409);
    }
    // Each private RPC checks onboarding inside its authoritative transaction.
    if (request.method === 'GET') {
      const requested = action === 'me' ? query.get('roomId') : roomId;
      if (requested && !uuid.test(requested)) throw new AuthHttpError('INVALID_INPUT', 422);
      const status = query.get('status') ?? 'open';
      const limit = Number(query.get('limit') ?? 30);
      if (action === 'reports' && (!['open', 'reviewed'].includes(status) || !Number.isInteger(limit) || limit < 1 || limit > 50)) throw new AuthHttpError('INVALID_INPUT', 422);
      const name = action === 'me' ? 'read_room_me' : action === 'snapshot' ? 'read_room_snapshot' : 'read_room_reports';
      const { data, error } = await measured('rpc', () => auth.db.rpc(name, action === 'reports' ? { p_status: status, p_limit: limit } : { p_room: requested ?? null }));
      if (error) databaseFailure(error);
      return finish(() => authJson({ data }));
    }
    const raw = await readJson(request, 12000);
    const db = roomDatabase();
    if (action === 'realtime') {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length) throw new AuthHttpError('INVALID_INPUT', 422);
      const { data, error } = await measured('rpc', () => db.rpc('read_room_realtime_grant', { p_actor: actor, p_room: roomId }));
      if (error) databaseFailure(error);
      const credentials = await measured('sign', () => issueRoomRealtimeToken(data as RoomRealtimeGrant));
      return finish(() => authJson({ data: credentials }));
    }
    const parsed = roomCommandSchema.safeParse(raw);
    if (!parsed.success) throw new AuthHttpError('INVALID_INPUT', 422);
    const command = parsed.data;
    const { data, error } = await measured('rpc', () => db.rpc('execute_room_command', { p_actor: actor, p_command: command }));
    if (error) databaseFailure(error);
    if (command.type !== 'renewPresence') {
      scheduleCommittedRoomHints(command, data);
    }
    return finish(() => authJson(data));
  } catch (error) {
    return finish(() => authFailure(error));
  }
}
