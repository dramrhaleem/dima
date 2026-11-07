'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RoomCommand, RoomCommandResponse, RoomAccess, RoomMe, OwnRoomMembership, RoomPresetId, RoomRealtimeCredentials, RoomSnapshot } from '@dima/contracts';
import { useFocus, SessionStrip, type SoloStartAction } from './focus';
import { subscribeRoom } from '@dima/client/realtime';

export type RoomAction<T = RoomCommand> = T extends RoomCommand ? Omit<T, 'operationId' | 'expectedRevision'> : never;
export class RoomError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}
export function roomMessage(reason: unknown) {
  if (!(reason instanceof RoomError)) return 'Couldn’t connect. Your entries are still here. Reconnect and try again.';
  const messages: Record<string, string> = {
    ROOM_FULL: 'This room is full. Your previous room and accepted time have not changed.',
    REJOIN_REQUIRED: 'Your seat was released. Your accepted time stays in Activity. Rejoin to see members or resume.',
    MEMBERSHIP_EXPIRED: 'Your seat was released. Rejoin if a place is available; your accepted time is preserved.',
    ROOM_CLOSED: 'This room is closed to new members. Existing participants can finish its current run.',
    ROOM_SUSPENDED: 'This room has been suspended. Previously accepted time remains in your record.',
    ROOM_ARCHIVED: 'This room is archived. Choose another room or focus solo.',
    ROOM_BANNED: 'You cannot join this room. You can choose another room or focus solo.',
    REMOVED_FOR_RUN: 'You were removed from this run. Your earlier accepted time remains saved.',
    ACTIVE_SESSION: 'Resolve your active session before creating a room. Your entries are still here.',
    ACTIVE_MEMBERSHIP: 'Leave your current room before creating another. Your entries are still here.',
    CONTROL_LOST: 'Another tab controls your presence. Review the latest room and take control explicitly.',
    REVISION_CONFLICT: 'Your room state changed elsewhere. Review the refreshed state before retrying.',
    ROOM_VERSION_CONFLICT: 'The room changed. Review the refreshed version before retrying.',
    DAILY_ROOM_LIMIT: 'You have reached today’s room creation limit. Your draft is kept; browse existing rooms.',
    OWNED_ROOM_LIMIT: 'You already own the maximum number of open rooms. Close one before creating another.',
    REACTION_RATE_LIMIT: 'Give it a moment. Encouragement is limited to one reaction every 30 seconds.',
    ROUND_CHANGED: 'The room moved to another phase. Check the new phase before joining.',
    NOT_FOCUS_PHASE: 'This is not a focus phase. Join explicitly when the next focus round begins.',
    TIME_REVISION_CONFLICT: 'Your personal time changed elsewhere. Review the refreshed session before retrying.',
    TIME_SESSION_CHANGED: 'Your active session changed. Review it before confirming this room action.',
    HOST_OFFER_EXPIRED: 'That host offer expired. Your role has not changed.',
    TARGET_NOT_CONNECTED: 'That participant is reconnecting. Wait until they are connected before transferring the host role.',
  };
  return messages[reason.code] ?? (reason.status === 403 ? 'You no longer have permission for that room action. Private member details have been cleared.' : reason.status === 409 ? 'The room changed before this action was accepted. Review the current state and try again.' : reason.status === 422 ? 'Check the room details. Use plain text without links; your entries have been kept.' : reason.status === 429 ? 'Please wait before trying again. Your entries are still here.' : 'The room could not be opened or updated. Your entries have been kept.');
}
export async function publicRoomRead<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/v1/rooms${path}`, { cache: 'no-store', credentials: 'same-origin', signal });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new RoomError(value?.error?.code ?? 'REQUEST_FAILED', response.status);
  return value.data as T;
}

export type RoomDraft = { title: string; description: string; language: string; topic: string; offeringId: string; presetId: RoomPresetId };
type SnapshotResult = { status: 'accepted' | 'discarded' | 'reconcile' | 'denied' | 'identity' | 'retry' | 'unavailable'; epoch: number };
type SnapshotFreshness = { minimumServerTime?: number; minimumTimeRevision?: number };
type RequiredTimeFreshness = SnapshotFreshness & { scope: string; epoch: number };
const higherFloor = (a?: number, b?: number) => a === undefined ? b : b === undefined ? a : Math.max(a, b);
type HintCoverage = { scope: string; wanted: number; covered: number };
type RoomContextValue = {
  me: RoomMe | null; snapshot: RoomSnapshot | null; ready: boolean; busy: boolean; error: string;
  connection: string; now: number; serverNow: () => number;
  draft: RoomDraft | null; saveDraft: (value: RoomDraft | null) => void;
  accesses: Record<string, RoomAccess>; watchRoom: (roomId: string | null) => void;
  load: (roomId?: string) => Promise<void>;
  snapshotFor: (roomId: string) => Promise<SnapshotResult>;
  refreshBoundary: (roomId: string, minimumServerTime: number) => Promise<SnapshotResult>;
  clearSnapshot: () => void;
  act: (action: RoomAction) => Promise<RoomCommandResponse | null>;
};
const RoomContext = createContext<RoomContextValue | null>(null);
export function useRooms() {
  const value = useContext(RoomContext);
  if (!value) throw new Error('Room provider is required.');
  return value;
}

export function RoomsProvider({ children }: { children: ReactNode }) {
  const { owner, ids, data: time, online, pending, acceptExternal, load: loadTime, registerRoomBridge, refreshIdentity, sound } = useFocus();
  const notifySound = sound.notify;
  const observedSoundPhase = useRef<{ member: string; key: string } | null>(null);
  const [draft, saveDraft] = useState<RoomDraft | null>(null);
  const [accesses, setAccesses] = useState<Record<string, RoomAccess>>({});
  const requestedRoom = useRef<string | null>(null);
  const watchRoom = useCallback((roomId: string | null) => { requestedRoom.current = roomId; }, []);
  const [me, setMe] = useState<RoomMe | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState('connecting');
  const [now, setNow] = useState(0);
  const current = useRef<RoomMe | null>(null);
  const focus = useRef({ ids, time, online, pending });
  const alive = useRef(false);
  const working = useRef(false);
  const permissionEpoch = useRef(0);
  const snapshotRoom = useRef<string | null>(null);
  const acceptedSnapshot = useRef<RoomSnapshot | null>(null);
  const anchor = useRef<{ server: number; mono: number } | null>(null);
  const aborts = useRef(new Set<AbortController>());
  const operation = useRef<{ signature: string; command: RoomCommand } | null>(null);
  const meFlights = useRef(new Map<string, Promise<boolean>>());
  const snapshotFlights = useRef(new Map<string, Promise<SnapshotResult>>());
  const requiredTimeFreshness = useRef<RequiredTimeFreshness | null>(null);
  const hintCoverage = useRef<HintCoverage | null>(null);
  const accessTimes = useRef(new Map<string, number>());
  const lastPassive = useRef(0);
  useEffect(() => { focus.current = { ids, time, online, pending }; }, [ids, time, online, pending]);
  const clock = useCallback(() => anchor.current ? anchor.current.server + Math.max(0, performance.now() - anchor.current.mono) : 0, []);
  const invalidatePermission = useCallback(() => { permissionEpoch.current++; requiredTimeFreshness.current = null; }, []);
  const clearSnapshot = useCallback(() => {
    invalidatePermission(); acceptedSnapshot.current = null; setSnapshot(null);
    if (hintCoverage.current) hintCoverage.current.covered = -1;
  }, [invalidatePermission]);
  const hintsFor = useCallback((member: OwnRoomMembership) => {
    const scope = `${owner}:${member.roomId}:${member.id}:${member.controlVersion}`;
    if (hintCoverage.current?.scope !== scope) hintCoverage.current = { scope, wanted: -1, covered: -1 };
    return hintCoverage.current;
  }, [owner]);

  const request = useCallback(async <T,>(path: string, body?: unknown): Promise<T> => {
    if (!alive.current) throw new Error('Account view closed.');
    const controller = new AbortController(); aborts.current.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`/api/v1/rooms${path}`, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { 'X-Dima-Account-Id': owner, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const value = await response.json().catch(() => null);
      if (!alive.current) throw new Error('Account view closed.');
      if (!response.ok) {
        if (response.status === 401 || value?.error?.code === 'ACCOUNT_CHANGED') refreshIdentity();
        throw new RoomError(value?.error?.code ?? 'REQUEST_FAILED', response.status);
      }
      if (value?.data?.accountId && value.data.accountId !== owner) { refreshIdentity(); throw new RoomError('ACCOUNT_CHANGED', 403); }
      return value as T;
    } finally { clearTimeout(timeout); aborts.current.delete(controller); }
  }, [owner, refreshIdentity]);
  const accept = useCallback((value: RoomMe) => {
    const previous = current.current;
    if (alive.current && value.accountId === owner && value.requestedAccess && Date.parse(value.serverTime) >= (accessTimes.current.get(value.requestedAccess.roomId) ?? 0)) {
      accessTimes.current.set(value.requestedAccess.roomId, Date.parse(value.serverTime));
      setAccesses(previous => ({ ...previous, [value.requestedAccess!.roomId]: value.requestedAccess! }));
    }
    if (!alive.current || value.accountId !== owner || previous && (value.revision < previous.revision || value.revision === previous.revision && Date.parse(value.serverTime) < Date.parse(previous.serverTime))) return false;
    const member = value.membership;
    if (!member || member.status !== 'active' || Date.parse(member.seatExpiresAt) <= Date.parse(value.serverTime) || previous?.membership?.id !== member.id || previous.membership.controlVersion !== member.controlVersion) clearSnapshot();
    current.current = value;
    if (member) hintsFor(member);
    anchor.current = { server: Date.parse(value.serverTime), mono: performance.now() };
    setMe(value); setNow(Date.parse(value.serverTime)); setReady(true);
    if (value.timeRevision > (focus.current.time?.revision ?? -1)) void loadTime();
    return true;
  }, [owner, clearSnapshot, loadTime, hintsFor]);
  const loadMe = useCallback((roomId?: string) => {
    const targetRoom = roomId ?? requestedRoom.current;
    const key = targetRoom ?? '';
    const existing = meFlights.current.get(key);
    if (existing) return existing;
    const flight = (async () => {
      try {
        const value = await request<{ data: RoomMe }>(`/me${targetRoom ? `?roomId=${encodeURIComponent(targetRoom)}` : ''}`);
        const accepted = accept(value.data);
        if (accepted) setError('');
        return accepted;
      } catch (reason) {
        if (!alive.current) return false;
        if (reason instanceof RoomError && [401, 403].includes(reason.status)) clearSnapshot();
        setError(roomMessage(reason));
        return false;
      } finally { meFlights.current.delete(key); }
    })();
    meFlights.current.set(key, flight); return flight;
  }, [request, accept, clearSnapshot]);
  const load = useCallback(async (roomId?: string): Promise<void> => { await loadMe(roomId); }, [loadMe]);
  const snapshotFor = useCallback(function readSnapshot(roomId: string, retries = 1, freshness?: SnapshotFreshness): Promise<SnapshotResult> {
    const result = (status: SnapshotResult['status']): SnapshotResult => ({ status, epoch: permissionEpoch.current });
    const own = current.current?.membership;
    if (!own || own.roomId !== roomId || own.status !== 'active' || Date.parse(own.seatExpiresAt) <= clock()) return Promise.resolve(result('discarded'));
    const coverage = hintsFor(own);
    snapshotRoom.current = roomId;
    const generation = permissionEpoch.current;
    if (requiredTimeFreshness.current?.scope !== coverage.scope || requiredTimeFreshness.current.epoch !== generation) requiredTimeFreshness.current = null;
    // A Time revision constrains every reply in this permission scope, including
    // ordinary reads already in flight. A failed newer read cannot waive it.
    if (freshness?.minimumTimeRevision !== undefined) requiredTimeFreshness.current = {
      scope: coverage.scope, epoch: generation,
      minimumServerTime: higherFloor(requiredTimeFreshness.current?.minimumServerTime, freshness.minimumServerTime),
      minimumTimeRevision: higherFloor(requiredTimeFreshness.current?.minimumTimeRevision, freshness.minimumTimeRevision),
    };
    const minimumServerTime = higherFloor(freshness?.minimumServerTime, requiredTimeFreshness.current?.minimumServerTime);
    const minimumTimeRevision = higherFloor(freshness?.minimumTimeRevision, requiredTimeFreshness.current?.minimumTimeRevision);
    // Stronger phase/Time freshness must not coalesce with an older request.
    const key = `${coverage.scope}:${generation}:${current.current?.revision}:${current.current?.serverTime}:${minimumServerTime ?? ''}:${minimumTimeRevision ?? ''}`;
    const existing = snapshotFlights.current.get(key);
    if (existing) return existing;
    const ownsRequest = () => {
      const member = current.current?.membership;
      return alive.current && generation === permissionEpoch.current && snapshotRoom.current === roomId
        && member?.id === own.id && member.controlVersion === own.controlVersion && member.roomId === roomId;
    };
    const read = async (): Promise<SnapshotResult> => {
      try {
        const { data } = await request<{ data: RoomSnapshot }>(`/${encodeURIComponent(roomId)}/snapshot`);
        if (!ownsRequest() || data.accountId !== owner) return result('discarded');
        const member = current.current!.membership!;
        if (member.status !== 'active' || Date.parse(member.seatExpiresAt) <= clock()) return result('discarded');
        if (member.id !== data.access.membershipId || member.controlVersion !== data.access.generation) return result('reconcile');
        if (Date.parse(data.access.seatExpiresAt) <= clock()) return result('retry');
        const required = requiredTimeFreshness.current;
        const latestRequired = required?.scope === coverage.scope && required.epoch === generation ? required : null;
        const serverFloor = higherFloor(minimumServerTime, latestRequired?.minimumServerTime);
        const revisionFloor = higherFloor(minimumTimeRevision, latestRequired?.minimumTimeRevision);
        if (serverFloor !== undefined && Date.parse(data.serverTime) < serverFloor) return result('retry');
        if (revisionFloor !== undefined && data.me.timeRevision < revisionFloor) return result('retry');
        // A hint is a freshness floor, never an authoritative roster or permission grant.
        if (data.room.hintVersion < coverage.wanted) return result('retry');
        const knownRoom = current.current?.room;
        const previous = acceptedSnapshot.current;
        if (knownRoom?.id === roomId && (data.room.version < knownRoom.version || data.room.hintVersion < knownRoom.hintVersion)) return result('retry');
        if (previous?.room.id === roomId && (data.room.version < previous.room.version || data.room.hintVersion < previous.room.hintVersion || Date.parse(data.serverTime) < Date.parse(previous.serverTime))) return result('discarded');
        if (!accept(data.me)) return result('retry');
        coverage.covered = Math.max(coverage.covered, data.room.hintVersion);
        acceptedSnapshot.current = data; setSnapshot(data); setError('');
        return result('accepted');
      } catch (reason) {
        if (!ownsRequest()) return result('discarded');
        const identity = reason instanceof RoomError && (reason.status === 401 || reason.code === 'ACCOUNT_CHANGED');
        const denied = reason instanceof RoomError && [403, 404, 410].includes(reason.status);
        if (identity || denied) clearSnapshot();
        setError(roomMessage(reason));
        return result(identity ? 'identity' : denied ? 'denied' : 'unavailable');
      }
    };
    const flight = (async () => {
      let outcome: SnapshotResult;
      try { outcome = await read(); } finally { snapshotFlights.current.delete(key); }
      // Only stale successful reads retry immediately. Transport failures wait for the coalescer.
      if (outcome.status === 'retry' && retries > 0 && ownsRequest()
        && current.current?.membership?.status === 'active' && Date.parse(current.current.membership.seatExpiresAt) > clock()) {
        return readSnapshot(roomId, retries - 1, freshness);
      }
      return outcome;
    })();
    snapshotFlights.current.set(key, flight); return flight;
  }, [request, owner, clock, accept, clearSnapshot, hintsFor]);
  const refreshKnownRoom = useCallback(async (roomId: string, freshness?: SnapshotFreshness): Promise<SnapshotResult> => {
    const own = current.current?.membership;
    const outcome = await snapshotFor(roomId, 1, freshness);
    const member = current.current?.membership;
    if (!own || !alive.current || outcome.epoch !== permissionEpoch.current || member?.id !== own.id
      || member.controlVersion !== own.controlVersion || member.roomId !== roomId) return { status: 'discarded', epoch: permissionEpoch.current };
    if (outcome.status !== 'reconcile' && outcome.status !== 'denied') return outcome;
    const confirmed = await loadMe(roomId);
    const latest = current.current?.membership;
    // A new membership/controller gets its own effect. Never follow it from an old request.
    if (outcome.status === 'reconcile' && !confirmed) return { status: outcome.epoch === permissionEpoch.current ? 'unavailable' : 'discarded', epoch: permissionEpoch.current };
    if (outcome.status === 'reconcile' && alive.current && outcome.epoch === permissionEpoch.current
      && latest?.id === own.id && latest.controlVersion === own.controlVersion && latest.roomId === roomId
      && latest.status === 'active' && Date.parse(latest.seatExpiresAt) > clock()) return snapshotFor(roomId, 1, freshness);
    return outcome;
  }, [snapshotFor, loadMe, clock]);
  const refreshBoundary = useCallback((roomId: string, minimumServerTime: number) =>
    refreshKnownRoom(roomId, { minimumServerTime }), [refreshKnownRoom]);
  const act = useCallback(async (action: RoomAction) => {
    const saved = current.current;
    if (!saved || working.current || !navigator.onLine) return null;
    const intent = { ...action } as Record<string, unknown>;
    for (const key of ['expectedTimeRevision', 'controlVersion', 'timeControlVersion', 'presenceControlVersion', 'roomVersion']) delete intent[key];
    const signature = JSON.stringify(intent);
    const command = operation.current?.signature === signature ? operation.current.command : { ...action, expectedRevision: saved.revision, operationId: crypto.randomUUID() } as RoomCommand;
    operation.current = { signature, command }; working.current = true; setBusy(true); setError('');
    try {
      const response = await request<RoomCommandResponse>('', command);
      if (response.time) acceptExternal(response.time);
      if (action.type !== 'renewPresence') invalidatePermission();
      accept(response.data); operation.current = null;
      const membership = response.data.membership;
      if (membership?.status === 'active') await snapshotFor(membership.roomId);
      return response;
    } catch (reason) {
      if (!alive.current) return null;
      if (reason instanceof RoomError && reason.status < 500 && reason.status !== 429) {
        operation.current = null;
        if ([401, 403, 410].includes(reason.status)) clearSnapshot();
        if ([403, 409, 410].includes(reason.status)) { await load('roomId' in action ? action.roomId : undefined); if (current.current?.membership?.status === 'active') await snapshotFor(current.current.membership.roomId); }
      }
      if (alive.current) setError(roomMessage(reason));
      return null;
    } finally { working.current = false; if (alive.current) setBusy(false); }
  }, [request, acceptExternal, accept, snapshotFor, load, clearSnapshot, invalidatePermission]);

  useEffect(() => {
    alive.current = true;
    const controllers = aborts.current;
    queueMicrotask(() => { if (alive.current) void load(); });
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      const member = current.current?.membership;
      if (member && Date.parse(member.seatExpiresAt) <= clock()) clearSnapshot();
      if (performance.now() - lastPassive.current < 1500) return;
      lastPassive.current = performance.now();
      void load().then(() => { const own = current.current?.membership; if (own?.status === 'active' && Date.parse(own.seatExpiresAt) > clock()) void snapshotFor(own.roomId); });
    };
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh); document.addEventListener('visibilitychange', refresh);
    const tick = setInterval(() => { if (alive.current) setNow(clock()); }, 1000);
    return () => { alive.current = false; invalidatePermission(); controllers.forEach(controller => controller.abort()); controllers.clear(); clearInterval(tick); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [load, snapshotFor, clock, clearSnapshot, invalidatePermission]);
  useEffect(() => {
    const member = me?.membership;
    if (member?.status !== 'active') return;
    const timer = setTimeout(() => { clearSnapshot(); void load(member.roomId); }, Math.max(0, Date.parse(member.seatExpiresAt) - clock()));
    return () => clearTimeout(timer);
  }, [me?.membership, clock, clearSnapshot, load]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!navigator.onLine || document.visibilityState === 'hidden' || working.current || operation.current && operation.current.command.type !== 'renewPresence') return;
      const member = current.current?.membership;
      const ownIds = focus.current.ids;
      if (member?.status === 'active' && Date.parse(member.seatExpiresAt) > clock() && ownIds?.tab === member.deviceId) void act({ type: 'renewPresence', roomId: member.roomId, deviceId: ownIds.tab, controlVersion: member.controlVersion });
      else if (member?.status === 'active' && Date.parse(member.seatExpiresAt) > clock()) void refreshKnownRoom(member.roomId);
      else if (member) void load().then(() => { const latest = current.current?.membership; if (latest?.status === 'active') void snapshotFor(latest.roomId); });
    }, 30000);
    return () => clearInterval(timer);
  }, [act, clock, load, snapshotFor, refreshKnownRoom]);

  useEffect(() => {
    const known = current.current, member = known?.membership;
    if (!time || !known || time.accountId !== owner || member?.status !== 'active' || time.revision <= known.timeRevision) return;
    if (Date.parse(member.seatExpiresAt) > clock()) {
      // The accepted Time result remains usable while Room capabilities catch up.
      // A held pre-Time snapshot must satisfy both freshness floors before acceptance.
      void refreshKnownRoom(member.roomId, { minimumServerTime: Date.parse(time.serverTime), minimumTimeRevision: time.revision });
    } else {
      // Expired presence is not authority to read a private snapshot.
      void load().then(() => { const latest = current.current?.membership; if (latest?.status === 'active') void snapshotFor(latest.roomId); });
    }
  }, [time?.revision, time, owner, clock, load, snapshotFor, refreshKnownRoom]);

  const membershipId = me?.membership?.status === 'active' ? me.membership.id : null;
  const membershipGeneration = me?.membership?.controlVersion;
  const roomId = me?.membership?.roomId;
  useEffect(() => {
    if (!membershipId || !roomId || !online) return;
    const controller = new AbortController();
    let handle: Awaited<ReturnType<typeof subscribeRoom>> | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let coalesce: ReturnType<typeof setTimeout> | undefined;
    let retrySnapshot: ReturnType<typeof setTimeout> | undefined;
    let refreshing = false;
    let refreshDirty = false;
    let granting = false;
    let retryGrant = false;
    let closedRequested = false;
    let closeRetries = 0;
    let grantDenied = false;
    function scopeIsCurrent() {
      const member = current.current?.membership;
      return !controller.signal.aborted && alive.current && !grantDenied && focus.current.online
        && member?.id === membershipId && member.roomId === roomId && member.controlVersion === membershipGeneration
        && member.status === 'active' && Date.parse(member.seatExpiresAt) > clock();
    }
    function queueSnapshotRefresh() {
      if (!scopeIsCurrent()) return;
      refreshDirty = true;
      if (refreshing || coalesce) return;
      coalesce = setTimeout(() => { coalesce = undefined; void drainSnapshotRefresh(); }, 120);
    }
    async function drainSnapshotRefresh() {
      if (refreshing || !refreshDirty || !scopeIsCurrent()) return;
      refreshing = true;
      refreshDirty = false;
      try {
        const outcome = await refreshKnownRoom(roomId!);
        if (outcome.status === 'denied' || outcome.status === 'identity') {
          refreshDirty = false; clearTimeout(retrySnapshot); retrySnapshot = undefined;
        } else if ((outcome.status === 'unavailable' || outcome.status === 'retry') && scopeIsCurrent() && retrySnapshot === undefined) {
          const member = current.current!.membership!;
          const targetVersion = Math.max(hintsFor(member).wanted, current.current?.room?.hintVersion ?? -1);
          retrySnapshot = setTimeout(() => {
            retrySnapshot = undefined;
            if (!scopeIsCurrent() || document.visibilityState === 'hidden') return;
            const latest = hintsFor(current.current!.membership!);
            const wanted = Math.max(targetVersion, latest.wanted, current.current?.room?.hintVersion ?? -1);
            if (latest.covered < wanted) queueSnapshotRefresh();
          }, 30000);
        }
      } finally {
        refreshing = false;
        if (refreshDirty && scopeIsCurrent()) queueSnapshotRefresh();
      }
    }
    function queueGrant(delay: number) {
      clearTimeout(refreshTimer);
      if (!controller.signal.aborted) refreshTimer = setTimeout(() => void grant(), delay);
    }
    async function grant() {
      if (controller.signal.aborted) return;
      if (granting) { retryGrant = true; return; }
      granting = true; closedRequested = false;
      try {
        const response = await request<{ data: RoomRealtimeCredentials }>(`/${roomId}/realtime`, {});
        if (controller.signal.aborted || !alive.current) return;
        if (handle) await handle.updateGrant(response.data);
        else handle = await subscribeRoom({ grant: response.data, signal: controller.signal, onStatus: status => {
          if (controller.signal.aborted) return;
          setConnection(status);
          if (status === 'connected') { closeRetries = 0; queueSnapshotRefresh(); }
          if (status === 'closed' && !grantDenied) { closedRequested = true; queueGrant(Math.min(30000, 1000 * 2 ** closeRetries++)); }
        }, onInvalidate: hint => {
          if (!scopeIsCurrent()) return;
          const coverage = hintsFor(current.current!.membership!);
          if (hint.version <= Math.max(coverage.wanted, coverage.covered)) return;
          coverage.wanted = hint.version;
          invalidatePermission();
          queueSnapshotRefresh();
        } });
        if (controller.signal.aborted) { handle?.close(); return; }
        queueGrant(closedRequested ? Math.min(30000, 1000 * 2 ** closeRetries++) : Math.max(1000, Date.parse(response.data.expiresAt) - clock() - 15000));
      } catch (reason) {
        if (controller.signal.aborted || !alive.current) return;
        setConnection('reconnecting');
        if (reason instanceof RoomError && [401, 403, 410].includes(reason.status)) { grantDenied = true; clearTimeout(refreshTimer); retryGrant = false; handle?.close(); handle = null; clearTimeout(retrySnapshot); retrySnapshot = undefined; refreshDirty = false; clearSnapshot(); void load(roomId); }
        else queueGrant(30000);
      } finally {
        granting = false;
        if (retryGrant && !controller.signal.aborted) { retryGrant = false; queueGrant(1000); }
      }
    }
    void grant();
    return () => { controller.abort(); refreshDirty = false; clearTimeout(refreshTimer); clearTimeout(coalesce); clearTimeout(retrySnapshot); handle?.close(); };
  }, [membershipId, membershipGeneration, roomId, online, request, clock, clearSnapshot, load, refreshKnownRoom, hintsFor, invalidatePermission]);

  const startSolo = useCallback(async (action: SoloStartAction) => {
    const member = current.current?.membership;
    const active = focus.current.time?.active;
    if (!member || !focus.current.time || !focus.current.ids || focus.current.pending.length) return null;
    const { mode, category, title, enrollmentId, taskId, settings } = action;
    const response = await act({ type: 'switchToSolo', roomId: member.roomId, deviceId: focus.current.ids.tab, controlVersion: member.controlVersion, expectedTimeRevision: focus.current.time.revision, fromSessionId: active?.id ?? null, timeControlVersion: active?.controlVersion ?? null, solo: { mode, category, title, enrollmentId, taskId, settings } });
    return response?.time ? { data: response.time } : null;
  }, [act]);
  const liveMember = me?.membership?.status === 'active' && Date.parse(me.membership.seatExpiresAt) > now ? me.membership : null;
  const sourceMember = liveMember ?? (time?.active?.mode === 'room' && time.active.roomId === me?.membership?.roomId ? me.membership : null);
  const bridge = useMemo(() => ({ ready, membership: sourceMember, switchFromRoom: !!sourceMember, startSolo, error, refresh: load }), [ready, sourceMember, startSolo, error, load]);
  useEffect(() => { registerRoomBridge(bridge); return () => registerRoomBridge(null); }, [bridge, registerRoomBridge]);
  const validSnapshot = snapshot && liveMember?.id === snapshot.access.membershipId && Date.parse(snapshot.access.seatExpiresAt) > now ? snapshot : null;
  useEffect(() => {
    if (!liveMember) { observedSoundPhase.current = null; return; }
    if (!validSnapshot || !online) return;
    const { room } = validSnapshot;
    const key = `room:${room.run?.id ?? room.id}:${room.phase.kind}:${room.phase.roundIndex ?? 0}`;
    const previous = observedSoundPhase.current;
    observedSoundPhase.current = { member: liveMember.id, key };
    const occurredAt = room.phase.kind === 'completed' ? room.phase.endsAt : room.phase.startsAt;
    if (previous?.member === liveMember.id && previous.key !== key && occurredAt && ['focus', 'shortBreak', 'longBreak', 'completed'].includes(room.phase.kind)) {
      void notifySound(key, Date.parse(occurredAt), clock());
    }
  }, [validSnapshot, liveMember, online, notifySound, clock]);
  return <RoomContext.Provider value={{ me, snapshot: validSnapshot, ready, busy, error, connection, now, serverNow: clock, draft, saveDraft, accesses, watchRoom, load, snapshotFor, refreshBoundary, clearSnapshot, act }}>{children}</RoomContext.Provider>;
}

export function RoomSessionStrip({ section }: { section: string }) {
  const { me, now } = useRooms();
  const member = me?.membership;
  const room = me?.room && member?.status === 'active' && Date.parse(member.seatExpiresAt) > now ? { id: me.room.id, title: me.room.title, state: 'In your room' } : undefined;
  return <SessionStrip section={section} room={room}/>;
}
