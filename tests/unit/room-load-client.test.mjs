import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRoomLoadClient, createRoomOperation, closedGrantDelay, transientGrantDelay } from '../helpers/room-load-client.mjs';

const clients = [];
const iso = milliseconds => new Date(milliseconds).toISOString();
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-02T12:00:00Z')); });
afterEach(() => { clients.splice(0).forEach(client => client.close()); vi.useRealTimers(); });

function fixture() {
  const initial = Date.now();
  const state = { timeRevision: 0, roomRevision: 1, round: 1, hint: 1, membershipStatus: 'active', controlVersion: 1, active: null, intervals: [], sessions: [] };
  const room = () => ({ id: 'room', version: 1, hintVersion: state.hint,
    run: { id: 'run', startedAt: iso(initial), status: 'active' },
    phase: { kind: 'focus', roundIndex: state.round, endsAt: iso(state.phaseEndsAt ?? initial + 1500000) } });
  const time = () => ({ accountId: 'owner', revision: state.timeRevision, serverTime: iso(Date.now()),
    active: state.active, intervals: state.intervals, sessions: state.sessions });
  const me = () => ({ accountId: 'owner', revision: state.roomRevision, serverTime: iso(Date.now()), timeRevision: state.timeRevision,
    membership: { id: 'member', roomId: 'room', status: state.membershipStatus, deviceId: 'primary', controlVersion: state.controlVersion, seatExpiresAt: iso(initial + 180000) }, room: room() });
  const snapshot = () => ({ accountId: 'owner', serverTime: iso(Date.now()), me: me(), room: room(),
    access: { membershipId: 'member', generation: state.controlVersion, seatExpiresAt: iso(initial + 180000) }, participants: [{ displayName: 'Member' }],
    capabilities: { canJoinRound: !state.active } });
  const calls = [], errors = [], requestMetadata = [];
  let intercept = null;
  const request = async (path, metadata) => {
    calls.push(path);
    requestMetadata.push({ path, ...metadata });
    if (intercept) { const result = intercept(path); if (result !== undefined) return result; }
    if (path === 'time?limit=1') return { data: globalThis.structuredClone(time()) };
    if (path === 'rooms/me?roomId=room') return { data: globalThis.structuredClone(me()) };
    if (path === 'rooms/room/snapshot') {
      if (state.membershipStatus !== 'active') throw Object.assign(new Error('removed'), { status: 403, code: 'REJOIN_REQUIRED' });
      return { data: globalThis.structuredClone(snapshot()) };
    }
    if (path === 'learning' || path.startsWith('time?sessionId=')) return { data: {} };
    throw new Error(`Unexpected ${path}`);
  };
  function client() {
    const value = createRoomLoadClient({ owner: 'owner', roomId: 'room', request, now: () => Date.now(), onError: (stage, error) => errors.push({ stage, code: error.code }) });
    clients.push(value); return value;
  }
  async function seed(value) { await Promise.all([value.loadTime(), value.loadMe()]); await value.snapshotFor(); await value.settle(); }
  function start() {
    state.timeRevision++;
    state.active = { id: 'session', status: 'running', mode: 'room', roomId: 'room', roundIndex: 1 };
    state.sessions = [state.active];
    state.intervals = [{ id: 'interval', sessionId: 'session', endAt: null, boundaryAt: iso(initial + 1000) }];
  }
  return { state, calls, errors, requestMetadata, me, time, snapshot, client, seed, start, intercept: value => { intercept = value; } };
}

it('keeps secondary TimeData independent and applies snapshot timeRevision through a coalesced read', async () => {
  const f = fixture(), primary = f.client(), secondary = f.client();
  await f.seed(primary); await f.seed(secondary); f.calls.length = 0;
  f.start();
  primary.acceptTime(f.time(), true);
  expect(secondary.time.revision).toBe(0);
  await secondary.refreshKnown(); await secondary.settle();
  expect(secondary.time.revision).toBe(1);
  expect(f.calls.filter(path => path === 'time?limit=1')).toHaveLength(1);
  expect(secondary.time).not.toBe(primary.time);
});

