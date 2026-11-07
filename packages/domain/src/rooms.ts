import type { RoomPhase, RoomPresetId, RoomRun } from '../../contracts/src/rooms';
import { ROOM_CONNECTED_SECONDS, ROOM_HOST_ABSENCE_SECONDS, ROOM_LEASE_SECONDS, ROOM_PRESETS } from '../../contracts/src/room-policy';

export function runDurationSeconds(presetId: RoomPresetId): number {
  const preset = ROOM_PRESETS[presetId];
  return (preset.focusMinutes * 4 + preset.shortBreakMinutes * 3 + preset.longBreakMinutes) * 60;
}
export function roundBounds(startedAt: string, presetId: RoomPresetId, roundIndex: number): { startsAt: string; endsAt: string } {
  if (!Number.isInteger(roundIndex) || roundIndex < 1 || roundIndex > 4) throw new RangeError('Round must be between 1 and 4.');
  const preset = ROOM_PRESETS[presetId];
  const start = Date.parse(startedAt) + (roundIndex - 1) * (preset.focusMinutes + preset.shortBreakMinutes) * 60_000;
  return { startsAt: new Date(start).toISOString(), endsAt: new Date(start + preset.focusMinutes * 60_000).toISOString() };
}
/** Display projection only. Server commands independently validate the current immutable Run. */
export function roomPhaseAt(run: RoomRun | null, serverNow: number): RoomPhase {
  if (!run) return { kind: 'lobby', roundIndex: null, startsAt: null, endsAt: null, secondsRemaining: 0 };
  if (run.status === 'cancelled') return { kind: 'cancelled', roundIndex: null, startsAt: run.startedAt, endsAt: run.cancelledAt, secondsRemaining: 0 };
  if (run.status === 'completed' || serverNow >= Date.parse(run.plannedEndAt)) return { kind: 'completed', roundIndex: null, startsAt: run.startedAt, endsAt: run.plannedEndAt, secondsRemaining: 0 };
  const preset = ROOM_PRESETS[run.presetId];
  let cursor = Date.parse(run.startedAt);
  for (let round = 1; round <= 4; round++) {
    const focusEnd = cursor + preset.focusMinutes * 60_000;
    if (serverNow < focusEnd) return { kind: 'focus', roundIndex: round, startsAt: new Date(cursor).toISOString(), endsAt: new Date(focusEnd).toISOString(), secondsRemaining: Math.max(0, (focusEnd - serverNow) / 1000) };
    const breakEnd = focusEnd + (round === 4 ? preset.longBreakMinutes : preset.shortBreakMinutes) * 60_000;
    if (serverNow < breakEnd) return { kind: round === 4 ? 'longBreak' : 'shortBreak', roundIndex: round, startsAt: new Date(focusEnd).toISOString(), endsAt: new Date(breakEnd).toISOString(), secondsRemaining: (breakEnd - serverNow) / 1000 };
    cursor = breakEnd;
  }
  return { kind: 'completed', roundIndex: null, startsAt: run.startedAt, endsAt: run.plannedEndAt, secondsRemaining: 0 };
}
export function presenceAt(lastSeenAt: string, serverNow: number): 'connected' | 'reconnecting' | 'expired' {
  const age = (serverNow - Date.parse(lastSeenAt)) / 1000;
  return age >= ROOM_LEASE_SECONDS ? 'expired' : age >= ROOM_CONNECTED_SECONDS ? 'reconnecting' : 'connected';
}
/** Advisory display deadline; server capability/claim decision is authoritative. */
export function hostClaimAt(lastSeenAt: string): string {
  return new Date(Date.parse(lastSeenAt) + ROOM_HOST_ABSENCE_SECONDS * 1000).toISOString();
}
