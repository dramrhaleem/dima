import { afterEach, describe, expect, it, vi } from 'vitest';
import { drainHintQueue, RoomHintScheduler, type HintClaim, type HintIO, type HintTask } from '../../apps/web/src/server/room-hint-delivery';

function model() {
  let clock = 0, version = 1, token = 0, leased: HintClaim | null = null, leaseEnd = 0, pending = true;
  const published: number[] = [];
  const io: HintIO = {
    claim: async () => {
      if (!pending || (leased && leaseEnd > clock)) return [];
      leased = { roomId: 'room', claimToken: String(++token), version, topic: 'room:room', hint: { version, phase: 'lobby', count: { reserved: 1, connected: 1 } } };
      leaseEnd = clock + 30000; return [leased];
    },
    publish: async claim => { published.push(claim.version); return true; },
    acknowledge: async claim => {
      if (leased?.claimToken !== claim.claimToken || claim.version > version) return { accepted: false, pending: false };
      pending = version > claim.version; leased = null; return { accepted: true, pending };
    },
    fail: async () => { leased = null; },
  };
  return { io, published, now: () => clock, advance: (ms: number) => { clock += ms; }, emit: () => { pending = true; version++; },
    get pending() { return pending; }, get leased() { return leased; }, task: (): HintTask => ({ deadline: clock + 28000, signal: new AbortController().signal, consumeDirty: () => false }) };
}

describe('durable hint producer handoff', () => {
  it('drains multiple dispatcher batches even when every acknowledged row has no newer version', async () => {
    const state = model(), template = (await state.io.claim(new AbortController().signal))![0]!;
    const queue = Array.from({ length: 7 }, (_, index) => ({ ...template, roomId: `room-${index}` }));
    const published: string[] = [];
    const claim = vi.fn(async () => queue.splice(0, 3));
    const io: HintIO = { ...state.io, claim, publish: async item => { published.push(item.roomId); return true; },
      acknowledge: async () => ({ accepted: true, pending: false }) };
    expect(await drainHintQueue(io, state.task(), state.now, 'all')).toEqual({ delivered: 7, reason: 'busy' });
    expect(claim).toHaveBeenCalledTimes(4); expect(new Set(published).size).toBe(7); expect(queue).toEqual([]);
  });
  it('does not add an empty-queue probe for an ordinary settled single-room producer', async () => {
    const state = model(); const claim = vi.fn(state.io.claim); state.io.claim = claim;
    expect(await drainHintQueue(state.io, state.task(), state.now)).toEqual({ delivered: 1, reason: 'settled' });
    expect(claim).toHaveBeenCalledTimes(1);
  });
  it('delivers a third version emitted during the second publish after the other producer finds a busy claim', async () => {
    const state = model(); const publish = state.io.publish;
    let busyProducers = 0;
    state.io.publish = async claim => {
      await publish(claim);
      if (claim.version < 3) {
        state.emit();
        expect(await state.io.claim(new AbortController().signal)).toEqual([]);
        busyProducers++;
      }
      return true;
    };
    const result = await drainHintQueue(state.io, state.task(), state.now);
    expect(result).toEqual({ delivered: 3, reason: 'settled' });
    expect(busyProducers).toBe(2); expect(state.published).toEqual([1, 2, 3]); expect(state.pending).toBe(false);
  });
  it('uses a local dirty indication when a producer commits after a no-pending ACK', async () => {
    const state = model(); let dirty = false; const ack = state.io.acknowledge;
    state.io.acknowledge = async (claim, signal) => {
      const answer = await ack(claim, signal);
      if (claim.version === 1) { state.emit(); dirty = true; }
      return answer;
    };
    const task = { ...state.task(), consumeDirty: () => { const answer = dirty; dirty = false; return answer; } };
    expect((await drainHintQueue(state.io, task, state.now)).delivered).toBe(2);
    expect(state.published).toEqual([1, 2]); expect(state.pending).toBe(false);
  });
  it('does not spin or publish after a lost claim response, and recovers the committed lease later', async () => {
    const state = model(); const claim = state.io.claim; let calls = 0;
    state.io.claim = async signal => { calls++; await claim(signal); return null; };
    expect(await drainHintQueue(state.io, state.task(), state.now)).toEqual({ delivered: 0, reason: 'error' });
    expect(calls).toBe(1); expect(state.leased).not.toBeNull(); expect(state.published).toEqual([]);
    state.advance(31000); state.io.claim = claim;
    expect((await drainHintQueue(state.io, state.task(), state.now)).delivered).toBe(1);
    expect(state.pending).toBe(false);
  });
  it('does not publish when a slow claim leaves insufficient ACK allowance; durable recovery remains possible', async () => {
    const state = model(); const claim = state.io.claim;
    state.io.claim = async signal => { const answer = await claim(signal); state.advance(9000); return answer; };
    expect(await drainHintQueue(state.io, state.task(), state.now)).toEqual({ delivered: 0, reason: 'budget' });
    expect(state.pending).toBe(true); expect(state.leased).not.toBeNull(); expect(state.published).toEqual([]);
    state.advance(31000); state.io.claim = claim;
    expect((await drainHintQueue(state.io, state.task(), state.now)).delivered).toBe(1);
  });
  it('refuses to begin a database operation without its full allowance and stops on stale ACK', async () => {
    const state = model(); const claim = vi.fn(state.io.claim); state.io.claim = claim;
    const task = state.task(); state.advance(14000);
    expect((await drainHintQueue(state.io, task, state.now)).reason).toBe('budget'); expect(claim).not.toHaveBeenCalled();
    state.io.acknowledge = async () => ({ accepted: false, pending: false });
    expect(await drainHintQueue(state.io, state.task(), state.now)).toEqual({ delivered: 0, reason: 'busy' });
    expect(claim).toHaveBeenCalledTimes(1); expect(state.pending).toBe(true);
  });
});

