'use client';

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { AccountProfile, LearningData, OwnRoomMembership, PomodoroSettings, StopIntentCommand, TimeCommand, TimeData, TimeInterval, TimeResponse, TimeSession } from '@dima/contracts';
import { useNavigate } from './navigation';
import { useFocusSound, type FocusSound } from './focus-sound';
import { completedRoundSignal, crossedDeadline } from './focus-signals';
import { localTimeInput as localInput, parseLocalTime } from './focus-local-time';
import { sessionSeconds as countedSeconds, remainingFocusSeconds } from '../../domain/src/time';
import { browserDeviceId, exportPendingStops, pendingStopKey, readPendingStops, removePendingStop, savePendingStop, tabControlId, type PendingFocusStop } from './focus-outbox';

export type TimeAction<T = TimeCommand> = T extends TimeCommand ? Omit<T, 'operationId' | 'expectedRevision'> : never;
type ClockAnchor = { server: number; observed: number };
type ClientIds = { browser: string; tab: string; persistent: boolean };
class FocusError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}
function messageFor(error: unknown): string {
  if (!(error instanceof FocusError)) return 'Couldn’t connect. Your entries are still here. Check your connection and retry.';
  const messages: Record<string, string> = {
    ACTIVE_SESSION: 'You already have an active session. Open it before starting another.',
    ACTIVE_SESSION_EXISTS: 'You already have an active session. Open it before starting another.',
    CONTROL_CONFLICT: 'Another tab or device controls this session. Review it, then take control explicitly.',
    CONTROL_LOST: 'Another tab or device controls this session. Review it, then take control explicitly.',
    REJOIN_REQUIRED: 'Your room seat expired. Rejoin before resuming; your accepted time is still in your record.',
    LEASE_EXPIRED: 'Control expired. Reconnect and take control before continuing.',
    TIME_OVERLAP: 'This period overlaps time already in your record. Adjust the dates; nothing has been added.',
    INTERVAL_OVERLAP: 'This period overlaps time already in your record. Adjust the dates; nothing has been added.',
    REVISION_CONFLICT: 'Your time record changed elsewhere. The latest version is loading; review it before retrying.',
    OPERATION_NOT_FOUND: 'The original stop has not been confirmed. Review the personal correction below.',
  };
  return messages[error.code] ?? (error.status === 409 ? 'Your time record changed elsewhere. Review the latest session before retrying.' : error.status === 422 ? 'Check the dates and session details. Your entries have been kept.' : 'We couldn’t save this change. Your entries are still here.');
}
export function formatTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  return `${hours ? `${hours}:` : ''}${String(Math.floor(value / 60) % 60).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
function instant(value: string, timezone: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(value));
}
function sessionSeconds(session: TimeSession, intervals: TimeInterval[], now: number) {
  return countedSeconds(session.id, intervals, now);
}

function openInterval(data: TimeData, session: TimeSession) {
  return data.intervals.find(interval => interval.sessionId === session.id && !interval.endAt);
}
function statusName(session: TimeSession) {
  return { running: 'Focusing', paused: 'Paused', needsReview: 'Needs review', finalized: 'Saved' }[session.status];
}
function sessionPath(id: string) { return `/app/progress/activity/${id}`; }
function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={`focus-notice${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{children}</div>;
}

export type SoloStartAction = Extract<TimeAction, { type: 'start' }>;
export type RoomFocusBridge = { switchFromRoom: boolean; error: string; refresh: () => Promise<void>; ready: boolean; membership: OwnRoomMembership | null; startSolo: (action: SoloStartAction) => Promise<TimeResponse | null> };