it('accepts cached JoinRound results without pre-reading me and retains the real auxiliary time read', async () => {
  const f = fixture(), tab = f.client(); await f.seed(tab); f.calls.length = 0; f.start();
  await tab.acceptCommand({ data: f.me(), time: f.time() }, 'joinRound'); await tab.settle();
  expect(tab.time.active.id).toBe('session');
  expect(f.calls).not.toContain('rooms/me?roomId=room');
  expect(f.calls.filter(path => path === 'time?limit=1')).toHaveLength(1);
  expect(f.calls.filter(path => path === 'rooms/room/snapshot')).toHaveLength(1);
});

it('retains a snapshot after every renewal without adding unconditional time/me reads', async () => {
  const f = fixture(), tab = f.client(); await f.seed(tab); f.calls.length = 0;
  await tab.acceptCommand({ data: f.me(), time: f.time() }, 'renewPresence'); await tab.settle();
  expect(f.calls).toEqual(['rooms/room/snapshot']);
});

it('does not discard an accepted session or command identity because its follow-up snapshot failed', async () => {
  const f = fixture(), tab = f.client(), operation = createRoomOperation(() => 'operation');
  await f.seed(tab); f.start();
  operation.prepare({ type: 'joinRound', roundIndex: 1 }, 1); operation.succeeded();
  f.intercept(path => { if (path.endsWith('/snapshot')) throw Object.assign(new Error('unavailable'), { code: 'UNAVAILABLE', status: 503 }); });
  await tab.acceptCommand({ data: f.me(), time: f.time() }, 'joinRound'); await tab.settle();
  expect(tab.time.active.id).toBe('session'); expect(operation.pending).toBeNull();
  expect(f.errors).toEqual([{ stage: 'snapshot-read', code: 'UNAVAILABLE' }]);
});

it('serializes a held hint chain and sends one trailing fresh chain without restoring stale data', async () => {
  const f = fixture(), tab = f.client(); await f.seed(tab); f.calls.length = 0;
  const held = deferred(), old = globalThis.structuredClone(f.snapshot()); let heldOnce = false;
  f.intercept(path => { if (path.endsWith('/snapshot') && !heldOnce) { heldOnce = true; return held.promise; } });
  tab.connected(); await vi.advanceTimersByTimeAsync(120);
  expect(f.calls).toEqual(['rooms/room/snapshot']);
  tab.invalidate(2); tab.invalidate(3); tab.invalidate(4); f.state.hint = 4;
  expect(tab.epoch).toBeGreaterThan(3);
  held.resolve({ data: old }); await tab.settle();
  await vi.advanceTimersByTimeAsync(120); await tab.settle();
  expect(f.calls.filter(path => path === 'rooms/me?roomId=room')).toHaveLength(0);
  expect(f.calls.filter(path => path === 'rooms/room/snapshot')).toHaveLength(2);
  expect(tab.snapshot.room.hintVersion).toBe(4);
});

it('awaits one bounded fresh snapshot when a newer me response overtakes an old snapshot', async () => {
  const f = fixture(), tab = f.client(); await f.seed(tab); f.calls.length = 0;
  const held = deferred(), old = globalThis.structuredClone(f.snapshot()); let once = false;
  f.intercept(path => { if (path.endsWith('/snapshot') && !once) { once = true; return held.promise; } });
  const read = tab.snapshotFor(); await Promise.resolve();
  await vi.advanceTimersByTimeAsync(10); await tab.loadMe();
  held.resolve({ data: old }); await read; await tab.settle();
  expect(f.calls.filter(path => path.endsWith('/snapshot'))).toHaveLength(2);
  expect(tab.snapshot.serverTime).toBe(iso(Date.now()));
});