describe('per-isolate hint scheduling', () => {
  afterEach(() => vi.useRealTimers());
  it('retries a fresh producer signal after an empty database snapshot but before busy resolves', async () => {
    const state = model(), scheduler = new RoomHintScheduler(2, 32, 28000, state.now);
    const initial = (await state.io.claim(new AbortController().signal))![0]!;
    await state.io.acknowledge(initial, new AbortController().signal);
    let release!: () => void, observed!: () => void, calls = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const snapshot = new Promise<void>(resolve => { observed = resolve; });
    const claim = state.io.claim;
    state.io.claim = async signal => {
      calls++; const result = await claim(signal);
      if (calls === 1) { expect(result).toEqual([]); observed(); await gate; }
      return result;
    };
    const owner = scheduler.schedule('room', async task => (await drainHintQueue(state.io, task, state.now)).reason);
    await snapshot; state.emit();
    const follower = scheduler.schedule('room', async () => { throw new Error('Use original owner context'); });
    release(); await Promise.all([owner, follower]);
    expect(calls).toBe(2); expect(state.published).toEqual([2]); expect(state.pending).toBe(false); expect(scheduler.size).toBe(0);
  });
  it('makes only one additional busy claim for one fresh dirty signal behind a foreign lease', async () => {
    const scheduler = new RoomHintScheduler(); let release!: () => void, started!: () => void, calls = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { started = resolve; });
    const owner = scheduler.schedule('room', async () => { calls++; if (calls === 1) { started(); await gate; } return 'busy'; });
    await ready; const follower = scheduler.schedule('room', async () => { throw new Error('No second owner'); });
    release(); await Promise.all([owner, follower]); expect(calls).toBe(2); expect(scheduler.size).toBe(0);
  });
  it.each(['error', 'budget'] as const)('never retries %s even with a fresh dirty indication', async outcome => {
    const scheduler = new RoomHintScheduler(); let release!: () => void, calls = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const owner = scheduler.schedule('room', async () => { calls++; await gate; return outcome; });
    await Promise.resolve(); const follower = scheduler.schedule('room', async () => { throw new Error('No second owner'); });
    release(); await Promise.all([owner, follower]); expect(calls).toBe(1); expect(scheduler.size).toBe(0);
  });
  it('coalesces same-room producers onto one owner and exposes trailing dirty work', async () => {
    const scheduler = new RoomHintScheduler(); let release!: () => void; let executions = 0; let trailing = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = scheduler.schedule('room', async task => { executions++; task.consumeDirty(); await gate; trailing = task.consumeDirty(); });
    await Promise.resolve();
    const followers = Array.from({ length: 20 }, () => scheduler.schedule('room', async () => { throw new Error('Second I/O owner must not run'); }));
    expect(followers.every(item => item === first)).toBe(true);
    release(); await Promise.all([first, ...followers]);
    expect(executions).toBe(1); expect(trailing).toBe(true); expect(scheduler.size).toBe(0); expect(scheduler.running).toBe(0);
  });
  it('hands off a signal after the last dirty check but before the owner work promise resolves', async () => {
    const scheduler = new RoomHintScheduler(); let release!: () => void; let runs = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const owner = scheduler.schedule('room', async task => {
      runs++; expect(task.consumeDirty()).toBe(false);
      if (runs === 1) await gate;
      return 'settled';
    });
    await Promise.resolve();
    const follower = scheduler.schedule('room', async () => { throw new Error('Use original owner context'); });
    release(); await Promise.all([owner, follower]);
    expect(runs).toBe(2); expect(scheduler.size).toBe(0);
  });
  it('bounds keys/concurrency and expires queued work within its original lifetime', async () => {
    vi.useFakeTimers();
    const scheduler = new RoomHintScheduler(2, 32, 28000, () => Date.now()); let started = 0, peak = 0;
    const requests = Array.from({ length: 33 }, (_, index) => scheduler.schedule(String(index), async task => {
      started++; peak = Math.max(peak, scheduler.running);
      await new Promise<void>(resolve => task.signal.addEventListener('abort', () => resolve(), { once: true }));
    }));
    await Promise.resolve(); expect(scheduler.size).toBe(32); expect(started).toBe(2); expect(peak).toBe(2);
    await vi.advanceTimersByTimeAsync(28000); await Promise.all(requests);
    expect(started).toBe(2); expect(scheduler.size).toBe(0); expect(scheduler.running).toBe(0);
  });
  it('releases a failed owner and permits a subsequent producer', async () => {
    const scheduler = new RoomHintScheduler();
    await expect(scheduler.schedule('room', async () => { throw new Error('Synthetic failure'); })).rejects.toThrow('Synthetic failure');
    let ran = false; await scheduler.schedule('room', async () => { ran = true; });
    expect(ran).toBe(true); expect(scheduler.size).toBe(0);
  });
});