type FocusContextValue = {
  sound: FocusSound;
  owner: string; profile: AccountProfile; data: TimeData | null; ids: ClientIds | null;
  anchor: ClockAnchor | null; online: boolean; busy: boolean; error: string; storageError: string;
  pending: PendingFocusStop[];
  savedSession: { id: string; title: string } | null;
  dismissSaved: () => void;
  load: () => Promise<void>;
  read: (query: string) => Promise<TimeData>;
  act: (action: TimeAction) => Promise<TimeResponse | null>;
  stop: (kind: 'pause' | 'finish') => Promise<TimeResponse | null>;
  finishAndReview: (sessionId: string) => Promise<void>;
  checkPending: () => Promise<void>;
  resolve: (entry: PendingFocusStop) => Promise<void>;
  discard: (entry: PendingFocusStop) => Promise<void>;
  roomBridge: RoomFocusBridge | null;
  registerRoomBridge: (bridge: RoomFocusBridge | null) => void;
  acceptExternal: (value: TimeData) => void;
  refreshIdentity: () => void;
  visibleControls: Record<string, { owner: string; sessionId: string }>;
  reportControls: (id: string, sessionId: string, visible: boolean) => void;
};
const FocusContext = createContext<FocusContextValue | null>(null);
export function useFocus() {
  const value = useContext(FocusContext);
  if (!value) throw new Error('Focus must be used inside its account provider.');
  return value;
}
export function useServerClock() {
  const { anchor } = useFocus();
  const [now, setNow] = useState<number>(0);
  useEffect(() => {
    if (!anchor) return;
    const update = () => setNow(anchor.server + Math.max(0, performance.now() - anchor.observed));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [anchor]);
  return now || anchor?.server || 0;
}

export function FocusProvider({ owner, profile, onIdentityChanged, children }: { owner: string; profile: AccountProfile; onIdentityChanged: (owner?: string) => void; children: ReactNode }) {
  const navigate = useNavigate();
  const sound = useFocusSound(owner);
  const notifySound = sound.notify;
  const [data, setData] = useState<TimeData | null>(null);
  const [ids, setIds] = useState<ClientIds | null>(null);
  const [roomBridge, setRoomBridge] = useState<RoomFocusBridge | null>(null);
  const roomBridgeRef = useRef<RoomFocusBridge | null>(null);
  const registerRoomBridge = useCallback((value: RoomFocusBridge | null) => { roomBridgeRef.current = value; setRoomBridge(value); }, []);
  const [anchor, setAnchor] = useState<ClockAnchor | null>(null);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [pending, setPending] = useState<PendingFocusStop[]>([]);
  const [savedSession, setSavedSession] = useState<{ id: string; title: string } | null>(null);
  const [visibleControls, setVisibleControls] = useState<FocusContextValue['visibleControls']>({});
  const reportControls = useCallback((id: string, sessionId: string, visible: boolean) => {
    setVisibleControls(previous => {
      if (visible && previous[id]?.owner === owner && previous[id]?.sessionId === sessionId || !visible && !previous[id]) return previous;
      const next = { ...previous };
      if (visible) next[id] = { owner, sessionId }; else delete next[id];
      return next;
    });
  }, [owner]);
  const savedGeneration = useRef(0);
  const dismissSaved = useCallback(() => { savedGeneration.current++; setSavedSession(null); }, []);
  const current = useRef<TimeData | null>(null);
  const clock = useRef<ClockAnchor | null>(null);
  const alive = useRef(false);
  const working = useRef(false);
  const controllers = useRef(new Set<AbortController>());
  const loadFlight = useRef<Promise<void> | null>(null);
  const passiveCheckedAt = useRef(0);
  const identity = useRef(onIdentityChanged);
  const operation = useRef<{ signature: string; command: TimeCommand } | null>(null);
  const checking = useRef(false);
  const volatileStops = useRef(new Map<string, PendingFocusStop>());
  const channel = useRef<BroadcastChannel | null>(null);
  useEffect(() => { identity.current = onIdentityChanged; }, [onIdentityChanged]);
  const refreshIdentity = useCallback(() => identity.current(owner), [owner]);

  const request = useCallback(async <T,>(path: string, body?: unknown): Promise<T> => {
    if (!alive.current) throw new Error('Account view closed.');
    const controller = new AbortController();
    controllers.current.add(controller);
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`/api/v1${path}`, {
        method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { 'X-Dima-Account-Id': owner, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const value = await response.json().catch(() => null);
      if (!alive.current) throw new Error('Account view closed.');
      if (!response.ok) {
        if (response.status === 401 || value?.error?.code === 'ACCOUNT_CHANGED') identity.current(owner);
        throw new FocusError(value?.error?.code ?? 'REQUEST_FAILED', response.status);
      }
      if (value?.data?.accountId !== owner) { identity.current(owner); throw new Error('Account changed.'); }
      return value as T;
    } finally { clearTimeout(timer); controllers.current.delete(controller); }
  }, [owner]);

  const accept = useCallback((value: TimeData) => {
    if (!alive.current || value.accountId !== owner || value.revision < (current.current?.revision ?? -1) || value.revision === current.current?.revision && Date.parse(value.serverTime) < Date.parse(current.current.serverTime)) return;
    const previous = current.current?.active;
    if (previous && previous.id !== value.active?.id) {
      const generation = ++savedGeneration.current;
      const saved = value.sessions.find(session => session.id === previous.id && session.status === 'finalized');
      if (saved) {
        setSavedSession({ id: saved.id, title: saved.title });
        const signal = completedRoundSignal(previous, value);
        if (signal) void notifySound(signal.key, signal.occurredAt, signal.now);
      }
      else void request<TimeResponse>(`/time?sessionId=${encodeURIComponent(previous.id)}`).then(response => {
        const completed = response.data.sessions.find(session => session.id === previous.id && session.status === 'finalized');
        if (alive.current && generation === savedGeneration.current && completed) {
          setSavedSession({ id: completed.id, title: completed.title });
          const signal = completedRoundSignal(previous, response.data);
          if (signal) void notifySound(signal.key, signal.occurredAt, signal.now);
        }
      }).catch(() => { /* A missing summary never changes the current session or form. */ });
    }
    const nextAnchor = { server: Date.parse(value.serverTime), observed: performance.now() };
    current.current = value;
    clock.current = nextAnchor;
    setData(value);
    setAnchor(nextAnchor);
  }, [owner, request, notifySound]);
  const read = useCallback(async (query: string) => (await request<TimeResponse>(`/time${query}`)).data, [request]);
  const load = useCallback((): Promise<void> => {
    if (loadFlight.current) return loadFlight.current;
    const flight = (async () => {
      try { const value = await read('?limit=1'); accept(value); if (alive.current) setError(''); }
      catch (reason) { if (alive.current) setError(messageFor(reason)); }
      finally { loadFlight.current = null; }
    })();
    loadFlight.current = flight;
    return flight;
  }, [read, accept]);
  const reloadPending = useCallback(async () => {
    if (!ids) return;
    try { const values = ids.persistent ? await readPendingStops(owner, ids.browser) : []; if (alive.current) setPending([...values, ...volatileStops.current.values()]); }
    catch { if (alive.current) { setPending([...volatileStops.current.values()]); setStorageError('Local storage is unavailable. Stop requests are held only while this page stays open.'); } }
  }, [owner, ids]);
  const persist = useCallback(async (entry: PendingFocusStop) => {
    try {
      if (!ids?.persistent) throw new Error('Device identity is temporary.');
      await savePendingStop({ ...entry, durable: true });
      volatileStops.current.delete(entry.key);
    } catch {
      volatileStops.current.set(entry.key, { ...entry, durable: false });
      if (alive.current) setStorageError('This stop is held in memory only. Keep this page open and reconnect; it has not been saved on this device.');
    }
  }, [ids]);
  const remove = useCallback(async (entry: PendingFocusStop) => {
    if (entry.durable !== false) await removePendingStop(owner, entry.deviceId, entry.command.operationId);
    else { try { await removePendingStop(owner, entry.deviceId, entry.command.operationId); } catch {} }
    volatileStops.current.delete(entry.key);
    if (entry.durable === false && alive.current) setStorageError('Local storage is unavailable. Future unsynced stops will be held only while this page stays open.');
  }, [owner]);
  const announce = useCallback(() => channel.current?.postMessage({ type: 'changed', owner }), [owner]);

  useEffect(() => {
    alive.current = true;
    const activeControllers = controllers.current;
    const nonce = crypto.randomUUID();
    let tab = '';
    let browser = '';
    let persistent = true;
    try { browser = browserDeviceId(); tab = tabControlId(); }
    catch { browser = crypto.randomUUID(); tab = crypto.randomUUID(); persistent = false; }
    queueMicrotask(() => {
      if (!alive.current) return;
      setIds({ browser, tab, persistent });
      setOnline(navigator.onLine);
      if (!persistent) setStorageError('This browser blocks local storage. Online controls still work, but unsynced stops will not survive closing this page.');
    });
    let bus: BroadcastChannel | null = null;
    try { if (typeof BroadcastChannel !== 'undefined') bus = new BroadcastChannel('dima-focus'); } catch { /* Cross-tab notification is optional; HTTP remains authoritative. */ }
    channel.current = bus;
    if (bus) {
      bus.onmessage = event => {
        if (event.data?.type === 'probe' && event.data.tab === tab && event.data.nonce !== nonce) bus?.postMessage({ type: 'present', target: event.data.nonce, tab });
        if (event.data?.type === 'present' && event.data.target === nonce && event.data.tab === tab) {
          try { tab = tabControlId(true); } catch { tab = crypto.randomUUID(); }
          setIds({ browser, tab, persistent });
        }
        if (event.data?.type === 'changed' && event.data.owner === owner) void load();
      };
      bus.postMessage({ type: 'probe', tab, nonce });
    }
    const refresh = () => {
      if (document.visibilityState !== 'hidden' && Date.now() - passiveCheckedAt.current > 1500) { passiveCheckedAt.current = Date.now(); void load(); }
    };
    const network = () => { setOnline(navigator.onLine); if (navigator.onLine) refresh(); };
    void load();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', network);
    window.addEventListener('offline', network);
    return () => {
      alive.current = false;
      activeControllers.forEach(controller => controller.abort());
      bus?.close();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', network);
      window.removeEventListener('offline', network);
    };
  }, [owner, load]);
  useEffect(() => { void reloadPending(); }, [reloadPending]);

  const act = useCallback(async (action: TimeAction): Promise<TimeResponse | null> => {
    if (!current.current || working.current || !navigator.onLine) return null;
    const signature = JSON.stringify(action);
    const command = operation.current?.signature === signature ? operation.current.command : { ...action, expectedRevision: current.current.revision, operationId: crypto.randomUUID() } as TimeCommand;
    operation.current = { signature, command };
    working.current = true; setBusy(true); setError('');
    try {
      const response = await request<TimeResponse>('/time', command);
      accept(response.data); operation.current = null; announce(); return response;
    } catch (reason) {
      if (reason instanceof FocusError && reason.status >= 400 && reason.status < 500 && reason.status !== 429) { operation.current = null; if (reason.status === 409) await load(); }
      if (alive.current) setError(messageFor(reason));
      return null;
    } finally { working.current = false; if (alive.current) setBusy(false); }
  }, [request, accept, announce, load]);

  const checkPending = useCallback(async () => {
    if (!ids || !navigator.onLine || checking.current || working.current) return;
    checking.current = true;
    try {
      let entries: PendingFocusStop[] = [];
      try { if (ids.persistent) entries = await readPendingStops(owner, ids.browser); } catch {}
      entries.push(...volatileStops.current.values());
      for (const entry of entries) {
        if (!alive.current || entry.phase !== 'waiting') continue;
        try {
          const response = await request<TimeResponse>('/time/receipts', { command: entry.command });
          accept(response.data);
          await remove(entry);
        } catch (reason) {
          if (reason instanceof FocusError && reason.code === 'OPERATION_NOT_FOUND') await persist({ ...entry, phase: 'personal-review' });
          else if (reason instanceof FocusError && reason.status !== 401) await persist({ ...entry, phase: 'conflict', error: messageFor(reason) });
        }
      }
      await reloadPending();
    } finally { checking.current = false; }
  }, [ids, owner, request, accept, reloadPending, persist, remove]);
  useEffect(() => {
    if (ids && online) void checkPending();
  }, [ids, online, checkPending]);

  const stop = useCallback(async (kind: 'pause' | 'finish'): Promise<TimeResponse | null> => {
    const snapshot = current.current;
    const active = snapshot?.active;
    if (!snapshot || !active || !ids || !clock.current || working.current || pending.length || active.deviceId !== ids.tab) return null;
    const interval = openInterval(snapshot, active);
    if (!interval && (!navigator.onLine || kind === 'pause')) return null;
    const base = { operationId: crypto.randomUUID(), expectedRevision: snapshot.revision, sessionId: active.id, deviceId: ids.tab, controlVersion: active.controlVersion };
    const command: StopIntentCommand = kind === 'pause' ? { ...base, type: 'pause', intervalId: interval!.id } : { ...base, type: 'finish', intervalId: interval?.id ?? null };
    const reported = clock.current.server + Math.max(0, performance.now() - clock.current.observed);
    const entry: PendingFocusStop = {
      key: pendingStopKey(owner, ids.browser, command.operationId), accountId: owner, deviceId: ids.browser, command,
      reportedEndAt: new Date(interval ? Math.min(reported, Date.parse(interval.boundaryAt)) : reported).toISOString(),
      createdAt: new Date().toISOString(), durable: true, phase: navigator.onLine ? 'waiting' : 'personal-review',
    };
    working.current = true; setBusy(true); setError('');
    try {
      await persist(entry);
      await reloadPending();
      if (!navigator.onLine) return null;
      const response = await request<TimeResponse>('/time', command);
      accept(response.data);
      await remove(volatileStops.current.get(entry.key) ?? entry);
      await reloadPending(); announce(); return response;
    } catch (reason) {
      if (alive.current) setError(reason instanceof FocusError ? messageFor(reason) : 'Stop has not been confirmed by the server. If saved on this device, it appears below for receipt recovery.');
      if (reason instanceof FocusError && reason.status === 409) await load();
      return null;
    } finally {
      working.current = false;
      if (alive.current) { setBusy(false); void checkPending(); }
    }
  }, [ids, owner, pending.length, request, accept, reloadPending, announce, load, checkPending, persist, remove]);

  const finishAndReview = useCallback(async (sessionId: string) => {
    if (!alive.current || current.current?.active?.id !== sessionId) return;
    const origin = window.location.pathname + window.location.search + window.location.hash;
    const response = await stop('finish');
    const stillOnOrigin = window.location.pathname + window.location.search + window.location.hash === origin;
    const finalized = response?.data.sessions.some(session => session.id === sessionId && session.status === 'finalized');
    if (finalized && alive.current && current.current?.accountId === owner && stillOnOrigin) navigate(sessionPath(sessionId));
  }, [stop, owner, navigate]);

  const resolve = useCallback(async (entry: PendingFocusStop) => {
    if (!ids || entry.accountId !== owner || entry.deviceId !== ids.browser || !current.current || working.current || !navigator.onLine) return;
    working.current = true; setBusy(true); setError('');
    try {
      let response: TimeResponse;
      if (!entry.command.intervalId) response = await request<TimeResponse>('/time', entry.command);
      else {
        const reconciliation = entry.reconciliation ?? { type: 'offlineStop', operationId: crypto.randomUUID(), expectedRevision: current.current.revision, originalCommand: entry.command, reportedEndAt: entry.reportedEndAt, confirmPersonal: true };
        await persist({ ...entry, reconciliation });
        response = await request<TimeResponse>('/time', reconciliation);
      }
      accept(response.data);
      await remove(entry);
      announce();
    } catch (reason) {
      if (alive.current) setError(messageFor(reason));
      if (reason instanceof FocusError && reason.status >= 400 && reason.status < 500 && reason.status !== 429) {
        await persist({ ...entry, reconciliation: undefined, phase: 'conflict', error: messageFor(reason) });
        if (reason.status === 409) await load();
      }
    } finally { working.current = false; if (alive.current) { setBusy(false); await reloadPending(); } }
  }, [ids, owner, request, accept, announce, load, reloadPending, persist, remove]);
  const discard = useCallback(async (entry: PendingFocusStop) => {
    if (!ids || entry.accountId !== owner || entry.deviceId !== ids.browser) return;
    await remove(entry);
    await reloadPending();
  }, [owner, ids, reloadPending, remove]);

  useEffect(() => {
    const timer = setInterval(() => {
      const snapshot = current.current;
      if (!snapshot?.active || !navigator.onLine || document.visibilityState === 'hidden' || working.current || operation.current && operation.current.command.type !== 'renew') return;
      const active = snapshot.active;
      const membership = roomBridgeRef.current?.membership;
      const serverNow = clock.current ? clock.current.server + Math.max(0, performance.now() - clock.current.observed) : 0;
      if (active.mode === 'room' && membership?.status === 'active' && membership.roomId === active.roomId && Date.parse(membership.seatExpiresAt) > serverNow) return;
      if (active.deviceId === ids?.tab && !pending.length) void act({ type: 'renew', sessionId: active.id, deviceId: ids.tab, controlVersion: active.controlVersion });
      else void load();
    }, 30000);
    return () => clearInterval(timer);
  }, [ids, pending.length, act, load]);
  useEffect(() => {
    if (data?.active?.status !== 'running' || !anchor || !online) return;
    const interval = openInterval(data, data.active);
    if (!interval) return;
    const delay = Math.max(100, Date.parse(interval.boundaryAt) - anchor.server + 150);
    const timer = setTimeout(() => void load(), Math.min(delay, 2147483647));
    return () => clearTimeout(timer);
  }, [data, anchor, online, load]);

  return <FocusContext.Provider value={{ sound, owner, profile, data, ids, anchor, online, busy, error, storageError, pending, savedSession, dismissSaved, load, read, act, stop, finishAndReview, checkPending, resolve, discard, roomBridge, registerRoomBridge, acceptExternal: accept, refreshIdentity, visibleControls, reportControls }}>{children}</FocusContext.Provider>;
}

export function Dialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const element = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = element.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog className="focus-dialog" ref={element} aria-labelledby={id} onCancel={event => { event.preventDefault(); close(); }}>
    <h2 id={id}>{title}</h2>{children}
  </dialog>;
}

export function PendingStops() {
  const { pending, online, busy, profile, checkPending, resolve, discard } = useFocus();
  const [deleting, setDeleting] = useState<PendingFocusStop | null>(null);
  if (!pending.length) return null;
  return <section className="focus-pending" aria-labelledby="pending-stops-title">
    <h2 id="pending-stops-title">Your stop is waiting to sync</h2>
    <p>Resolve these requests before starting another session. The time is not confirmed in your saved record yet.</p>
    {pending.map(entry => <article key={entry.key}>
      <strong>{entry.command.type === 'pause' ? 'Pause requested' : 'Stop requested'} · {instant(entry.reportedEndAt, profile.timezone)}</strong>
      <p>{entry.durable === false ? 'Not saved on this device. Held in memory only; keep this page open.' : 'Saved on this device. Waiting to sync with your account.'}</p>
      {entry.error && <p role="alert">{entry.error}</p>}
      <p>{entry.command.intervalId ? 'We first check whether your original stop was saved. If not, the affected part of this session becomes personal time, outside rankings. Earlier confirmed time stays unchanged.' : 'This was already paused, so no time is accruing. Reconnect to confirm the original finish request.'}</p>
      <div className="focus-actions">
        <button disabled={!online || busy} onClick={() => void (entry.phase === 'waiting' ? checkPending() : resolve(entry))}>{entry.phase === 'waiting' ? 'Check saved result' : entry.command.intervalId ? 'Sync personal stop' : 'Retry paused finish'}</button>
        <button className="secondary" disabled={busy} onClick={() => exportPendingStops([entry])}>Export request</button>
        <button className="quiet" disabled={busy} onClick={() => setDeleting(entry)}>Delete local request</button>
      </div>
    </article>)}
    {deleting && <Dialog title="Delete this unsynced request?" close={() => setDeleting(null)}>
      <p>This removes the request from this device. It does not stop or correct the server session. Export it first if you need a copy.</p>
      <div className="focus-actions"><button className="secondary" onClick={() => setDeleting(null)}>Keep request</button><button onClick={() => void discard(deleting).then(() => setDeleting(null))}>Delete request from this device</button></div>
    </Dialog>}
  </section>;
}

export function FocusSignOut({ onSignOut, className = 'account-link-button' }: { onSignOut: () => Promise<void>; className?: string }) {
  const { pending, data, online, checkPending, roomBridge } = useFocus();
  const [review, setReview] = useState(false);
  const navigate = useNavigate();
  return <><button className={className} onClick={() => pending.length || data?.active || roomBridge?.membership ? setReview(true) : void onSignOut()}>Sign out</button>
    {review && <Dialog title={pending.length ? 'Keep your unsynced work safe.' : data?.active ? 'Your session will keep its boundary.' : 'Your room presence'} close={() => setReview(false)}>
      <p>{pending.length ? `${pending.length} stop request${pending.length === 1 ? '' : 's'} await confirmation. Saved requests stay private to this account on this device; another account cannot replay them.` : data?.active ? 'Signing out does not finish this session. It keeps running to its saved boundary unless you pause or finish first.' : 'Signing out stops your presence updates. Your seat may remain reserved until its three-minute lease expires. Leave the room first if you want to release it now.'}</p>
      {pending.some(entry => entry.durable === false) && <Notice error>At least one request is in memory only. Signing out will lose that unsynced intent; export it or reconnect first.</Notice>}
      <div className="focus-actions">
        {pending.length > 0 && <><button disabled={!online} onClick={() => void checkPending()}>Check saved results</button><button className="secondary" onClick={() => exportPendingStops(pending)}>Export pending requests</button></>}
        <button className="secondary" onClick={() => { setReview(false); navigate(roomBridge?.membership ? `/app/rooms/${roomBridge.membership.roomId}` : '/app/focus'); }}>Return to session</button>
        <button onClick={() => void onSignOut()}>{pending.length ? 'Preserve saved requests and sign out' : data?.active ? 'Sign out with session active' : 'Sign out and stop presence updates'}</button>
      </div>
    </Dialog>}
  </>;
}

function SessionControls({ session, compact = false }: { session: TimeSession; compact?: boolean }) {
  const { ids, online, busy, pending, act, stop, finishAndReview, roomBridge, reportControls } = useFocus();
  const controls = useRef<HTMLDivElement>(null);
  const controlId = useId();
  useEffect(() => {
    const element = controls.current;
    if (compact || !element || typeof IntersectionObserver === 'undefined') return;
    let observer: IntersectionObserver;
    let disposed = false;
    const navigation = document.querySelector('.workspace-mobile-nav');
    const observe = () => {
      observer?.disconnect();
      // Exclude fixed mobile navigation, but not the dock itself: hiding the
      // dock must not change this boundary and cause visibility oscillation.
      const bottom = navigation?.getBoundingClientRect().height ?? 0;
      observer = new IntersectionObserver(entries => {
        if (disposed) return;
        const entry = entries[0];
        reportControls(controlId, session.id, entry.isIntersecting && entry.intersectionRatio >= 1);
      }, { threshold: 1, rootMargin: `0px 0px -${bottom}px 0px` });
      observer.observe(element);
    };
    observe();
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(observe);
    if (navigation) resize?.observe(navigation);
    window.addEventListener('resize', observe);
    return () => {
      disposed = true;
      observer.disconnect();
      resize?.disconnect();
      window.removeEventListener('resize', observe);
      reportControls(controlId, session.id, false);
    };
  }, [compact, controlId, reportControls, session.id, session.status]);
  const now = useServerClock();
  const foreign = ids?.tab !== session.deviceId || now >= Date.parse(session.leaseUntil);
  const disabled = busy || pending.length > 0;
  const needsRejoin = session.mode === 'room' && (!roomBridge?.ready || roomBridge.membership?.status !== 'active' || roomBridge.membership.roomId !== session.roomId || Date.parse(roomBridge.membership.seatExpiresAt) <= now);
  async function finish() { await finishAndReview(session.id); }
  if (session.status === 'finalized') return null;
  return <div ref={controls} className={`focus-actions${compact ? ' is-compact' : ''}`}>
    {foreign ? <><button disabled={disabled || !online || !ids} onClick={() => ids && void act({ type: 'claimControl', sessionId: session.id, deviceId: ids.tab, controlVersion: session.controlVersion })}>Take control on this tab</button>{session.status === 'running' && !online && ids?.tab === session.deviceId && <button disabled={disabled} onClick={() => void finish()}>Stop on this device</button>}{session.status === 'needsReview' && <a className="account-button-link" href={sessionPath(session.id)}>Review this session</a>}</> : <>
      {session.status === 'running' && <button disabled={disabled || !online} onClick={() => void stop('pause')}>Pause</button>}
      {session.status === 'paused' && needsRejoin && <a href={`/app/rooms/${session.roomId}`}>Rejoin room to resume</a>}
      {session.status === 'paused' && <button disabled={disabled || !online || !ids || needsRejoin} onClick={() => ids && void act({ type: 'resume', sessionId: session.id, deviceId: ids.tab, controlVersion: session.controlVersion })}>Resume</button>}
      {session.status !== 'needsReview' && <button className={online ? 'secondary' : ''} disabled={disabled || session.status === 'paused' && !online} onClick={() => void finish()}>{online ? 'Finish session' : 'Stop on this device'}</button>}
      {session.status === 'needsReview' && <a className="account-button-link" href={sessionPath(session.id)}>Review this session</a>}
    </>}
  </div>;
}

export function SessionStrip({ section, room }: { section: string; room?: { id: string; title: string; state: string } }) {
  const { owner, data, pending, online, savedSession, dismissSaved, visibleControls } = useFocus();
  const [dockFocused, setDockFocused] = useState(false);
  const now = useServerClock();
  const active = data?.active;
  const showingSummary = !!savedSession && section === `progress/activity/${savedSession.id}`;
  const showSaved = !!savedSession && !showingSummary;
  const showRoom = !!room && section !== `rooms/${room.id}`;
  const primaryVisible = !!active && Object.values(visibleControls).some(value => value.owner === owner && value.sessionId === active.id);
  useEffect(() => { if (showingSummary) dismissSaved(); }, [showingSummary, dismissSaved]);
  useEffect(() => {
    if (active || pending.length || showSaved || showRoom) document.documentElement.dataset.focusSession = 'active';
    else delete document.documentElement.dataset.focusSession;
    return () => { delete document.documentElement.dataset.focusSession; };
  }, [active, pending.length, showSaved, showRoom]);
  if (!data || !active && !pending.length && !showSaved && !showRoom) return null;
  if (!active && !pending.length && !showSaved && room && showRoom) return <aside className="focus-session-strip" aria-label="Current room"><div><strong>{room.state}</strong><span>{room.title} · no personal timer running</span></div><a href={`/app/rooms/${room.id}`}>Return to room</a></aside>;
  if (!active && !pending.length && savedSession) return <aside className="focus-session-strip is-saved" aria-label="Saved focus session"><div role="status"><strong>Session saved</strong><span>{savedSession.title}</span></div><a href={sessionPath(savedSession.id)}>View summary</a><button className="quiet" onClick={dismissSaved}>Dismiss</button></aside>;
  return <aside className="focus-session-strip" aria-label="Current focus session" hidden={primaryVisible && !pending.length && !dockFocused}
    onFocusCapture={() => setDockFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDockFocused(false); }}>
    <div><strong>{pending.length ? 'Stop waiting to sync' : active ? `${statusName(active)} · ${active.category === 'work' ? 'Work' : 'Learning'}` : 'Pending stop'}</strong>
      {active && !pending.length && <span className="focus-strip-time">{formatTime(sessionSeconds(active, data.intervals, now))}{!online && ' · estimated'}</span>}
    </div>
    <a href={room ? `/app/rooms/${room.id}` : "/app/focus"}>View session</a>
    {active && !pending.length && <SessionControls session={active} compact/>}
  </aside>;
}

