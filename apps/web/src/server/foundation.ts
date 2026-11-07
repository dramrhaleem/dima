import { createClient } from '@supabase/supabase-js';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { createCheckSchema } from '@dima/contracts';

type Environment = { DIMA_B0_ENABLED?: string; SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string; DIMA_CLIENT_ORIGINS?: string };
export function environment(): Environment {
  try { return getCloudflareContext().env as Environment; }
  catch { return process.env as Environment; }
}

const json = (data: unknown, status: number, headers: Record<string, string>) => Response.json(data, { status, headers });
const failure = (code: string, status: number, headers: Record<string, string>) => json({ error: { code } }, status, headers);

export async function foundationHandler(request: Request, env = environment()): Promise<Response> {
  const headers: Record<string, string> = { 'Cache-Control': 'private, no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' };
  if (env.DIMA_B0_ENABLED !== 'true') return failure('NOT_FOUND', 404, headers);
  const origin = request.headers.get('origin');
  const allowed = (env.DIMA_CLIENT_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (origin && origin !== new URL(request.url).origin && !allowed.includes(origin)) return failure('ORIGIN_NOT_ALLOWED', 403, headers);
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' } });
  }
  if (!['GET', 'POST'].includes(request.method)) return failure('METHOD_NOT_ALLOWED', 405, headers);
  const authorization = request.headers.get('authorization');
  if (!authorization || !/^Bearer [A-Za-z0-9._-]{20,4096}$/.test(authorization)) return failure('AUTH_REQUIRED', 401, headers);
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return failure('SERVICE_NOT_CONFIGURED', 503, headers);
  const token = authorization.slice(7);
  try {
    const db = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authorization }, fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }) },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: identity, error: authError } = await db.auth.getUser(token);
    if (authError || !identity.user) return failure('AUTH_REQUIRED', 401, headers);
    if (request.method === 'GET') {
      const { data, error } = await db.from('foundation_checks').select('id,owner_id,label,created_at').order('created_at', { ascending: false }).limit(20);
      if (error) return failure('STORAGE_UNAVAILABLE', 503, headers);
      return json({ data }, 200, headers);
    }
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return failure('JSON_REQUIRED', 415, headers);
    // Bound streamed input too; Content-Length is not trusted.
    const reader = request.body?.getReader();
    if (!reader) return failure('INVALID_INPUT', 422, headers);
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 2048) { await reader.cancel(); return failure('BODY_TOO_LARGE', 413, headers); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { return failure('INVALID_JSON', 400, headers); }
    const parsed = createCheckSchema.safeParse(raw);
    if (!parsed.success) return failure('INVALID_INPUT', 422, headers);
    const { data, error } = await db.from('foundation_checks').insert({ label: parsed.data.label, owner_id: identity.user.id }).select('id,owner_id,label,created_at').single();
    if (error) return failure('STORAGE_UNAVAILABLE', 503, headers);
    return json({ data }, 201, headers);
  } catch {
    return failure('TEMPORARILY_UNAVAILABLE', 503, headers);
  }
}
