import { describe, expect, it } from 'vitest';
import type { TimeInterval, TimeSession } from '../../packages/contracts/src/time';
import { timeCommandSchema } from '../../packages/contracts/src/time';
import { activeInterval, breakRemainingSeconds, breakSeconds, intervalSeconds, projectedServerTime, rangesOverlap, remainingFocusSeconds, sessionSeconds, splitAtUtcDays } from '../../packages/domain/src/time';
const epoch = Date.parse('2026-10-31T20:00:00Z');
const at = (seconds: number) => new Date(epoch + seconds * 1000).toISOString();
const id = 'a13b16cf-aa82-49a2-b68c-4e47bff2aeae';
const settings = { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakAfter: 4 };
const session = (patch: Partial<TimeSession> = {}): TimeSession => ({ id, mode: 'solo', category: 'learning', status: 'running', title: 'Read', enrollmentId: null, taskId: null, createdAt: at(0), finalizedAt: null, revision: 1, deviceId: id, controlVersion: 1, leaseUntil: at(90), remainingSeconds: 1500, settings, roundIndex: 1, previousSessionId: null, roomId: null, participationId: null, ...patch });
const interval = (patch: Partial<TimeInterval> = {}): TimeInterval => ({ id, sessionId: id, startAt: at(0), endAt: null, boundaryAt: at(1500), effectiveEndAt: null, source: 'server', eligibility: 'eligible', deviceId: id, controlVersion: 1, createdAt: at(0), ...patch });

describe('B4 time display and boundary policy', () => {
  it('TM02 never displays extra focus after stored Pomodoro boundary', () => {
    expect(intervalSeconds(interval(), epoch + 8 * 3600_000)).toBe(1500);
    expect(remainingFocusSeconds(session(), [interval()], epoch + 8 * 3600_000)).toBe(0);
  });
  it('TM03 open interval display is capped at four hours', () => {
    expect(intervalSeconds(interval({ boundaryAt: at(14400) }), epoch + 24 * 3600_000)).toBe(14400);
    expect(remainingFocusSeconds(session({ mode: 'open', status: 'needsReview' }), [], epoch)).toBe(0);
  });
  it('paused solo keeps the server remaining value independent of wall-clock delay', () => {
    expect(remainingFocusSeconds(session({ status: 'paused', remainingSeconds: 812.25 }), [interval({ endAt: at(687.75) })], epoch + 86400_000)).toBe(812.25);
  });
  it('RF04 paused Room countdown continues to its fixed round deadline', () => {
    const paused = session({ mode: 'room', status: 'paused', roomDeadlineAt: at(1500), remainingSeconds: 1000 });
    expect(remainingFocusSeconds(paused, [], epoch + 1400_000)).toBe(100);
    expect(remainingFocusSeconds(paused, [], epoch + 1501_000)).toBe(0);
  });
  it('TM05 correction affects only its interval; previous valid periods remain intact', () => {
    const intervals = [interval({ endAt: at(600) }), interval({ id: 'second', startAt: at(900), endAt: at(1500), effectiveEndAt: at(1200), eligibility: 'personal' })];
    expect(sessionSeconds(id, intervals, epoch + 2000_000)).toBe(900);
    expect(intervals[0].eligibility).toBe('eligible');
  });
  it('sums fractional seconds before rounding, without per-pause minute loss', () => {
    const intervals = [interval({ endAt: at(29.6) }), interval({ startAt: at(30), endAt: at(60.4) })];
    expect(sessionSeconds(id, intervals, epoch + 100_000)).toBe(60);
  });
  it('break duration depends on completed round and never contributes focus seconds', () => {
    const done = session({ status: 'finalized', finalizedAt: at(1500), roundIndex: 4 });
    expect(breakSeconds(done)).toBe(900);
    expect(breakRemainingSeconds(done, epoch + 1800_000)).toBe(600);
    expect(sessionSeconds(id, [interval({ endAt: at(1500) })], epoch + 1800_000)).toBe(1500);
    expect(breakRemainingSeconds(done, epoch + 5000_000)).toBe(0);
  });
  it('a monotonic display anchor ignores browser wall-clock changes', () => {
    expect(projectedServerTime(at(0), 100, 5100)).toBe(epoch + 5000);
    expect(projectedServerTime(at(0), 100, 0)).toBe(epoch);
  });
  it('TM07 half-open intervals allow adjacent time but reject overlap and ignore empty spans', () => {
    expect(rangesOverlap(0, 60, 60, 120)).toBe(false);
    expect(rangesOverlap(0, 60, 59.99, 120)).toBe(true);
    expect(rangesOverlap(0, 60, 30, 30)).toBe(false);
  });
  it('splits UTC dates exactly with fractional seconds and DST-independent attribution', () => {
    expect(splitAtUtcDays('2026-10-31T23:59:59.750Z', '2026-11-01T00:00:00.250Z')).toEqual([{ day: '2026-10-31', seconds: 0.25 }, { day: '2026-11-01', seconds: 0.25 }]);
    expect(splitAtUtcDays('2026-11-01T01:30:00-04:00', '2026-11-01T01:30:00-05:00')).toEqual([{ day: '2026-11-01', seconds: 3600 }]);
  });
  it('selects only the open interval of the requested session', () => {
    const current = interval({ id: 'current', startAt: at(60) });
    expect(activeInterval(id, [interval({ endAt: at(30) }), current])).toBe(current);
    expect(activeInterval('other', [current])).toBe(null);
  });
  it('requires exact stop identity and explicit personal confirmation', () => {
    const originalCommand = { type: 'finish', operationId: id, expectedRevision: 1, sessionId: id, deviceId: id, controlVersion: 1, intervalId: id };
    const command = { type: 'offlineStop', operationId: id, expectedRevision: 2, originalCommand, reportedEndAt: at(20), confirmPersonal: true };
    expect(timeCommandSchema.safeParse(command).success).toBe(true);
    expect(timeCommandSchema.safeParse({ ...command, confirmPersonal: false }).success).toBe(false);
    expect(timeCommandSchema.safeParse({ ...command, userId: id }).success).toBe(false);
  });
  it('rejects invalid Pomodoro settings and client-supplied authoritative timestamps', () => {
    const command = { type: 'start', operationId: id, expectedRevision: 0, deviceId: id, mode: 'solo', category: 'work', title: '', enrollmentId: null, taskId: null, settings, previousSessionId: null };
    expect(timeCommandSchema.safeParse(command).success).toBe(true);
    expect(timeCommandSchema.safeParse({ ...command, settings: { ...settings, focusMinutes: 4 } }).success).toBe(false);
    expect(timeCommandSchema.safeParse({ ...command, startedAt: at(-3600) }).success).toBe(false);
  });
});