const defaultSettings: PomodoroSettings = { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakAfter: 4 };
const focusPresets: Record<string, PomodoroSettings> = {
  '15': { focusMinutes: 15, shortBreakMinutes: 3, longBreakMinutes: 15, longBreakAfter: 4 },
  '25': defaultSettings,
  '50': { focusMinutes: 50, shortBreakMinutes: 10, longBreakMinutes: 20, longBreakAfter: 4 },
};
function matchingPreset(settings: PomodoroSettings) {
  return Object.entries(focusPresets).find(([, value]) => value.focusMinutes === settings.focusMinutes && value.shortBreakMinutes === settings.shortBreakMinutes && value.longBreakMinutes === settings.longBreakMinutes && value.longBreakAfter === settings.longBreakAfter)?.[0] ?? 'custom';
}
type ActivityOption = { value: string; enrollmentId: string; taskId: string; title: string; course: string; completed: boolean };
function FocusSetup({ query }: { query: string }) {
  const { owner, profile, data, ids, online, busy, pending, act, read, roomBridge } = useFocus();
  const [switchConfirmed, setSwitchConfirmed] = useState(false);
  const navigate = useNavigate();
  const params = new URLSearchParams(query);
  const after = params.get('after');
  const [category, setCategory] = useState<'work' | 'learning'>(params.get('category') === 'work' ? 'work' : params.get('category') === 'learning' || params.has('task') ? 'learning' : profile.intent === 'work' ? 'work' : 'learning');
  const [mode, setMode] = useState<'open' | 'solo'>('solo');
  const [preset, setPreset] = useState('25');
  const [settings, setSettings] = useState(defaultSettings);
  const [title, setTitle] = useState('');
  const [selectedCourse, setSelectedCourse] = useState(params.get('course') ?? '');
  const [activitySearch, setActivitySearch] = useState('');
  const [selection, setSelection] = useState(params.has('course') && params.has('task') ? JSON.stringify([params.get('course'), params.get('task')]) : '');
  const [activities, setActivities] = useState<ActivityOption[]>([]);
  const [activitiesLoaded, setActivitiesLoaded] = useState(false);
  const [activityError, setActivityError] = useState('');
  const [activityLoadError, setActivityLoadError] = useState('');
  const [activityAttempt, setActivityAttempt] = useState(0);
  const [previous, setPrevious] = useState<TimeSession | null>(null);
  const [loadingPrevious, setLoadingPrevious] = useState(!!after);
  const [failure, setFailure] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(params.has('course') || params.has('task') || !!after);
  const previousLoaded = useRef(false);
  useEffect(() => {
    if (!after || previousLoaded.current) return;
    let cancelled = false;
    void read(`?sessionId=${encodeURIComponent(after)}`).then(value => {
      if (cancelled) return;
      const saved = value.sessions.find(session => session.id === after);
      if (!saved || saved.status !== 'finalized' || saved.mode !== 'solo') { setActivityError('That round is unavailable. Choose a new session below.'); return; }
      previousLoaded.current = true;
      setPrevious(saved); setCategory(saved.category); setMode('solo'); setTitle(saved.title);
      if (saved.settings) { setSettings(saved.settings); setPreset(matchingPreset(saved.settings)); }
      setSelectedCourse(saved.enrollmentId ?? '');
      setSelection(saved.enrollmentId && saved.taskId ? JSON.stringify([saved.enrollmentId, saved.taskId]) : '');
    }).catch(() => { if (!cancelled) setActivityError('Couldn’t load the previous round. Retry by opening its saved summary.'); }).finally(() => { if (!cancelled) setLoadingPrevious(false); });
    return () => { cancelled = true; };
  }, [after, read]);
  useEffect(() => {
    if (category !== 'learning') return;
    const controller = new AbortController();
    void fetch('/api/v1/learning', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), headers: { 'X-Dima-Account-Id': owner } }).then(async response => {
      const value = await response.json();
      if (!response.ok || value.data?.accountId !== owner) throw new Error('Unavailable');
      return value.data as LearningData;
    }).then(value => {
      if (controller.signal.aborted) return;
      setActivitiesLoaded(true);
      setActivityLoadError('');
      setActivities(value.state.enrollments.flatMap(enrollment => enrollment.snapshot.courses.flatMap(course => course.modules.flatMap(module => module.tasks.filter(task => enrollment.taskIds.includes(task.id)).map(task => ({ value: JSON.stringify([enrollment.id, task.id]), enrollmentId: enrollment.id, taskId: task.id, title: task.title, course: enrollment.snapshot.title, completed: enrollment.completions.some(completion => completion.taskId === task.id && completion.completed) }))))));
    }).catch(() => { if (!controller.signal.aborted) { setActivitiesLoaded(true); setActivityLoadError('Your activities could not be loaded. Retry to keep your selected activity, or choose to focus without one.'); } });
    return () => controller.abort();
  }, [category, owner, activityAttempt]);
  const unresolvedActivity = category === 'learning' && selection !== '' && !activities.some(activity => activity.value === selection);
  const courses = [...new Map(activities.map(activity => [activity.enrollmentId, activity.course])).entries()];
  const courseActivities = activities.filter(activity => activity.enrollmentId === selectedCourse);
  const matchingActivities = courseActivities.filter(activity => activity.title.toLocaleLowerCase().includes(activitySearch.trim().toLocaleLowerCase()));
  const matchingValues = new Set(matchingActivities.map(activity => activity.value));
  const visibleActivities = courseActivities.filter(activity => activity.value === selection || matchingValues.has(activity.value));
  function choosePreset(value: string) {
    setPreset(value);
    if (focusPresets[value]) setSettings(focusPresets[value]);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ids || data?.active && !(data.active.mode === 'room' && roomBridge?.membership) || pending.length) return;
    const activity = category === 'learning' ? activities.find(value => value.value === selection) : undefined;
    if (selection && category === 'learning' && !activity) { setActivityError('Choose an available activity, or remove the link to continue.'); return; }
    const start = { type: 'start', deviceId: ids.tab, mode, category, title: title.trim() || activity?.title || (category === 'work' ? 'Focused work' : 'Focused learning'), enrollmentId: activity?.enrollmentId ?? null, taskId: activity?.taskId ?? null, settings: mode === 'solo' ? settings : null, previousSessionId: mode === 'solo' ? previous?.id ?? null : null } as SoloStartAction;
    if (roomBridge?.switchFromRoom && !switchConfirmed) return;
    const response = roomBridge?.switchFromRoom ? await roomBridge.startSolo(start) : await act(start);
    if (response) navigate('/app/focus'); else setFailure(true);
  }
  return <div className="focus-setup-grid">
    <form className="focus-setup" onSubmit={event => void submit(event)}>
      <h2>{previous && mode === 'solo' ? 'Make room for another round.' : 'Make space for one thing.'}</h2>
      <p>Choose a timer and begin. Add a title or course activity only if you need one.</p>{roomBridge && !roomBridge.ready && <Notice>{roomBridge.error || "Checking your current room before starting…"}<button type="button" className="quiet" onClick={() => void roomBridge.refresh()}>Check room connection</button></Notice>}{roomBridge?.membership && roomBridge.error && <Notice error>{roomBridge.error}</Notice>}{roomBridge?.switchFromRoom && <label className="focus-check"><input type="checkbox" checked={switchConfirmed} onChange={event => setSwitchConfirmed(event.target.checked)}/>Finish my current room focus and start this solo session. If I still have a seat, leave it too. The switch happens only if the new session can start.</label>}
      <fieldset className="focus-segment"><legend>What are you focusing on?</legend>{(['work', 'learning'] as const).map(value => <label key={value}><input type="radio" name="category" value={value} checked={category === value} onChange={() => setCategory(value)}/><span>{value === 'work' ? 'Work' : 'Learning'}</span></label>)}</fieldset>
      <fieldset className="focus-segment focus-timer-options"><legend>Timer type</legend>{(['solo', 'open'] as const).map(value => <label key={value}><input type="radio" name="rhythm" aria-label={value === 'solo' ? 'Pomodoro' : 'Open focus'} checked={mode === value} onChange={() => setMode(value)}/><span>{value === 'solo' ? 'Pomodoro' : 'Open focus'}<small>{value === 'solo' ? 'A focus round, then a break' : 'Count up at your own pace'}</small></span></label>)}</fieldset>
      {mode === 'solo' ? <><label>Focus and break preset<select value={preset} onChange={event => choosePreset(event.target.value)}><option value="15">15 min focus · 3 min break · Start small</option><option value="25">25 min focus · 5 min break</option><option value="50">50 min focus · 10 min break</option><option value="custom">Custom timings</option></select></label>{preset === 'custom' && <div className="focus-custom">{([['focusMinutes', 'Focus minutes', 5, 90], ['shortBreakMinutes', 'Short break minutes', 1, 30], ['longBreakMinutes', 'Long break minutes', 5, 60], ['longBreakAfter', 'Rounds before long break', 2, 6]] as const).map(([key, label, min, max]) => <label key={key}>{label}<input type="number" min={min} max={max} step="1" required value={settings[key]} onChange={event => setSettings(value => ({ ...value, [key]: Number(event.target.value) }))}/></label>)}</div>}<p className="focus-caption">{settings.focusMinutes} min focus · {settings.shortBreakMinutes} min short break · {settings.longBreakMinutes} min long break after {settings.longBreakAfter} rounds. Breaks never count as focus time.</p></> : <p className="focus-caption">An open session stops counting at its four-hour safety boundary and asks for review. You can pause or finish earlier.</p>}
      <details className="focus-session-details" open={detailsOpen || unresolvedActivity} onToggle={event => setDetailsOpen(event.currentTarget.open)}>
        <summary>Add session details <span className="focus-optional">optional</span></summary>
        <div className="focus-session-details-body">
      <label>Session title <span className="focus-optional">optional, private</span><input maxLength={160} value={title} onChange={event => setTitle(event.target.value)} placeholder={category === 'work' ? 'What would you like to work on?' : 'What would you like to learn?'}/></label>
      {category === 'learning' && <>
        <label>Course<select value={selectedCourse} onChange={event => { setSelectedCourse(event.target.value); setActivitySearch(''); setSelection(''); setActivityError(''); }}>
          <option value="">No course selected</option>
          {selectedCourse && !courses.some(([id]) => id === selectedCourse) && <option value={selectedCourse}>{activitiesLoaded ? 'Selected course is unavailable' : 'Checking selected course…'}</option>}
          {courses.map(([id, course]) => <option key={id} value={id}>{course}</option>)}
        </select></label>
        {courseActivities.length > 20 && <label>Find an activity<input type="search" value={activitySearch} onChange={event => setActivitySearch(event.target.value)} placeholder="Search activity titles"/>{activitySearch && <small className="focus-caption">{matchingActivities.length} matching activities. Your selected activity stays linked until you change it.</small>}</label>}
        <label>Link a course activity <span className="focus-optional">optional</span><select value={selection} disabled={!selectedCourse} onChange={event => { setSelection(event.target.value); setActivityError(''); }}>
          <option value="">Focus without an activity</option>
          {selection && !courseActivities.some(activity => activity.value === selection) && <option value={selection}>{activitiesLoaded ? 'Selected activity is unavailable' : 'Checking selected activity…'}</option>}
          {visibleActivities.map(activity => <option key={activity.value} value={activity.value}>{activity.title}{activity.completed ? ' · Completed — revisit' : ''}</option>)}
        </select></label>
        {!selectedCourse && <p className="focus-caption">Choose a course to find an activity, or start without linking one.</p>}
      </>}
          <p className="focus-caption">Your title and linked activity stay private. The timer records time; it does not mark the activity complete.</p>
        </div>
      </details>
      {activityError && <Notice error>{activityError}</Notice>}
      {category === 'learning' && activityLoadError && <Notice error>{activityLoadError}<button type="button" className="secondary" onClick={() => { setActivityLoadError(''); setActivitiesLoaded(false); setActivityAttempt(value => value + 1); }}>Retry activities</button></Notice>}
      {failure && <Notice error>Start was not confirmed. Your choices are still here. Check the session state before retrying.</Notice>}
      {!online && <Notice>A connection is required to start or resume a session.</Notice>}
      <button className="focus-start" disabled={!ids || !online || busy || pending.length > 0 || loadingPrevious || unresolvedActivity || roomBridge?.ready === false || roomBridge?.switchFromRoom && !switchConfirmed}>{busy ? 'Starting…' : roomBridge?.switchFromRoom ? 'Finish room focus and start solo' : previous && mode === 'solo' ? 'Start next round' : 'Start focus'}</button>
      <FocusSoundControls/>
    </form>
    <aside className="focus-setup-aside" aria-label="Your session rhythm"><h3>{mode === 'solo' ? 'One round at a time.' : 'Space to find your flow.'}</h3><div className="focus-rhythm-preview"><span className="focus-preview-number">{mode === 'solo' ? formatTime(settings.focusMinutes * 60) : '00:00'}</span><span>{mode === 'solo' ? 'counting down when you start' : 'counting up when you start'}</span></div><ol className="focus-rhythm-steps"><li><strong>{mode === 'solo' ? `${settings.focusMinutes} minutes to focus` : 'Start with one thing'}</strong><span>Pause whenever you need.</span></li><li><strong>{mode === 'solo' ? `${previous && (previous.roundIndex + 1) % settings.longBreakAfter === 0 ? settings.longBreakMinutes : settings.shortBreakMinutes} minute break after this round` : 'Finish when you’re ready'}</strong><span>{mode === 'solo' ? 'Rest stays outside your focus time.' : 'Your session time is saved separately.'}</span></li><li><strong>You choose what comes next</strong><span>{mode === 'solo' ? 'The next round never starts automatically.' : 'At four hours, pause to review the record.'}</span></li></ol><p className="focus-caption">A timer records time. Course activities are completed separately.</p><a href="/app/progress/activity">Open your activity history</a></aside>
  </div>;
}

