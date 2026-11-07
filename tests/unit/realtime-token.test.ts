import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signRoomRealtimeToken } from '../../apps/web/src/server/realtime-token';

const now = Date.parse('2026-11-01T10:00:00.000Z');
const roomId = '10000000-0000-4000-8000-000000000001';
const grant = { roomId, membershipId: '20000000-0000-4000-8000-000000000002', generation: 3, topic: `room:${roomId}`, seatExpiresAt: '2026-11-01T10:03:00.000Z' };
const secret = 'test-only-realtime-secret-never-used-by-a-service';

describe('room receive capability', () => {
  it('is signed independently verifiably, expires in two minutes and has no user identity or authenticated role', async () => {
    const result = await signRoomRealtimeToken(grant, secret, now);
    const [header, body, signature] = result.token.split('.');
    expect(createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')).toBe(signature);
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
    expect(claims).toMatchObject({ role: 'anon', aud: 'realtime', iss: 'dima-room-realtime', iat: now / 1000, exp: now / 1000 + 120, dima_room_id: roomId, dima_membership_id: grant.membershipId, dima_generation: 3 });
    expect(typeof claims.jti).toBe('string');
    expect(claims).not.toHaveProperty('sub');
    expect(Object.keys(claims).sort()).toEqual(['role', 'aud', 'iss', 'iat', 'exp', 'jti', 'dima_room_id', 'dima_membership_id', 'dima_generation'].sort());
    expect(result.expiresAt).toBe('2026-11-01T10:02:00.000Z');
    expect((await signRoomRealtimeToken(grant, secret, now)).token).not.toBe(result.token);
  });
  it('never outlives the membership lease, including subsecond boundaries', async () => {
    const result = await signRoomRealtimeToken({ ...grant, seatExpiresAt: '2026-11-01T10:00:12.900Z' }, secret, now);
    expect(result.expiresAt).toBe('2026-11-01T10:00:12.000Z');
  });
  it.each([
    { seatExpiresAt: '2026-11-01T10:00:00.000Z' }, { seatExpiresAt: 'invalid' },
    { topic: 'room:other' }, { roomId: 'not-a-uuid' }, { membershipId: 'invalid' },
    { generation: 0 }, { generation: 1.5 },
  ])('refuses malformed or expired grants: %j', async (change) => {
    await expect(signRoomRealtimeToken({ ...grant, ...change }, secret, now)).rejects.toThrow('Invalid or expired');
  });
  it('does not sign with an absent or weak configuration', async () => {
    await expect(signRoomRealtimeToken(grant, '', now)).rejects.toThrow('not configured');
  });
});
