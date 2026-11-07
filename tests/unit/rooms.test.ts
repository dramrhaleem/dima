import { describe, expect, it } from 'vitest';
import type { RoomRun } from '../../packages/contracts/src/rooms';
import { roomCommandSchema } from '../../packages/contracts/src/rooms';
import { hostClaimAt, presenceAt, roomPhaseAt, roundBounds, runDurationSeconds } from '../../packages/domain/src/rooms';
const start = '2026-11-01T00:00:00.000Z';
const epoch = Date.parse(start);
const at = (minutes: number) => epoch + minutes * 60_000;
const run: RoomRun = { id: 'run', status: 'active', presetId: 'classic', startedAt: start, plannedEndAt: new Date(at(130)).toISOString(), completedAt: null, cancelledAt: null };
const id = '068d50a4-c954-4eda-8607-4353aa7b705c';

describe('B5 immutable room phase and consent policy', () => {
  it('RF03 late entry sees exactly remaining seven minutes', () => {
    const phase = roomPhaseAt(run, at(18));
    expect(phase.kind).toBe('focus');
    expect(phase.secondsRemaining).toBe(420);
    expect(roundBounds(start, 'classic', 1).endsAt).toBe(new Date(at(25)).toISOString());
  });
  it('RF05 exact focus boundary enters break, not another focus interval', () => {
    expect(roomPhaseAt(run, at(25))).toMatchObject({ kind: 'shortBreak', roundIndex: 1, secondsRemaining: 300 });
    expect(roomPhaseAt(run, at(30))).toMatchObject({ kind: 'focus', roundIndex: 2, secondsRemaining: 1500 });
  });
  it('RF17 four rounds include final long break and stop without another run', () => {
    expect(roomPhaseAt(run, at(115))).toMatchObject({ kind: 'longBreak', roundIndex: 4, secondsRemaining: 900 });
    expect(roomPhaseAt(run, at(130))).toMatchObject({ kind: 'completed', secondsRemaining: 0 });
    expect(roomPhaseAt(run, at(999))).toMatchObject({ kind: 'completed', secondsRemaining: 0 });
    expect(runDurationSeconds('classic')).toBe(7800);
    expect(runDurationSeconds('deep')).toBe(15000);
  });
  it('all exact phase boundaries are deterministic across daylight-saving transitions', () => {
    for (let round = 1; round <= 4; round++) {
      const bounds = roundBounds('2026-11-01T01:30:00-04:00', 'deep', round);
      expect(Date.parse(bounds.endsAt) - Date.parse(bounds.startsAt)).toBe(50 * 60_000);
    }
  });
  it('RF19 lease categories change at90and180seconds without creating time', () => {
    expect(presenceAt(start, epoch + 89_999)).toBe('connected');
    expect(presenceAt(start, epoch + 90_000)).toBe('reconnecting');
    expect(presenceAt(start, epoch + 179_999)).toBe('reconnecting');
    expect(presenceAt(start, epoch + 180_000)).toBe('expired');
    expect(hostClaimAt(start)).toBe(new Date(epoch + 120_000).toISOString());
  });
  it('suspended/cancelled run cannot project a continuing focus phase', () => {
    expect(roomPhaseAt({ ...run, status: 'cancelled', cancelledAt: new Date(at(7)).toISOString() }, at(8))).toMatchObject({ kind: 'cancelled', secondsRemaining: 0 });
  });
  it('creation requires explicit appearance consent and rejects public URLs/markup', () => {
    const command = { type: 'create', operationId: id, expectedRevision: 0, deviceId: id, title: 'Quiet reading', description: '', language: 'en', topic: 'Reading', offeringId: null, presetId: 'classic', acknowledgeVisibility: true, visibilityVersion: 1 };
    expect(roomCommandSchema.safeParse(command).success).toBe(true);
    expect(roomCommandSchema.safeParse({ ...command, acknowledgeVisibility: false }).success).toBe(false);
    expect(roomCommandSchema.safeParse({ ...command, description: 'https://example.com' }).success).toBe(false);
    expect(roomCommandSchema.safeParse({ ...command, title: '<script>bad</script>' }).success).toBe(false);
    expect(roomCommandSchema.safeParse({ ...command, ownerId: id }).success).toBe(false);
  });
  it('JoinRound requires explicit run/round and time revision, not page presence alone', () => {
    expect(roomCommandSchema.safeParse({ type: 'joinRound', operationId: id, expectedRevision: 1, roomId: id, deviceId: id, controlVersion: 1 }).success).toBe(false);
  });
});