export function FocusSoundControls() {
  const { sound } = useFocus();
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState('');
  async function testSound() {
    setChecking(true);
    const played = await sound.test();
    setFeedback(played ? 'Test chime played.' : 'Sound could not play. Check this tab’s audio permissions and try again.');
    setChecking(false);
  }
  return <details className="focus-sound-controls"><summary aria-label="Session sound settings"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 4 6 8H3v8h3l5 4V4Z"/>{sound.status === 'ready' ? <><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></> : <path d="m16 9 6 6m0-6-6 6"/>}</svg>{sound.status === 'ready' ? 'Sound on' : sound.enabled ? 'Enable sound on this tab' : 'Sound off'}</summary><div className="focus-sound-panel"><p>A gentle chime when a focus round or break ends. Keep Dima open; a sleeping or closed tab can miss alerts.</p><div className="focus-actions"><button type="button" className="secondary" disabled={!sound.available || checking} onClick={() => void testSound()}>{checking ? 'Checking sound…' : sound.status === 'ready' ? 'Test sound' : 'Enable & test sound'}</button>{sound.enabled && <button type="button" className="quiet" onClick={() => { sound.mute(); setFeedback('Sound muted.'); }}>Mute sound</button>}</div>{!sound.available && <p role="status">Audio is unavailable in this browser. Timers and visual updates still work.</p>}{feedback && <p role="status">{feedback}</p>}<small>Saved for your account in this browser. Playback may need enabling again after reopening.</small></div></details>;
}

