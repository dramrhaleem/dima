import type { TimeData, TimeSession } from '@dima/contracts';

/** A sound describes a confirmed natural finish, never a predicted or manual stop. */
export function completedRoundSignal(previous: TimeSession | null | undefined, data: TimeData) {
  if (!previous || previous.mode !== 'solo' || previous.status !== 'running') return null;
  const saved = data.sessions.find(session => session.id === previous.id && session.status === 'finalized');
  if (!saved?.finalizedAt) return null;
  const ends = data.intervals.filter(interval => interval.sessionId === saved.id && interval.endAt === interval.boundaryAt).map(interval => Date.parse(interval.boundaryAt));
  if (!ends.length) return null;
  return { key: `focus:${saved.id}`, occurredAt: Math.max(...ends), now: Date.parse(data.serverTime) };
}

/** Waiting on this countdown is required; opening old history never replays a chime. */
export function crossedDeadline(previousNow: number, now: number, deadline: number | null) {
  return !!deadline && previousNow > 0 && previousNow < deadline && now >= deadline;
}
