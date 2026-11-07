import { beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeRoom } from '../../packages/client/src/realtime';

type Record = { tokens: string[]; disconnected: boolean; topic?: string; config?: unknown; emit?: (payload: unknown) => void; state?: (state: string) => void };
const mock = vi.hoisted(() => ({ clients: [] as Record[], holdAuth: false, release: [] as Array<() => void> }));
vi.mock('../../packages/client/node_modules/@supabase/realtime-js', () => ({
  RealtimeClient: class {
    record: Record;
    constructor() { this.record = { tokens: [], disconnected: false }; mock.clients.push(this.record); }
    async setAuth(token: string) {
      this.record.tokens.push(token);
      if (mock.holdAuth) await new Promise<void>(resolve => mock.release.push(resolve));
    }
    channel(topic: string, config: unknown) {
      this.record.topic = topic; this.record.config = config;
      const record = this.record;
      return {
        on(_kind: string, _filter: unknown, callback: (event: { payload: unknown }) => void) { record.emit = payload => callback({ payload }); return this; },
        subscribe(callback: (state: string) => void) { record.state = callback; return this; },
      };
    }
    async removeAllChannels() { return []; }
    disconnect() { this.record.disconnected = true; }
  },
}));
const grant = { url: 'http://127.0.0.1:54321/realtime/v1', anonKey: 'public-test-key', token: 'receive-capability-one', expiresAt: '2026-11-01T12:02:00Z', topic: 'room:10000000-0000-4000-8000-000000000001' };
const hint = { version: 2, phase: 'focus', count: { reserved: 5, connected: 4 } };
beforeEach(() => { mock.clients.length = 0; mock.holdAuth = false; mock.release.length = 0; });

describe('room transport lifecycle', () => {
  it('does not create a transport for an already aborted account scope', async () => {
    const controller = new AbortController(); controller.abort();
    const status = vi.fn();
    const handle = await subscribeRoom({ grant, signal: controller.signal, onInvalidate: vi.fn(), onStatus: status });
    expect(mock.clients).toHaveLength(0); expect(status).not.toHaveBeenCalled(); handle.close();
  });
  it('opens only a private no-Presence channel and strips unexpected broadcast fields', async () => {
    const receive = vi.fn(); const status = vi.fn();
    const handle = await subscribeRoom({ grant, onInvalidate: receive, onStatus: status });
    const record = mock.clients[0];
    expect(record.config).toMatchObject({ config: { private: true, presence: { enabled: false } } });
    record.emit?.({ ...hint, privateTask: 'must-not-escape' });
    record.emit?.({ ...hint, count: { reserved: 21, connected: 21 } });
    expect(receive.mock.calls).toEqual([[hint]]);
    await handle.updateGrant({ ...grant, token: 'receive-capability-two' });
    expect(mock.clients).toHaveLength(1); expect(record.tokens).toEqual([grant.token, 'receive-capability-two']);
    await expect(handle.updateGrant({ ...grant, topic: 'room:other' })).rejects.toThrow('changed room scope');
    handle.close(); const calls = status.mock.calls.length;
    record.emit?.(hint); record.state?.('SUBSCRIBED');
    expect(receive).toHaveBeenCalledTimes(1); expect(status).toHaveBeenCalledTimes(calls); expect(record.disconnected).toBe(true);
  });
  it('restores a server-closed channel only after a fresh authorized grant, ignoring old callbacks', async () => {
    const receive = vi.fn(); const status = vi.fn();
    const handle = await subscribeRoom({ grant, onInvalidate: receive, onStatus: status });
    const old = mock.clients[0]; old.state?.('CLOSED');
    expect(mock.clients).toHaveLength(1);
    await handle.updateGrant({ ...grant, token: 'fresh-capability-after-close' });
    expect(mock.clients).toHaveLength(2); expect(old.disconnected).toBe(true);
    old.emit?.(hint); old.state?.('CLOSED');
    mock.clients[1].state?.('SUBSCRIBED'); mock.clients[1].emit?.(hint);
    expect(receive.mock.calls).toEqual([[hint]]); expect(status).toHaveBeenLastCalledWith('connected');
    expect(mock.clients[1].tokens).toEqual(['fresh-capability-after-close']); handle.close();
  });
  it('abort during asynchronous setup closes the transport without joining or emitting late state', async () => {
    mock.holdAuth = true;
    const controller = new AbortController(); const status = vi.fn();
    const pending = subscribeRoom({ grant, signal: controller.signal, onInvalidate: vi.fn(), onStatus: status });
    await vi.waitFor(() => expect(mock.release).toHaveLength(1));
    controller.abort(); mock.release[0](); const handle = await pending;
    expect(mock.clients[0].disconnected).toBe(true); expect(mock.clients[0].topic).toBeUndefined();
    expect(status.mock.calls).toEqual([['connecting']]); handle.close();
  });
});
