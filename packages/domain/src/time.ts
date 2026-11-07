import type { TimeInterval, TimeSession } from '../../contracts/src/time';

/** A display estimate anchored to server time and a monotonic browser clock. Never ledger input. */
export function projectedServerTime(serverTime: string, receivedMonotonic: number, nowMonotonic: number): number {
  return Date.parse(serverTime) + Math.max(0, nowMonotonic - receivedMonotonic);
}
export function activeInterval(sessionId: string, intervals: TimeInterval[]): TimeInterval | null {
  return intervals.find(interval => interval.sessionId === sessionId && interval.endAt === null) ?? null;
}
export function intervalSeconds(interval: TimeInterval, serverNow: number): number {
  const end = Math.min(Date.parse(interval.effectiveEndAt ?? interval.endAt ?? new Date(serverNow).toISOString()), Date.parse(interval.boundaryAt));
  return Math.max(0, (end - Date.parse(interval.startAt)) / 1000);
}
export function sessionSeconds(sessionId: string, intervals: TimeInterval[], serverNow: number): number {
  return intervals.filter(interval => interval.sessionId === sessionId).reduce((seconds, interval) => seconds + intervalSeconds(interval, serverNow), 0);
}
export function remainingFocusSeconds(session: TimeSession, intervals: TimeInterval[], serverNow: number): number | null {
  if (session.status === 'finalized' || session.status === 'needsReview') return 0;
  if (session.mode === 'room' && session.roomDeadlineAt) return Math.max(0, (Date.parse(session.roomDeadlineAt) - serverNow) / 1000);
  if (session.status === 'paused') return session.remainingSeconds;
  const interval = activeInterval(session.id, intervals);
  return interval ? Math.max(0, (Date.parse(interval.boundaryAt) - serverNow) / 1000) : session.remainingSeconds;
}
export function breakSeconds(session: TimeSession): number {
  if (session.mode !== 'solo' || !session.settings) return 0;
  return (session.roundIndex % session.settings.longBreakAfter === 0 ? session.settings.longBreakMinutes : session.settings.shortBreakMinutes) * 60;
}
export function breakRemainingSeconds(session: TimeSession, serverNow: number): number {
  if (session.status !== 'finalized' || !session.finalizedAt) return 0;
  return Math.max(0, (Date.parse(session.finalizedAt) + breakSeconds(session) * 1000 - serverNow) / 1000);
}
export function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return endA > startA && endB > startB && startA < endB && startB < endA;
}
/** UTC window attribution; round only after summing all accepted segments. */
export function splitAtUtcDays(startAt: string, endAt: string): { day: string; seconds: number }[] {
  let cursor = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (!Number.isFinite(cursor) || !Number.isFinite(end) || end <= cursor) return [];
  const segments: { day: string; seconds: number }[] = [];
  while (cursor < end) {
    const nextMidnight = Math.floor(cursor / 86_400_000) * 86_400_000 + 86_400_000;
    const next = Math.min(end, nextMidnight);
    segments.push({ day: new Date(cursor).toISOString().slice(0, 10), seconds: (next - cursor) / 1000 });
    cursor = next;
  }
  return segments;
}