it('retains current Work-view activity-list requests on each round mount, but not each refresh', async () => {
  const f = fixture(), tab = f.client(); await f.seed(tab);
  await tab.snapshotFor(); await tab.settle();
  expect(f.calls.filter(path => path === 'learning')).toHaveLength(1);
  f.state.round = 2; f.state.hint++;
  await tab.snapshotFor(); await tab.settle();
  expect(f.calls.filter(path => path === 'learning')).toHaveLength(2);
});

it('runs a personal boundary time read for each tab and reconciles each room cache', async () => {
  const f = fixture(); f.start(); const first = f.client(), second = f.client();
  await f.seed(first); await f.seed(second); f.calls.length = 0;
  f.state.active = null; f.state.sessions = [{ id: 'session', status: 'finalized' }]; f.state.timeRevision++;
  await vi.advanceTimersByTimeAsync(1150); await first.settle(); await second.settle();
  expect(f.calls.filter(path => path === 'time?limit=1')).toHaveLength(2);
  expect(f.calls.filter(path => path === 'rooms/me?roomId=room')).toHaveLength(0);
  expect(f.calls.filter(path => path === 'rooms/room/snapshot')).toHaveLength(2);
  expect(first.me.timeRevision).toBe(f.state.timeRevision); expect(second.me.timeRevision).toBe(f.state.timeRevision);
  expect(first.time.active).toBeNull(); expect(second.time.active).toBeNull();
});

it('reconciles accepted Time through a separate floored snapshot while an ordinary snapshot is held', async () => {
  const f = fixture(), tab = f.client(); await f.seed(tab); f.calls.length = 0; f.requestMetadata.length = 0;
  const held = deferred(), stale = globalThis.structuredClone(f.snapshot()); let reads = 0;
  f.intercept(path => { if (path.endsWith('/snapshot') && ++reads === 1) return held.promise; });
  const ordinary = tab.snapshotFor(); await vi.advanceTimersByTimeAsync(1);
  f.state.timeRevision = 1;
  const acceptedTime = f.time(); tab.acceptTime(acceptedTime);
  await vi.advanceTimersByTimeAsync(0);
  expect(tab.me.timeRevision).toBe(1);
  expect(f.calls).toEqual(['rooms/room/snapshot', 'rooms/room/snapshot']);
  expect(f.requestMetadata[1]).toMatchObject({ reason: 'time-room-effect', minimumTimeRevision: 1,
    minimumServerTime: Date.parse(acceptedTime.serverTime) });
  held.resolve({ data: stale }); await ordinary; await tab.settle();
  expect(tab.snapshot.me.timeRevision).toBe(1); expect(tab.time.revision).toBe(1);
});

it('rejects a held ordinary roster after accepted Pause when the Time-floored snapshot is unavailable', async () => {
  const f = fixture(); f.start(); const tab = f.client(); await f.seed(tab); f.calls.length = 0;
  await vi.advanceTimersByTimeAsync(1);
  const held = deferred(), stale = globalThis.structuredClone(f.snapshot());
  stale.participants = [{ displayName: 'STALE-ORDINARY-AFTER-PAUSE' }]; let reads = 0;
  f.intercept(path => {
    if (!path.endsWith('/snapshot')) return;
    if (++reads === 1) return held.promise;
    throw Object.assign(new Error('unavailable'), { status: 503, code: 'UNAVAILABLE' });
  });
  const ordinary = tab.snapshotFor(); await vi.advanceTimersByTimeAsync(1);
  f.state.timeRevision++; f.state.active = { ...f.state.active, status: 'paused' };
  f.state.sessions = [f.state.active]; f.state.intervals[0].endAt = iso(Date.now());
  tab.acceptTime(f.time()); await vi.advanceTimersByTimeAsync(0);
  expect(tab.time.active.status).toBe('paused'); expect(reads).toBe(2);
  held.resolve({ data: stale }); await ordinary; await tab.settle();
  expect(tab.snapshot.participants).toEqual([{ displayName: 'Member' }]);
  expect(tab.time.active.status).toBe('paused'); expect(tab.time.revision).toBe(2);
  expect(f.calls.filter(path => path.startsWith('rooms/me'))).toHaveLength(0);
  // A later ordinary request inherits the requirement even after both transports failed.
  stale.serverTime = iso(Date.now() + 100); stale.me.serverTime = stale.serverTime;
  f.intercept(path => path.endsWith('/snapshot') ? { data: stale } : undefined);
  expect((await tab.snapshotFor()).status).toBe('retry');
  expect(f.requestMetadata.at(-1)).toMatchObject({ minimumTimeRevision: 2 });
  expect(tab.snapshot.participants).toEqual([{ displayName: 'Member' }]);
});

