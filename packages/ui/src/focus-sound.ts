'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type FocusSoundStatus = 'off' | 'ready' | 'needsGesture' | 'unavailable';
export type FocusSound = {
  enabled: boolean;
  available: boolean;
  status: FocusSoundStatus;
  enable: () => Promise<boolean>;
  test: () => Promise<boolean>;
  mute: () => void;
  notify: (key: string, occurredAt: number, serverNow?: number) => Promise<boolean>;
};
type SoundState = Pick<FocusSound, 'enabled' | 'available' | 'status'>;
type SoundEnvironment = {
  createContext?: () => AudioContext;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  lock?: (name: string, action: () => boolean) => Promise<boolean>;
};
const freshnessMs = 15_000;

/** Callers supply authoritative server time; a resumed tab must not replay old boundaries. */
export function isFreshSoundEvent(key: string, occurredAt: number, serverNow: number) {
  return key.length > 0 && key.length <= 240 && Number.isFinite(occurredAt) && Number.isFinite(serverNow)
    && serverNow >= occurredAt && serverNow - occurredAt <= freshnessMs;
}

/** A single account-scoped player, owned by the persistent Focus provider. No timer/ledger writes. */
export function createFocusSoundPlayer(owner: string, environment: SoundEnvironment, changed: (state: SoundState) => void) {
  const preferenceKey = `dima:focus-sound:v1:${owner}`;
  const eventsKey = `${preferenceKey}:events`;
  let enabled = false;
  let disposed = false;
  let generation = 0;
  let context: AudioContext | null = null;
  let lastChimeAt = -Infinity;
  const seen = new Map<string, number>();
  const tones = new Set<OscillatorNode>();
  function read(key: string) { try { return environment.storage?.getItem(key) ?? null; } catch { return null; } }
  function write(key: string, value: string) { try { environment.storage?.setItem(key, value); } catch { /* Session-local use remains available. */ } }
  enabled = read(preferenceKey) === 'on';
  function state(): SoundState {
    return { enabled, available: !!environment.createContext, status: !environment.createContext ? 'unavailable' : !enabled ? 'off' : context?.state === 'running' ? 'ready' : 'needsGesture' };
  }
  function publish() { if (!disposed) changed(state()); }
  function silence() {
    for (const oscillator of tones) { try { oscillator.stop(); } catch { /* Already ended. */ } oscillator.disconnect(); }
    tones.clear();
  }
  function play() {
    if (disposed || !enabled || context?.state !== 'running') return false;
    try {
      const start = context.currentTime;
      for (const [frequency, offset] of [[660, 0], [880, 0.18]]) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine'; oscillator.frequency.value = frequency;
        const at = start + offset;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.075, at + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.32);
        oscillator.connect(gain); gain.connect(context.destination);
        tones.add(oscillator);
        oscillator.onended = () => { tones.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(at); oscillator.stop(at + 0.34);
      }
      return true;
    } catch { silence(); return false; }
  }
  async function enable() {
    if (disposed || !environment.createContext) return false;
    const attempt = ++generation;
    enabled = true; write(preferenceKey, 'on');
    try {
      // Construction and resume happen in the caller's click handler, before awaiting anything.
      if (!context || context.state === 'closed') {
        context = environment.createContext();
        context.onstatechange = publish;
      }
      const resumed = context.resume();
      publish();
      await resumed;
      if (disposed || generation !== attempt || !enabled) return false;
      publish();
      return play();
    } catch { publish(); return false; }
  }
  function mute() { generation++; enabled = false; silence(); write(preferenceKey, 'off'); publish(); }
  function synchronizePreference() {
    const next = read(preferenceKey) === 'on';
    if (next !== enabled) { generation++; enabled = next; if (!enabled) silence(); publish(); }
  }
  function storedEvents(): Record<string, number> {
    try {
      const parsed: unknown = JSON.parse(read(eventsKey) ?? '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter(([key, value]) => key.length <= 240 && typeof value === 'number' && Number.isFinite(value)));
    } catch { return {}; }
  }
  async function notify(key: string, occurredAt: number, serverNow = Date.now()) {
    if (disposed || !enabled || context?.state !== 'running' || !isFreshSoundEvent(key, occurredAt, serverNow)) return false;
    const attempt = generation;
    const queuedAt = performance.now();
    const claimAndPlay = () => {
      if (disposed || attempt !== generation || !enabled || context?.state !== 'running'
        || !isFreshSoundEvent(key, occurredAt, serverNow + Math.max(0, performance.now() - queuedAt))) return false;
      const stored = storedEvents();
      if (seen.has(key) || Object.hasOwn(stored, key)) return false;
      seen.set(key, occurredAt);
      while (seen.size > 128) seen.delete(seen.keys().next().value!);
      const entries = [...Object.entries(stored), [key, occurredAt] as [string, number]]
        .filter(([, at]) => at >= serverNow - 86_400_000).sort((a, b) => b[1] - a[1]).slice(0, 128);
      write(eventsKey, JSON.stringify(Object.fromEntries(entries)));
      // A room boundary and its personal-session settlement can describe the same instant.
      if (Math.abs(occurredAt - lastChimeAt) < 2000) return false;
      lastChimeAt = occurredAt;
      return play();
    };
    try { return environment.lock ? await environment.lock(preferenceKey, claimAndPlay) : claimAndPlay(); }
    catch { return false; }
  }
  function dispose() {
    disposed = true; generation++; silence();
    if (context) { context.onstatechange = null; void context.close().catch(() => undefined); }
    context = null;
  }
  return { state, enable, test: enable, mute, notify, synchronizePreference, preferenceKey, dispose };
}

export function useFocusSound(owner: string): FocusSound {
  const player = useRef<ReturnType<typeof createFocusSoundPlayer> | null>(null);
  const [state, setState] = useState<SoundState>({ enabled: false, available: false, status: 'off' });
  useEffect(() => {
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* Browser privacy mode may deny storage. */ }
    const current = createFocusSoundPlayer(owner, {
      createContext: typeof window.AudioContext === 'function' ? () => new AudioContext() : undefined,
      storage,
      lock: navigator.locks ? (name, action) => navigator.locks.request(name, action) : undefined,
    }, setState);
    player.current = current;
    queueMicrotask(() => { if (player.current === current) setState(current.state()); });
    const sync = (event: StorageEvent) => { if (event.key === current.preferenceKey || event.key === null) current.synchronizePreference(); };
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener('storage', sync); current.dispose(); if (player.current === current) player.current = null; };
  }, [owner]);
  const enable = useCallback(() => player.current?.enable() ?? Promise.resolve(false), []);
  const test = useCallback(() => player.current?.test() ?? Promise.resolve(false), []);
  const mute = useCallback(() => player.current?.mute(), []);
  const notify = useCallback((key: string, occurredAt: number, serverNow?: number) => player.current?.notify(key, occurredAt, serverNow) ?? Promise.resolve(false), []);
  return { ...state, enable, test, mute, notify };
}
