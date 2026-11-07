import type { RoomRealtimeGrant } from '@dima/contracts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** Server-only capability. It deliberately cannot identify an Auth user. */
export async function signRoomRealtimeToken(grant: RoomRealtimeGrant, secret: string, nowMs = Date.now()) {
  const issuedAt = Math.floor(nowMs / 1000);
  const expires = Math.min(issuedAt + 120, Math.floor(Date.parse(grant.seatExpiresAt) / 1000));
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expires) || expires <= issuedAt
    || !uuid.test(grant.roomId) || !uuid.test(grant.membershipId)
    || grant.topic !== `room:${grant.roomId}`
    || !Number.isSafeInteger(grant.generation) || grant.generation < 1) {
    throw new Error('Invalid or expired room capability');
  }
  if (secret.length < 32) throw new Error('Realtime signing is not configured');
  const claims = {
    role: 'anon', aud: 'realtime', iss: 'dima-room-realtime', jti: crypto.randomUUID(), iat: issuedAt, exp: expires,
    dima_room_id: grant.roomId, dima_membership_id: grant.membershipId, dima_generation: grant.generation,
  };
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return { token: `${body}.${Buffer.from(signature).toString('base64url')}`, expiresAt: new Date(expires * 1000).toISOString() };
}
