import type { RoomHint, RoomRealtimeCredentials, RoomRealtimeGrant } from '@dima/contracts';
import { AuthHttpError } from './auth';
import { environment } from './foundation';
import { signRoomRealtimeToken } from './realtime-token';

type RealtimeEnvironment = { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string; SUPABASE_SERVICE_ROLE_KEY?: string; DIMA_REALTIME_SIGNING_SECRET?: string };

/** The caller obtains this grant from the authorized database RPC, never request JSON. */
export async function issueRoomRealtimeToken(grant: RoomRealtimeGrant): Promise<RoomRealtimeCredentials> {
  const env = environment() as RealtimeEnvironment;
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.DIMA_REALTIME_SIGNING_SECRET) {
    throw new AuthHttpError('REALTIME_UNAVAILABLE', 503);
  }
  try {
    const signed = await signRoomRealtimeToken(grant, env.DIMA_REALTIME_SIGNING_SECRET);
    return { ...signed, topic: grant.topic, url: `${env.SUPABASE_URL.replace(/\/$/, '')}/realtime/v1`, anonKey: env.SUPABASE_ANON_KEY };
  } catch {
    throw new AuthHttpError('REALTIME_UNAVAILABLE', 503);
  }
}

/** Server hint delivery. Durable callers acknowledge separately; live callers leave recovery pending. */
export async function publishRoomHint(topic: string, hint: RoomHint, signal?: AbortSignal): Promise<void> {
  const env = environment() as RealtimeEnvironment;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new AuthHttpError('REALTIME_UNAVAILABLE', 503);
  if (!/^room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(topic)) throw new Error('Invalid room topic');
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/realtime/v1/api/broadcast`, {
    method: 'POST', signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]),
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ topic, event: 'invalidate', private: true, payload: {
      version: hint.version, phase: hint.phase, count: { reserved: hint.count.reserved, connected: hint.count.connected },
    } }] }),
  });
  if (!response.ok) throw new Error(`Realtime delivery failed (${response.status})`);
}
