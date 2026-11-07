import { describe, expect, it } from 'vitest';
import type { TimeData, TimeInterval, TimeSession } from '../../packages/contracts/src/time';
import { completedRoundSignal, crossedDeadline } from '../../packages/ui/src/focus-signals';
const start = Date.parse('2026-11-01T12:00:00Z');
const at = (seconds: number) => new Date(start + seconds * 1000).toISOString();
const session: TimeSession = { id: 'round', mode: 'solo', category: 'learning', status: 'running', title: 'Read', enrollmentId: null, taskId: null, createdAt: at(0), finalizedAt: null, revision: 1, deviceId: 'tab', controlVersion: 1, leaseUntil: at(1800), remainingSeconds: 1500, settings: { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakAfter: 4 }, roundIndex: 1, previousSessionId: null, roomId: null, participationId: null };
const interval: TimeInterval = { id: 'interval', sessionId: 'round', startAt: at(0), endAt: at(1500), boundaryAt: at(1500), effectiveEndAt: null, source: 'server', eligibility: 'eligible', deviceId: 'tab', controlVersion: 1, createdAt: at(0) };
const data: TimeData = { accountId: 'account', revision: 2, serverTime: at(1501), active: null, sessions: [{ ...session, status: 'finalized', finalizedAt: at(1500) }], intervals: [interval], corrections: [], totals: { eligibleSeconds: 1500, personalSeconds: 0, pendingSeconds: 0 }, nextCursor: null };
describe('notifications follow actual timer outcomes', () => {
  it('only a previously observed running solo round can report a natural boundary', () => {
    expect(completedRoundSignal(session, data)).toEqual({ key: 'focus:round', occurredAt: start + 1500000, now: start + 1501000 });
    expect(completedRoundSignal(null, data)).toBeNull();
    expect(completedRoundSignal({ ...session, mode: 'room' }, data)).toBeNull();
    expect(completedRoundSignal({ ...session, status: 'paused' }, data)).toBeNull();
    expect(completedRoundSignal(session, { ...data, sessions: [] })).toBeNull();
  });
  it('manual finishes and early presence expiry do not announce a completed Pomodoro', () => {
    for (const seconds of [60, 180]) expect(completedRoundSignal(session, { ...data, intervals: [{ ...interval, endAt: at(seconds) }] })).toBeNull();
  });
  it('uses the actual boundary, not a late reconciliation time, for stale-event filtering', () => {
    const late = completedRoundSignal(session, { ...data, serverTime: at(3600), sessions: [{ ...data.sessions[0], finalizedAt: at(3600) }] });
    expect(late?.occurredAt).toBe(start + 1500000);
    expect(late?.now).toBe(start + 3600000);
  });
  it('a break must cross its end while observed; initial or historic rendering is silent', () => {
    expect(crossedDeadline(99, 100, 100)).toBe(true);
    expect(crossedDeadline(0, 100, 100)).toBe(false);
    expect(crossedDeadline(100, 101, 100)).toBe(false);
    expect(crossedDeadline(99, 99, 100)).toBe(false);
    expect(crossedDeadline(99, 100, null)).toBe(false);
  });
});