it('never lowers the persistent Time requirement when a weaker caller arrives later', async () => {
  const f = fixture(), tab = f.client(); await f.seed(tab); f.requestMetadata.length = 0;
  const floor = Date.now();
  await tab.refreshKnown('time-room-effect', { minimumServerTime: floor + 100, minimumTimeRevision: 3 });
  await tab.refreshKnown('time-room-effect', { minimumServerTime: floor + 50, minimumTimeRevision: 2 });
  expect(f.requestMetadata.every(m => m.minimumServerTime === floor + 100 && m.minimumTimeRevision === 3)).toBe(true);
});

it('does not persist a boundary-only deadline as a Time requirement for ordinary snapshots', async () => {
  const f = fixture(), tab = f.client(); await f.seed(tab);
  expect((await tab.refreshBoundary(Date.now() + 1000)).status).toBe('retry');
  expect((await tab.snapshotFor()).status).toBe('accepted');
  expect(f.requestMetadata.at(-1).minimumServerTime).toBeUndefined();
  expect(f.requestMetadata.at(-1).minimumTimeRevision).toBeUndefined();
});

it('clears the previous permission scope Time requirement on controller change', async () => {
  const f = fixture(), tab = f.client(); await f.seed(tab);
  await tab.refreshKnown('time-room-effect', { minimumServerTime: Date.now() + 100, minimumTimeRevision: 3 });
  f.state.controlVersion++; f.state.roomRevision++; tab.acceptMe(f.me());
  expect((await tab.snapshotFor()).status).toBe('accepted');
  expect(tab.snapshot.access.generation).toBe(2);
  expect(f.requestMetadata.at(-1).minimumTimeRevision).toBeUndefined();
});

it('rejects a newer-timestamp snapshot with stale Time revision through the bounded immediate retry', async () => {
  const f = fixture(), tab = f.client(); await f.seed(tab); f.calls.length = 0; f.requestMetadata.length = 0;
  f.state.timeRevision = 2; tab.acceptTime(f.time(), true);
  const floor = Date.now(), stale = f.snapshot(); stale.me.timeRevision = 0;
  stale.serverTime = iso(floor + 100); stale.me.serverTime = stale.serverTime;
  f.intercept(path => path.endsWith('/snapshot') ? { data: stale } : undefined);
  const result = await tab.refreshKnown('time-room-effect', { minimumServerTime: floor, minimumTimeRevision: 2 });
  expect(result.status).toBe('retry'); expect(f.calls).toEqual(['rooms/room/snapshot', 'rooms/room/snapshot']);
  expect(tab.time.revision).toBe(2); expect(tab.me.timeRevision).toBe(0);
  expect(f.requestMetadata.every(m => m.minimumServerTime === floor && m.minimumTimeRevision === 2)).toBe(true);
  f.intercept(null);
  expect((await tab.refreshKnown('time-room-effect', { minimumServerTime: floor, minimumTimeRevision: 2 })).status).toBe('accepted');
  expect(tab.snapshot.me.timeRevision).toBe(2);
});