export function ActiveFocus({ session, showTitle = true }: { session: TimeSession; showTitle?: boolean }) {
  const { data, ids, online, pending } = useFocus();
  const now = useServerClock();
  if (!data) return null;
  const interval = openInterval(data, session);
  const entry = interval ? pending.find(value => value.command.sessionId === session.id && value.command.intervalId === interval.id) : undefined;
  const displayNow = entry ? Date.parse(entry.reportedEndAt) : now;
  const elapsed = sessionSeconds(session, data.intervals, displayNow);
  const remaining = remainingFocusSeconds(session, data.intervals, displayNow);
  const foreign = ids?.tab !== session.deviceId || now >= Date.parse(session.leaseUntil);
  return <section className={`focus-active is-${session.status}${entry ? ' is-pending' : ''}`} aria-label="Your focus session">
    <div className="focus-active-top"><span className="focus-status" role="status">{entry ? 'Stopped on this device · waiting to sync' : statusName(session)}</span><span>{session.category === 'work' ? 'Work' : 'Learning'} · {session.mode === 'solo' ? `Round ${session.roundIndex}` : session.mode === 'room' ? `Room · round ${session.roundIndex}` : 'Open focus'}</span></div>
    {showTitle && <h2>{session.title}</h2>}
    <div className="focus-clock-stage">
    <div className="focus-clock" role="timer" aria-label={session.mode === 'solo' ? 'Focus time remaining' : 'Elapsed focus time'}>{formatTime(session.mode === 'solo' ? remaining ?? 0 : elapsed)}</div>
    <p className="focus-clock-label">{entry ? session.mode === 'solo' ? 'remaining at your local stop' : 'elapsed at your local stop' : session.mode === 'solo' ? 'remaining in this round' : 'elapsed focus time'}{(!online || entry) && ' · not yet confirmed'}</p>
    {session.mode === 'solo' && session.settings && <><progress className="focus-round-progress" max={session.settings.focusMinutes * 60} value={Math.min(elapsed, session.settings.focusMinutes * 60)} aria-label="Focus round progress"/><p className="focus-caption">{formatTime(elapsed)} focused · {session.settings.focusMinutes} min round</p></>}
    </div>
    {entry ? <p>Resolve the stop request above. This display is held at your local stop; your server record will be confirmed when it syncs.</p> : <SessionControls session={session}/>}
    {foreign && !entry && <p className="focus-control-note">This session is controlled elsewhere or its control lease expired. Taking control moves the controls to this tab; it does not restart the clock.</p>}
    {!online && !entry && <Notice>The clock is estimated while offline. Stop can preserve your intent locally; it cannot create eligible time. A paused session adds no time.</Notice>}
    {session.status === 'paused' && <p className="focus-control-note">Time is paused. Resume when you’re ready; this pause won’t count toward your focus time.</p>}
    {session.status === 'needsReview' && <Notice>The open-focus safety boundary was reached. Review the saved interval before starting anything else.</Notice>}
    {session.enrollmentId && session.taskId && <a href={`/app/courses/${session.enrollmentId}/tasks/${encodeURIComponent(session.taskId)}`}>Open linked activity</a>}
    <FocusSoundControls/>
    <a className="focus-detail-link" href={sessionPath(session.id)}>View intervals and saved record</a>
  </section>;
}

