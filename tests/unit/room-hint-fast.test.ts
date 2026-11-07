import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomCommand, RoomCommandResponse } from '../../packages/contracts/src/rooms';
import { committedRoomHint, CommittedHintPublisher, FAST_HINT_POLICY, type CommittedHint, type FastHintResult } from '../../apps/web/src/server/room-hint-fast';

function hint(version: number, urgent = false, roomId = '00000000-0000-4000-8000-000000000001'): CommittedHint {
  return { roomId, urgent, hint: { version, phase: 'focus', count: { reserved: 2, connected: 1 } } };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function clock() { vi.useFakeTimers(); vi.setSystemTime(0); return () => Date.now(); }
async function tick(ms = 0) { await vi.advanceTimersByTimeAsync(ms); }
afterEach(() => vi.useRealTimers());

describe('committed response hint extraction', () => {
  const response = () => ({ data: { room: { id: hint(1).roomId, hintVersion: 7, phase: { kind: 'focus' }, reservedCount: 2, connectedCount: 1 } },
    receipt: { roomId: hint(1).roomId } }) as RoomCommandResponse;
  const command = (type: string) => ({ type }) as RoomCommand;
  it('whitelists only committed public metadata and excludes replay/mismatched rooms/renewals', () => {
    expect(committedRoomHint(command('joinRound'), response())).toEqual(hint(7));
    for (const type of ['renewPresence', 'report', 'reviewReport', 'unban']) expect(committedRoomHint(command(type), response())).toBeNull();
    expect(committedRoomHint(command('joinRound'), { ...response(), replayed: true })).toBeNull();
    const mismatch = response(); mismatch.receipt.roomId = '00000000-0000-4000-8000-000000000002';
    expect(committedRoomHint(command('joinRound'), mismatch)).toBeNull();
    for (const type of ['startRun', 'close', 'suspendRoom']) expect(committedRoomHint(command(type), response())?.urgent).toBe(true);
    expect(committedRoomHint(command('pause'), response())).toBeNull();
  });
  it('rejects invalid phase/version/count projection without interpreting client fields', () => {
    for (const patch of [{ hintVersion: NaN }, { hintVersion: 0 }, { connectedCount: 3 }, { reservedCount: 21 }, { phase: { kind: 'unknown' } }]) {
      const invalid = response(); Object.assign(invalid.data.room!, patch);
      expect(committedRoomHint(command('startRun'), invalid)).toBeNull();
    }
  });
});

describe('bounded committed hint publication', () => {
  it('coalesces before acquiring a network permit and keeps the highest queued version', async () => {
    const now = clock(), sent: number[] = [];
    const publisher = new CommittedHintPublisher(async item => { sent.push(item.hint.version); }, undefined, now);
    const owner = publisher.schedule(hint(3)); const follower = publisher.schedule(hint(5)); publisher.schedule(hint(4));
    expect(owner).toBe(follower); expect(publisher.running).toBe(0);
    await tick(99); expect(sent).toEqual([]); await tick(1); await owner;
    expect(sent).toEqual([5]); expect(publisher.size).toBe(0);
  });
  it('retains a higher version received during publish and spaces ordinary starts', async () => {
    const now = clock(), gate = deferred(), sent: { version: number; at: number }[] = [];
    const publisher = new CommittedHintPublisher(async item => { sent.push({ version: item.hint.version, at: now() }); if (item.hint.version === 3) await gate.promise; }, undefined, now);
    const owner = publisher.schedule(hint(3)); await tick(100); publisher.schedule(hint(5)); publisher.schedule(hint(2));
    gate.resolve(); await tick(); expect(publisher.running).toBe(0); await tick(1999); expect(sent).toHaveLength(1);
    await tick(1); await owner; expect(sent).toEqual([{ version: 3, at: 100 }, { version: 5, at: 2100 }]);
  });
  it('urgent wake survives a newer ordinary payload during cooldown, and covered urgency cannot bypass pacing', async () => {
    const now = clock(), sent: number[] = [];
    const publisher = new CommittedHintPublisher(async item => { sent.push(item.hint.version); }, undefined, now);
    const first = publisher.schedule(hint(1, true)); await tick(); await first;
    const next = publisher.schedule(hint(2)); await tick(200); expect(sent).toEqual([1]);
    publisher.schedule(hint(3, true)); publisher.schedule(hint(4)); await tick(); await next;
    expect(sent).toEqual([1, 4]);
    const last = publisher.schedule(hint(5)); publisher.schedule(hint(3, true)); await tick(1999); expect(sent).toEqual([1, 4]);
    await tick(1); await last; expect(sent).toEqual([1, 4, 5]);
  });
  it('a lower urgent descriptor wakes a higher pending payload only until its version is covered', async () => {
    const now = clock(), sent: number[] = [];
    const publisher = new CommittedHintPublisher(async item => { sent.push(item.hint.version); }, undefined, now);
    const first = publisher.schedule(hint(1, true)); await tick(); await first;
    const next = publisher.schedule(hint(5)); await tick(100); publisher.schedule(hint(3, true));
    await tick(); await next; expect(sent).toEqual([1, 5]);
    await publisher.schedule(hint(3, true)); expect(sent).toEqual([1, 5]);
  });
  it('does not count failure as success and permits a later same-version request without a hot retry', async () => {
    const now = clock(), results: FastHintResult[] = []; let attempts = 0;
    const publisher = new CommittedHintPublisher(async () => { if (++attempts === 1) throw new Error('unavailable'); }, result => results.push(result), now);
    const first = publisher.schedule(hint(5)); await tick(100); await first;
    expect(attempts).toBe(1); expect(results[0]).toMatchObject({ reason: 'error', published: 0 });
    const retry = publisher.schedule(hint(5)); await tick(1999); expect(attempts).toBe(1);
    await tick(1); await retry; expect(attempts).toBe(2); expect(results[1]).toMatchObject({ reason: 'settled', published: 1 });
    await publisher.schedule(hint(4, true)); expect(attempts).toBe(2);
  });
  it('hands off a descriptor arriving in a final promise microtask without a lost wakeup', async () => {
    const now = clock(), sent: number[] = []; let follower: Promise<void> | undefined;
    const publisher = new CommittedHintPublisher(async item => {
      sent.push(item.hint.version);
      if (item.hint.version === 1) void Promise.resolve().then(() => Promise.resolve()).then(() => { follower = publisher.schedule(hint(2, true)); });
    }, undefined, now);
    const first = publisher.schedule(hint(1, true)); await tick(); await first; await follower;
    expect(sent).toEqual([1, 2]); expect(publisher.size).toBe(0);
  });
  it('caps keys and network concurrency and releases aborted permits before owner promises settle', async () => {
    const now = clock(), results: FastHintResult[] = []; let network = 0, peak = 0;
    const publisher = new CommittedHintPublisher((_item, signal) => new Promise<void>((_resolve, reject) => {
      network++; peak = Math.max(peak, network);
      signal.addEventListener('abort', () => { network--; reject(new Error('aborted')); }, { once: true });
    }), result => results.push(result), now);
    const pending = Array.from({ length: 33 }, (_, i) => publisher.schedule(hint(1, true, `room-${i}`)));
    await tick(); expect(publisher.size).toBe(32); expect(publisher.running).toBe(2); expect(publisher.waiting).toBe(30);
    expect(results.filter(result => result.reason === 'capacity')).toHaveLength(1);
    await tick(FAST_HINT_POLICY.taskMs); await Promise.all(pending);
    expect(peak).toBe(2); expect(network).toBe(0); expect(publisher.running).toBe(0); expect(publisher.waiting).toBe(0); expect(publisher.size).toBe(0);
    expect(results.every(result => result.durationMs <= FAST_HINT_POLICY.taskMs)).toBe(true);
  });
  it('gives an owed urgent waiter the next free permit before earlier ordinary waiters', async () => {
    const now = clock(), first = deferred(), second = deferred(), sent: string[] = [];
    const publisher = new CommittedHintPublisher(async item => {
      sent.push(item.roomId);
      if (item.roomId === 'first') await first.promise;
      if (item.roomId === 'second') await second.promise;
    }, undefined, now);
    const pending = [publisher.schedule(hint(1, true, 'first')), publisher.schedule(hint(1, true, 'second'))];
    await tick(); pending.push(publisher.schedule(hint(1, false, 'ordinary'))); await tick(100);
    pending.push(publisher.schedule(hint(1, true, 'urgent'))); await tick();
    expect(publisher.waiting).toBe(2); first.resolve(); await tick(); second.resolve(); await tick(); await Promise.all(pending);
    expect(sent).toEqual(['first', 'second', 'urgent', 'ordinary']);
  });
  it('never extends the original owner deadline with a late follower or begins a fetch with less than5s', async () => {
    const now = clock(), results: FastHintResult[] = [], sent: number[] = [];
    const publisher = new CommittedHintPublisher(async item => { sent.push(item.hint.version); }, result => results.push(result), now);
    const owner = publisher.schedule(hint(1));
    vi.setSystemTime(24_000); const follower = publisher.schedule(hint(2, true));
    await tick(); await owner; await follower;
    expect(sent).toEqual([]); expect(results).toEqual([{ reason: 'budget', published: 0, durationMs: 24_000 }]);
  });
  it('watermark expiry changes optimization only, not indefinite delivery suppression', async () => {
    const now = clock(), sent: number[] = [];
    const publisher = new CommittedHintPublisher(async item => { sent.push(item.hint.version); }, undefined, now);
    const first = publisher.schedule(hint(5, true)); await tick(); await first;
    await publisher.schedule(hint(5, true)); expect(sent).toEqual([5]);
    await tick(FAST_HINT_POLICY.watermarkTtlMs); const next = publisher.schedule(hint(5, true)); await tick(); await next;
    expect(sent).toEqual([5, 5]);
  });
});