it('preserves both freshness floors after safe Me reconciliation of a mismatched snapshot', async () => {
  const f = fixture(), tab = f.client(); await f.seed(tab); f.calls.length = 0; f.requestMetadata.length = 0;
  f.state.timeRevision = 2; tab.acceptTime(f.time(), true);
  const floor = Date.now(); let snapshots = 0;
  f.intercept(path => {
    if (!path.endsWith('/snapshot')) return;
    const value = f.snapshot(); value.me.timeRevision = 0;
    if (++snapshots === 1) value.access.generation = 2;
    return { data: value };
  });
  const result = await tab.refreshKnown('time-room-effect', { minimumServerTime: floor, minimumTimeRevision: 2 });
  expect(result.status).toBe('retry');
  expect(f.calls).toEqual(['rooms/room/snapshot', 'rooms/me?roomId=room', 'rooms/room/snapshot', 'rooms/room/snapshot']);
  expect(f.requestMetadata.filter(m => m.path.endsWith('/snapshot')).every(m => m.minimumServerTime === floor && m.minimumTimeRevision === 2)).toBe(true);
  expect(tab.time.revision).toBe(2); expect(tab.snapshot.me.timeRevision).toBe(0);
});

it('keeps expired active membership on Me-first Time recovery and denies private reads after removal', async () => {
  const f = fixture(), tab = f.client(); await f.seed(tab);
  const expired = f.me(); expired.membership.seatExpiresAt = iso(Date.now() - 1); tab.acceptMe(expired);
  f.calls.length = 0; f.state.timeRevision = 1; f.state.membershipStatus = 'removed';
  tab.acceptTime(f.time()); await tab.settle();
  expect(f.calls).toEqual(['rooms/me?roomId=room']);
  expect(tab.snapshot).toBeNull(); expect(tab.time.revision).toBe(1);
});

it('clears a denied Time-followup snapshot and uses Me to confirm removal without losing Time', async () => {
  const f = fixture(), tab = f.client(); await f.seed(tab); f.calls.length = 0;
  f.state.membershipStatus = 'removed'; f.state.timeRevision = 1;
  tab.acceptTime(f.time()); await tab.settle();
  expect(f.calls).toEqual(['rooms/room/snapshot', 'rooms/me?roomId=room']);
  expect(tab.me.membership.status).toBe('removed'); expect(tab.snapshot).toBeNull(); expect(tab.time.revision).toBe(1);
});

it('clears a revoked private view and cancels queued work at tab disposal', async () => {
  const f = fixture(), tab = f.client(); await f.seed(tab); f.calls.length = 0;
  tab.invalidate(2); f.state.membershipStatus = 'removed';
  await vi.advanceTimersByTimeAsync(120); await tab.settle();
  expect(tab.snapshot).toBeNull(); expect(f.calls).toEqual(['rooms/room/snapshot', 'rooms/me?roomId=room']);
  const count = f.calls.length; tab.connected(); tab.close();
  await vi.advanceTimersByTimeAsync(180000); await tab.settle();
  expect(f.calls).toHaveLength(count);
});

it('clears a denied-grant view immediately without clearing own time or automatically refetching roster', async () => {
  const f = fixture(); f.start(); const tab = f.client(); await f.seed(tab); f.calls.length = 0;
  tab.connected(); tab.denyRealtime(); await tab.loadMe();
  await vi.advanceTimersByTimeAsync(120); await tab.settle();
  expect(tab.snapshot).toBeNull(); expect(tab.time.active.id).toBe('session');
  expect(f.calls).toEqual(['rooms/me?roomId=room']);
  await tab.snapshotFor(); await tab.settle();
  expect(tab.snapshot.access.membershipId).toBe('member');
});

it('preserves the exact uncertain command across refresh and resets only on definitive errors', () => {
  let id = 0; const operation = createRoomOperation(() => `operation-${++id}`);
  const first = operation.prepare({ type: 'joinRound', roomId: 'room', expectedTimeRevision: 1, controlVersion: 1 }, 1);
  operation.failed({ status: 503 });
  expect(operation.prepare({ type: 'joinRound', roomId: 'room', expectedTimeRevision: 4, controlVersion: 2 }, 3)).toBe(first);
  operation.failed({ status: 409 });
  expect(operation.prepare({ type: 'joinRound', roomId: 'room', expectedTimeRevision: 4, controlVersion: 2 }, 3).operationId).toBe('operation-2');
  expect(transientGrantDelay).toBe(30000);
  expect([0, 1, 2, 8].map(closedGrantDelay)).toEqual([1000, 2000, 4000, 30000]);
});