export function FocusArea({ section, query }: { section: string; query: string }) {
  const { data, error, storageError, load, roomBridge } = useFocus();
  const navigate = useNavigate();
  const previousActive = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousActive.current;
    previousActive.current = data?.active?.id ?? null;
    if (section === 'focus' && new URLSearchParams(query).get('switch') !== 'solo' && previous && !data?.active && data?.sessions.some(session => session.id === previous && session.status === 'finalized')) navigate(sessionPath(previous));
  }, [data, section, query, navigate]);
  const sessionId = section.startsWith('progress/activity/') ? section.split('/')[2] : null;
  if (!data) return <div className="focus-root">{error ? <Notice error>{error}<button onClick={() => void load()}>Retry focus connection</button></Notice> : <p role="status">Opening your focus space…</p>}</div>;
  return <div className="focus-root">
    {section === "focus" && <nav className="focus-tabs" aria-label="Focus mode"><a href="/app/focus" aria-current="page">Focus alone</a><a href="/app/rooms">Study rooms</a></nav>}
    {error && <Notice error>{error}<button className="quiet" onClick={() => void load()}>Refresh session</button></Notice>}
    {storageError && <Notice error>{storageError}</Notice>}
    <PendingStops/>
    {sessionId ? <SessionDetail key={sessionId} sessionId={sessionId}/> : section.startsWith('progress') ? <ActivityHistory query={query}/> : data.active && !(data.active.mode === 'room' && new URLSearchParams(query).get('switch') === 'solo' && roomBridge?.membership) ? <ActiveFocus session={data.active}/> : <FocusSetup key={query} query={query}/>}
  </div>;
}

