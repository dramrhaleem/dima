import { describe, it, expect } from 'vitest';
import { runCoordinatedBurst } from '../helpers/room-load-burst.mjs';

describe('initial burst readiness barrier', () => {
  it('holds all mutation guards while independent snapshot reads become ready, then releases every action together', async () => {
    const held = new Set(), actions = [], cache = new Map();
    let ticks = 0;
    const result = await runCoordinatedBurst([0, 1, 2], {
      withGuard: async (id, job) => { held.add(id); try { await job(); } finally { held.delete(id); } },
      ready: id => cache.get(id),
      sleep: async () => { ticks++; expect(held.size).toBe(3); for (const id of held) cache.set(id, { snapshotAgeMs: ticks }); },
      action: async id => { expect(held.size).toBe(3); actions.push(id); },
      onRelease: rows => { expect(actions).toEqual([]); expect(rows.every(row => row.acquired && row.ready)).toBe(true); },
    });
    expect(result).toHaveLength(3); expect(actions).toEqual([0, 1, 2]); expect(held.size).toBe(0);
  });
  it('revalidates early snapshots and aborts all guards on bounded readiness failure without a partial burst', async () => {
    const held = new Set(), actions = []; let clock = 0;
    await expect(runCoordinatedBurst([0, 1], {
      withGuard: async (id, job) => { held.add(id); try { await job(); } finally { held.delete(id); } },
      ready: id => (clock < 25 ? id === 0 : id === 1) ? { snapshotAgeMs: 0 } : null,
      action: async id => { actions.push(id); }, now: () => clock, sleep: async () => { clock += 25; }, timeoutMs: 100,
    })).rejects.toMatchObject({ code: 'BURST_READINESS_TIMEOUT' });
    expect(actions).toEqual([]); expect(held.size).toBe(0);
  });
  it('releases waiting guards when one acquisition fails', async () => {
    const held = new Set(), actions = [];
    await expect(runCoordinatedBurst([0, 1], {
      withGuard: async (id, job) => { if (id === 1) throw Object.assign(new Error('conflict'), { code: 'GUARD_FAILED' }); held.add(id); try { await job(); } finally { held.delete(id); } },
      ready: () => ({}), action: async id => { actions.push(id); }, sleep: async () => {},
    })).rejects.toMatchObject({ code: 'GUARD_FAILED' });
    expect(actions).toEqual([]); expect(held.size).toBe(0);
  });
});