it('suppresses duplicate and older hints without invalidating a current private snapshot', async () => {
  const f = fixture(), tab = f.client(); await f.seed(tab); f.calls.length = 0;
  const before = tab.epoch;
  tab.invalidate(1); tab.invalidate(0); tab.invalidate(1);
  await vi.advanceTimersByTimeAsync(500); await tab.settle();
  expect(tab.epoch).toBe(before); expect(f.calls).toEqual([]);
  f.state.hint = 3; tab.invalidate(3); tab.invalidate(2); tab.invalidate(3);
  expect(tab.epoch).toBe(before + 1);
  await vi.advanceTimersByTimeAsync(120); await tab.settle();
  expect(f.calls).toEqual(['rooms/room/snapshot']); expect(tab.snapshot.room.hintVersion).toBe(3);
});

it('does not treat newer me metadata as private coverage and enforces the announced hint floor', async () => {
  const f = fixture(), tab = f.client(); await f.seed(tab);
  const stale = globalThis.structuredClone(f.snapshot()); f.state.hint = 2;
  await tab.loadMe(); f.calls.length = 0;
  f.intercept(path => path.endsWith('/snapshot') ? { data: stale } : undefined);
  tab.invalidate(2); await vi.advanceTimersByTimeAsync(120); await tab.settle();
  expect(f.calls).toEqual(['rooms/room/snapshot', 'rooms/room/snapshot']);
  expect(tab.snapshot.room.hintVersion).toBe(1);
  f.intercept(null); await vi.advanceTimersByTimeAsync(30120); await tab.settle();
  expect(tab.snapshot.room.hintVersion).toBe(2);
});

it('keeps one delayed retry for an uncovered version despite repeated identical hints', async () => {
  const f = fixture(), tab = f.client(); await f.seed(tab); f.calls.length = 0;
  f.state.hint = 2; let failed = false;
  f.intercept(path => {
    if (path.endsWith('/snapshot') && !failed) { failed = true; throw Object.assign(new Error('busy'), { status: 503, code: 'UNAVAILABLE' }); }
  });
  tab.invalidate(2); await vi.advanceTimersByTimeAsync(120); await tab.settle();
  expect(f.calls).toEqual(['rooms/room/snapshot']);
  await vi.advanceTimersByTimeAsync(15000); tab.invalidate(2); tab.invalidate(1);
  await vi.advanceTimersByTimeAsync(14999); expect(f.calls).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(121); await tab.settle();
  expect(f.calls).toEqual(['rooms/room/snapshot', 'rooms/room/snapshot']);
  expect(tab.snapshot.room.hintVersion).toBe(2);
});

it('skips a delayed retry when a different authoritative snapshot already covered the version', async () => {
  const f = fixture(), tab = f.client(); await f.seed(tab); f.calls.length = 0;
  f.state.hint = 2; let failed = false;
  f.intercept(path => {
    if (path.endsWith('/snapshot') && !failed) { failed = true; throw Object.assign(new Error('busy'), { status: 503 }); }
  });
  tab.invalidate(2); await vi.advanceTimersByTimeAsync(120); await tab.settle();
  await tab.refreshKnown(); await tab.settle(); const count = f.calls.length;
  await vi.advanceTimersByTimeAsync(30120); await tab.settle();
  expect(f.calls).toHaveLength(count); expect(tab.snapshot.room.hintVersion).toBe(2);
});