function browserTimezone() { return Intl.DateTimeFormat().resolvedOptions().timeZone; }

function BreakCard({ session, intervals }: { session: TimeSession; intervals: TimeInterval[] }) {
  const now = useServerClock();
  const { sound } = useFocus();
  const notify = sound.notify;
  const [chosenEnd, setChosenEnd] = useState<number | null>(null);
  const [skipped, setSkipped] = useState(false);
  const observed = useRef(0);
  const eligible = session.mode === 'solo' && !!session.settings && !!session.finalizedAt;
  const long = !!session.settings && session.roundIndex % session.settings.longBreakAfter === 0;
  const minutes = session.settings ? long ? session.settings.longBreakMinutes : session.settings.shortBreakMinutes : 0;
  const endedAtBoundary = intervals.some(interval => interval.sessionId === session.id && interval.endAt === interval.boundaryAt);
  const end = eligible ? chosenEnd ?? (endedAtBoundary ? Date.parse(session.finalizedAt!) + minutes * 60000 : null) : null;
  const left = end ? Math.max(0, (end - now) / 1000) : 0;
  useEffect(() => {
    if (crossedDeadline(observed.current, now, end)) void notify(`break:${session.id}:${end}`, end!, now);
    observed.current = now;
  }, [end, now, notify, session.id]);
  if (!eligible) return null;
  return <section className="focus-break">
    <div><h3>{end && left > 0 && !skipped ? `${long ? 'Long' : 'Short'} break` : 'Your next round is your choice.'}</h3>
    {end && left > 0 && !skipped ? <><div className="focus-break-clock" role="timer" aria-label="Break time remaining">{formatTime(left)}</div><p>No focus time is recorded during this break.</p></> : <p>{end ? left > 0 ? 'Break countdown hidden. Start the next round when you’re ready. Nothing starts automatically.' : 'The break is over. Nothing starts automatically.' : 'Take an optional break before deciding what comes next.'}</p>}</div>
    <div className="focus-break-actions">
      {end && left > 0 && <button className="secondary" onClick={() => setSkipped(value => !value)}>{skipped ? 'Show break countdown' : 'Hide break countdown'}</button>}
      {!end && !skipped && <button className="secondary" onClick={() => setChosenEnd(now + minutes * 60000)}>Take a {minutes} min break</button>}
      <a className="account-button-link" href={`/app/focus?after=${session.id}`}>Set up next round</a>
      <a className="focus-done-link" href="/app/today">Done for now</a>
      <FocusSoundControls/>
    </div>
  </section>;
}

function IntervalCorrection({ session, interval, close }: { session: TimeSession; interval: TimeInterval; close: () => void }) {
  const { busy, online, act } = useFocus();
  const [end, setEnd] = useState(localInput(interval.effectiveEndAt ?? interval.endAt ?? interval.boundaryAt));
  const [confirmed, setConfirmed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [timeError, setTimeError] = useState('');
  const parsedEnd = parseLocalTime(end);
  const seconds = parsedEnd ? Math.max(0, (parsedEnd.getTime() - Date.parse(interval.startAt)) / 1000) : NaN;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!parsedEnd) { setTimeError('That local time does not exist, or is invalid. Clock changes can skip an hour; choose a valid time.'); return; }
    setTimeError('');
    const response = await act({ type: 'correctInterval', sessionId: session.id, intervalId: interval.id, reportedEndAt: parsedEnd.toISOString(), confirmPersonal: true });
    if (response) close(); else setFailed(true);
  }
  return <form className="focus-correction" onSubmit={event => void submit(event)}>
    <h3>Correct this interval’s end</h3>
    <p>Times below use your browser timezone: <strong>{browserTimezone()}</strong>. This changes your personal record; it cannot add ranked time.</p>
    <label>Actual stop time<input type="datetime-local" step="1" required min={localInput(interval.startAt)} max={localInput(interval.effectiveEndAt ?? interval.endAt ?? interval.boundaryAt)} value={end} onChange={event => { setEnd(event.target.value); setConfirmed(false); }}/></label>
    <p>Proposed personal duration: <strong>{Number.isFinite(seconds) ? formatTime(seconds) : 'Choose a valid time'}</strong>. Earlier intervals are preserved.</p>
    <label className="focus-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>I understand this interval becomes personal time, outside rankings.</label>
    {timeError && <Notice error>{timeError}</Notice>}
    {failed && <Notice error>Correction was not saved. Your time and confirmation remain here for review.</Notice>}
    <div className="focus-actions"><button className="secondary" type="button" disabled={busy} onClick={close}>Cancel correction</button><button disabled={busy || !online || !confirmed}>Save personal correction</button></div>
  </form>;
}

function SessionDetail({ sessionId }: { sessionId: string }) {
  const { data, read, profile, ids, busy, online, act } = useFocus();
  const now = useServerClock();
  const [detail, setDetail] = useState<TimeData | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void read(`?sessionId=${encodeURIComponent(sessionId)}`).then(value => { if (!cancelled) { setDetail(value); setFailed(false); } }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [sessionId, read, data?.revision, attempt]);
  const snapshot = data && (data.sessions.some(value => value.id === sessionId) || data.active?.id === sessionId) && Date.parse(data.serverTime) >= Date.parse(detail?.serverTime ?? '1900-01-01') ? data : detail;
  const session = snapshot?.sessions.find(value => value.id === sessionId) ?? (snapshot?.active?.id === sessionId ? snapshot.active : undefined);
  if (!detail || !session) return <><a href="/app/progress/activity">Back to activity</a>{failed || detail ? <Notice error>This session could not be opened. It may be unavailable in this account.<button className="secondary" onClick={() => setAttempt(value => value + 1)}>Retry session</button></Notice> : <p role="status">Opening this session…</p>}</>;
  const intervals = snapshot!.intervals.filter(value => value.sessionId === session.id);
  const corrections = snapshot!.corrections.filter(value => value.sessionId === session.id);
  const taskPath = session.enrollmentId && session.taskId ? `/app/courses/${session.enrollmentId}/tasks/${encodeURIComponent(session.taskId)}` : null;
  const mine = ids?.tab === session.deviceId && now < Date.parse(session.leaseUntil);
  return <>
    <a className="learning-back" href="/app/progress/activity">Back to activity</a>
    <header className="focus-detail-heading"><span className="focus-status">{statusName(session)}</span><h2>{session.title}</h2><p>{session.category === 'work' ? 'Work' : 'Learning'} · {intervals.every(value => value.source === 'manual') ? 'Manual personal entry' : session.mode === 'solo' ? `Pomodoro · round ${session.roundIndex}` : session.mode === 'room' ? `Room · round ${session.roundIndex}` : 'Open focus'}</p></header>
    <div className="focus-summary-time"><strong>{formatTime(sessionSeconds(session, intervals, now))}</strong><span>{session.status === 'finalized' ? 'saved focus time' : 'time so far · session not finalized'}</span></div>
    <p className="focus-caption">Personal time stays outside rankings. Course progress is separate from the timer.</p>
    {failed && <Notice error>Couldn’t refresh this saved record. Your last loaded time is shown.<button className="secondary" onClick={() => setAttempt(value => value + 1)}>Retry session</button></Notice>}
    {session.status !== 'finalized' && <SessionControls session={session}/>}
    {session.status === 'needsReview' && <section className="focus-review"><h3>Review the safety boundary</h3><p>The open timer reached its four-hour boundary. If you stopped earlier, correct the affected interval below first.</p><label className="focus-check"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)}/>I reviewed the recorded time up to its saved boundary.</label><button disabled={!reviewed || !online || !mine || busy} onClick={() => ids && void act({ type: 'review', sessionId: session.id, deviceId: ids.tab, controlVersion: session.controlVersion, acceptCap: true })}>Accept reviewed session</button></section>}
    {session.status === 'finalized' && <>
      {taskPath && <section className="focus-outcome"><h3>What happened with your activity?</h3><p>This is separate from the timer. Choose only when you are ready; leaving this page keeps the activity unchanged.</p><div className="focus-actions"><a className="account-button-link" href={`${taskPath}?action=worked`}>Record partial work</a><a className="learning-link is-secondary" href={`${taskPath}?action=complete`}>Review activity completion</a><a href={taskPath}>Return to activity</a></div></section>}
      <BreakCard session={session} intervals={intervals}/>
      {session.mode === 'room' && <a className="account-button-link" href={`/app/rooms/${session.roomId}`}>Return to room</a>}
      {session.mode !== 'solo' && <a className={session.mode === 'room' ? 'learning-link is-secondary' : 'account-button-link'} href="/app/focus">Set up another session</a>}
    </>}
    <details className="focus-record-details" open={recordsOpen || session.status !== 'finalized' || correcting !== null || intervals.some(interval => interval.eligibility === 'pending')} onToggle={event => setRecordsOpen(event.currentTarget.open)}>
      <summary>Time details and corrections</summary>
      <section className="focus-intervals"><h3>Intervals and source</h3><p className="focus-caption">Displayed in {profile.timezone}. Only actual focus intervals are included; pause gaps and breaks are excluded.</p>
      {intervals.map((interval, index) => <article key={interval.id}>
        <div className="focus-interval-heading"><strong>Interval {index + 1}</strong><span className={`focus-eligibility is-${interval.eligibility}`}>{interval.eligibility === 'eligible' ? 'Eligible timer interval' : interval.eligibility === 'personal' ? 'Personal · outside rankings' : 'Pending review'}</span></div>
        <p>{instant(interval.startAt, profile.timezone)} → {interval.effectiveEndAt || interval.endAt ? instant(interval.effectiveEndAt ?? interval.endAt!, profile.timezone) : 'Running'}</p>
        <small>Source: {interval.source === 'manual' ? 'Manual entry' : 'Server-accepted timer'} · Boundary: {instant(interval.boundaryAt, profile.timezone)}</small>
        {interval.endAt && <button className="quiet" onClick={() => setCorrecting(correcting === interval.id ? null : interval.id)}>{correcting === interval.id ? 'Close correction' : 'Correct personal end time'}</button>}
        {correcting === interval.id && <IntervalCorrection key={interval.id} session={session} interval={interval} close={() => setCorrecting(null)}/>}
      </article>)}
      </section>
    </details>
    {corrections.length > 0 && <section className="focus-corrections"><h3>Correction history</h3>{corrections.map(value => <p key={value.id}>{value.reason === 'offline-stop' ? 'Offline stop' : 'Personal correction'}: {instant(value.previousEndAt, profile.timezone)} → {instant(value.reportedEndAt, profile.timezone)}. Original receipt remains in the record.</p>)}</section>}
  </>;
}