it('reconciles changed control once without importing that response roster or following its new scope', async () => {
  const f = fixture(), tab = f.client(); await f.seed(tab); f.calls.length = 0;
  f.state.controlVersion = 2;
  await tab.refreshKnown(); await tab.settle();
  expect(f.calls).toEqual(['rooms/room/snapshot', 'rooms/me?roomId=room']);
  expect(tab.me.membership.controlVersion).toBe(2); expect(tab.snapshot).toBeNull();
  // The new React subscription/view owns this independent refresh.
  tab.connected(); await vi.advanceTimersByTimeAsync(120); await tab.settle();
  expect(tab.snapshot.access.generation).toBe(2);
});

it('drops a held old-generation mismatch after a local room change without a fallback request', async () => {
  const f = fixture(), tab = f.client(); await f.seed(tab); f.calls.length = 0;
  const held = deferred(); f.state.controlVersion = 2; const response = globalThis.structuredClone(f.snapshot());
  f.intercept(path => path.endsWith('/snapshot') ? held.promise : undefined);
  const read = tab.refreshKnown(); await Promise.resolve();
  const changed = f.me(); changed.membership.roomId = 'another-room'; changed.revision++;
  tab.acceptMe(changed); held.resolve({ data: response }); await read; await tab.settle();
  expect(f.calls).toEqual(['rooms/room/snapshot']); expect(tab.snapshot).toBeNull();
});

it('drops a held old-generation mismatch after account unmount without reading under the next account', async () => {
  const f = fixture(), tab = f.client(); await f.seed(tab); f.calls.length = 0;
  const held = deferred(); f.state.controlVersion = 2; const response = globalThis.structuredClone(f.snapshot());
  f.intercept(path => path.endsWith('/snapshot') ? held.promise : undefined);
  const read = tab.refreshKnown(); await Promise.resolve(); tab.close();
  held.resolve({ data: response }); await read; await tab.settle();
  expect(f.calls).toEqual(['rooms/room/snapshot']); expect(tab.snapshot).toBeNull();
});

it('clears a denied snapshot before membership reconciliation while preserving own time', async () => {
  const f = fixture(); f.start(); const tab = f.client(); await f.seed(tab); f.calls.length = 0;
  const held = deferred(); f.state.membershipStatus = 'removed';
  f.intercept(path => path.includes('/me?') ? held.promise : undefined);
  const read = tab.refreshKnown(); await vi.advanceTimersByTimeAsync(0);
  expect(tab.snapshot).toBeNull(); expect(tab.time.active.id).toBe('session');
  held.resolve({ data: f.me() }); await read; await tab.settle();
  expect(f.calls).toEqual(['rooms/room/snapshot', 'rooms/me?roomId=room']);
});

it('does not retry private reads after a failed controller-membership reconciliation', async () => {
  const f = fixture(), tab = f.client(); await f.seed(tab); f.calls.length = 0;
  f.state.controlVersion = 2;
  f.intercept(path => {
    if (path.includes('/me?')) throw Object.assign(new Error('busy'), { status: 503, code: 'UNAVAILABLE' });
  });
  expect((await tab.refreshKnown()).status).toBe('unavailable'); await tab.settle();
  expect(f.calls).toEqual(['rooms/room/snapshot', 'rooms/me?roomId=room']);
  expect(tab.me.membership.controlVersion).toBe(1);
});

it('keeps the original retry deadline while a newer uncovered hint replaces an already covered failure', async () => {
  const f = fixture(), tab = f.client(); await f.seed(tab); f.calls.length = 0;
  let failNext = true;
  f.intercept(path => {
    if (path.endsWith('/snapshot') && failNext) { failNext = false; throw Object.assign(new Error('busy'), { status: 503 }); }
  });
  f.state.hint = 10; tab.invalidate(10);
  await vi.advanceTimersByTimeAsync(120); await tab.settle();
  await tab.refreshKnown(); await tab.settle(); expect(tab.snapshot.room.hintVersion).toBe(10);
  await vi.advanceTimersByTimeAsync(5000);
  failNext = true; f.state.hint = 11; tab.invalidate(11);
  await vi.advanceTimersByTimeAsync(120); await tab.settle();
  expect(f.calls).toHaveLength(3); tab.invalidate(11);
  await vi.advanceTimersByTimeAsync(25000); await tab.settle();
  expect(f.calls).toEqual(Array(4).fill('rooms/room/snapshot'));
  expect(tab.snapshot.room.hintVersion).toBe(11);
});

it('does not let a held ordinary snapshot fulfill a boundary freshness floor', async () => {
  const f = fixture(), tab = f.client(); await f.seed(tab); f.calls.length = 0;
  const held = deferred(), before = f.snapshot(); let reads = 0;
  f.intercept(path => {
    if (path === 'rooms/room/snapshot') { reads++; return reads === 1 ? held.promise : Promise.resolve({ data: f.snapshot() }); }
  });
  const ordinary = tab.snapshotFor(); await vi.advanceTimersByTimeAsync(1);
  const floor = Date.now();
  const boundary = await tab.refreshBoundary(floor);
  expect(boundary.status).toBe('accepted'); expect(reads).toBe(2);
  expect(Date.parse(tab.snapshot.serverTime)).toBeGreaterThanOrEqual(floor);
  held.resolve({ data: before }); await ordinary;
  expect(Date.parse(tab.snapshot.serverTime)).toBeGreaterThanOrEqual(floor);
  expect(f.calls.filter(path => path.startsWith('rooms/me'))).toHaveLength(0);
});

it('retains the boundary floor through the immediate stale snapshot retry', async () => {
  const f = fixture(), tab = f.client(); await f.seed(tab); f.calls.length = 0;
  const stale = f.snapshot(); await vi.advanceTimersByTimeAsync(1);
  f.intercept(path => path === 'rooms/room/snapshot' ? Promise.resolve({ data: stale }) : undefined);
  const result = await tab.refreshBoundary(Date.now());
  expect(result.status).toBe('retry');
  expect(f.calls.filter(path => path.endsWith('/snapshot'))).toHaveLength(2);
  expect(f.calls.filter(path => path.startsWith('rooms/me'))).toHaveLength(0);
});

it('uses an independent room-boundary timer, keeps its original due time on reanchor, and performs one750ms retry', async () => {
  const f = fixture(); f.state.phaseEndsAt = Date.now() + 1000;
  const tab = f.client(); await f.seed(tab); f.calls.length = 0;
  f.intercept(path => path === 'rooms/room/snapshot' ? Promise.reject({ status: 503, code: 'UNAVAILABLE' }) : undefined);
  await vi.advanceTimersByTimeAsync(1000);
  const reanchored = f.me(); reanchored.serverTime = iso(Date.now() - 900); reanchored.revision++;
  tab.acceptMe(reanchored); // Same deadline/scope: a lagging new anchor must not move the original timer.
  await vi.advanceTimersByTimeAsync(199);
  expect(f.calls.filter(path => path.endsWith('/snapshot'))).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.calls.filter(path => path.endsWith('/snapshot'))).toHaveLength(1);
  expect(f.calls.filter(path => path.startsWith('rooms/me'))).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(749);
  expect(f.calls.filter(path => path.endsWith('/snapshot'))).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.calls.filter(path => path.endsWith('/snapshot'))).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.calls.filter(path => path.endsWith('/snapshot'))).toHaveLength(2);
});

it('cancels a pending boundary retry when membership becomes inactive', async () => {
  const f = fixture(); f.state.phaseEndsAt = Date.now() + 1000;
  const tab = f.client(); await f.seed(tab); f.calls.length = 0;
  f.intercept(path => path === 'rooms/room/snapshot' ? Promise.reject({ status: 503, code: 'UNAVAILABLE' }) : undefined);
  await vi.advanceTimersByTimeAsync(1200);
  expect(f.calls.filter(path => path.endsWith('/snapshot'))).toHaveLength(1);
  f.state.membershipStatus = 'removed'; f.state.roomRevision++;
  tab.acceptMe(f.me());
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.calls.filter(path => path.endsWith('/snapshot'))).toHaveLength(1);
});