function ManualTime({ close, initialCategory = 'work' }: { close: () => void; initialCategory?: 'learning' | 'work' }) {
  const { data, busy, online, act } = useFocus();
  const now = useServerClock();
  const latestTime = now ? new Date(now).toISOString() : data?.serverTime;
  const [category, setCategory] = useState<'learning' | 'work'>(initialCategory);
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [failed, setFailed] = useState(false);
  const [timeError, setTimeError] = useState('');
  const navigate = useNavigate();
  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsedStart = parseLocalTime(start);
    const parsedEnd = parseLocalTime(end);
    if (!parsedStart || !parsedEnd) { setTimeError('A local time does not exist, or is invalid. Clock changes can skip an hour; choose valid start and end times.'); return; }
    setTimeError('');
    const response = await act({ type: 'manual', category, title: title.trim() || 'Manual time', startAt: parsedStart.toISOString(), endAt: parsedEnd.toISOString() });
    if (response?.receipt?.sessionId) { close(); navigate(sessionPath(response.receipt.sessionId)); }
    else setFailed(true);
  }
  return <form className="focus-manual" onSubmit={event => void submit(event)}>
    <h3>Add personal time</h3><p>Manual time is for your own record and stays outside rankings. It must not overlap a timer or another manual entry.</p>
    <p className="focus-caption">Enter times in your browser timezone: <strong>{browserTimezone()}</strong>. History is displayed in your account timezone.</p>
    <label>Kind of activity<select value={category} onChange={event => setCategory(event.target.value as typeof category)}><option value="work">Work</option><option value="learning">Learning</option></select></label>
    <label>Title <span className="focus-optional">optional, private</span><input maxLength={160} value={title} onChange={event => setTitle(event.target.value)}/></label>
    <div className="focus-custom"><label>Start time<input type="datetime-local" step="1" required max={latestTime ? localInput(latestTime) : undefined} value={start} onChange={event => setStart(event.target.value)}/></label><label>End time<input type="datetime-local" step="1" required min={start || undefined} max={latestTime ? localInput(latestTime) : undefined} value={end} onChange={event => setEnd(event.target.value)}/></label></div>
    {timeError && <Notice error>{timeError}</Notice>}
    {failed && <Notice error>Manual time was not saved. Check for an overlapping period or invalid date; your entries are still here.</Notice>}
    <div className="focus-actions"><button className="secondary" type="button" disabled={busy} onClick={close}>Cancel manual entry</button><button disabled={!online || busy || !start || !end || new Date(end) <= new Date(start)}>Save personal time</button></div>
  </form>;
}

function ActivityHistory({ query }: { query: string }) {
  const { data, read, profile } = useFocus();
  const navigate = useNavigate();
  const params = new URLSearchParams(query);
  const requestedCategory = params.get('category');
  const category = requestedCategory === 'work' || requestedCategory === 'learning' ? requestedCategory : '';
  const cursor = params.get('cursor') ?? '';
  const listKey = JSON.stringify([category, cursor]);
  const [resource, setResource] = useState<{ key: string; value: TimeData } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const list = resource?.key === listKey ? resource.value : null;
  const failed = failedKey === listKey;
  const [manual, setManual] = useState(params.get('manual') === '1');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const search = new URLSearchParams({ limit: '20', ...(category ? { category } : {}), ...(cursor ? { cursor } : {}) });
    void read(`?${search}`).then(value => { if (!cancelled) { setResource({ key: listKey, value }); setFailedKey(null); } }).catch(() => { if (!cancelled) setFailedKey(listKey); });
    return () => { cancelled = true; };
  }, [read, category, cursor, listKey, data?.revision, attempt]);
  const now = useServerClock();
  const visibleSessions = list?.sessions.filter(session => !category || session.category === category) ?? [];
  return <>
    <div className="focus-history-heading"><div><h2>Your time, with its source.</h2><p>Timer sessions and personal entries share one record. Course completion does not add time.</p></div><button onClick={() => setManual(!manual)}>{manual ? 'Close manual entry' : 'Add manual time'}</button></div>
    {manual && <ManualTime initialCategory={category || 'work'} close={() => setManual(false)}/>}
    <label className="focus-filter">Show activity<select value={category} onChange={event => navigate(`/app/progress/activity${event.target.value ? `?category=${event.target.value}` : ''}`)}><option value="">Work and learning</option><option value="work">Work</option><option value="learning">Learning</option></select></label>
    {list && <div className="focus-history-totals" aria-label="Time totals"><div><span>Eligible timer time</span><strong>{formatTime(list.totals.eligibleSeconds)}</strong></div><div><span>Personal time</span><strong>{formatTime(list.totals.personalSeconds)}</strong></div><div><span>Pending / active</span><strong>{formatTime(list.totals.pendingSeconds)}</strong></div></div>}
    {list && <p className="focus-caption">Account totals from the server, separate from this page of activity. {profile.timezone}.</p>}
    {failed ? <Notice error>Couldn’t load this page of activity. <button className="secondary" onClick={() => setAttempt(value => value + 1)}>Retry activity</button></Notice> : !list ? <p role="status">Opening your activity…</p> : !visibleSessions.length ? <section className="focus-empty"><h3>{category ? `No ${category} sessions match this view.` : cursor ? 'No sessions on this page.' : 'No recorded sessions here yet.'}</h3><p>{category ? 'Try all activity, or start a session in this category.' : cursor ? 'Return to your most recent activity, or start a new session.' : 'A small session is a good place to begin.'}</p><div className="focus-actions"><a className="account-button-link" href={`/app/focus${category ? `?category=${category}` : ''}`}>Set up focus</a>{category && <a href="/app/progress/activity">Show all activity</a>}</div></section> : <div className="focus-history-list">{visibleSessions.map(session => {
      const manualEntry = list.intervals.filter(interval => interval.sessionId === session.id).every(interval => interval.source === 'manual');
      return <a href={sessionPath(session.id)} key={session.id}><div><strong>{session.title}</strong><span>{session.category === 'work' ? 'Work' : 'Learning'} · {manualEntry ? 'Manual · personal' : session.mode === 'solo' ? 'Pomodoro' : session.mode === 'room' ? 'Room focus' : 'Open focus'}</span><small>{instant(session.createdAt, profile.timezone)}</small></div><div><strong>{formatTime(sessionSeconds(session, list.intervals, now))}</strong><span>{statusName(session)}</span></div></a>;
    })}</div>}
    <div className="focus-actions">{cursor && <a href={`/app/progress/activity${category ? `?category=${category}` : ''}`}>Most recent activity</a>}{list?.nextCursor && <a href={`/app/progress/activity?${new URLSearchParams({ cursor: list.nextCursor, ...(category ? { category } : {}) })}`}>Older activity</a>}</div>
  </>;
}
