import type { RoomHint, RoomRealtimeCredentials } from '@dima/contracts';
import type { RealtimeClient } from '@supabase/realtime-js';

export type RoomConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed';
export type RoomSubscription = {
  close(): void;
  updateGrant(grant: RoomRealtimeCredentials): Promise<void>;
};
type Options = {
  grant: RoomRealtimeCredentials;
  signal?: AbortSignal;
  onInvalidate(hint: RoomHint): void;
  onStatus(status: RoomConnectionStatus): void;
};
const phases = new Set(['lobby', 'focus', 'shortBreak', 'longBreak', 'completed', 'cancelled']);

function hintFrom(payload: unknown): RoomHint | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Partial<RoomHint>;
  if (!Number.isSafeInteger(value.version) || Number(value.version) < 0 || !value.phase || !phases.has(value.phase)
    || !value.count || !Number.isInteger(value.count.reserved) || !Number.isInteger(value.count.connected)
    || value.count.reserved < 0 || value.count.reserved > 20 || value.count.connected < 0 || value.count.connected > value.count.reserved) return null;
  return { version: value.version!, phase: value.phase, count: { reserved: value.count.reserved, connected: value.count.connected } };
}

/** One receive-only channel. Auth SDK and schemas stay outside this lazy chunk. */
export async function subscribeRoom(options: Options): Promise<RoomSubscription> {
  let disposed = false;
  let client: RealtimeClient | null = null;
  let current = options.grant;
  let channelClosed = false;
  let connectFresh: (() => Promise<void>) | null = null;
  let lastStatus: RoomConnectionStatus | null = null;
  const status = (next: RoomConnectionStatus) => {
    if (!disposed && !options.signal?.aborted && next !== lastStatus) {
      lastStatus = next;
      options.onStatus(next);
    }
  };
  const handle: RoomSubscription = {
    close() {
      if (disposed) return;
      disposed = true;
      options.signal?.removeEventListener('abort', handle.close);
      if (client) {
        // Unsubscribe stops channel rejoin timers; disconnect stops socket retries immediately.
        void client.removeAllChannels().catch(() => undefined);
        void client.disconnect();
        client = null;
      }
    },
    async updateGrant(next) {
      if (disposed || options.signal?.aborted) return;
      if (next.topic !== current.topic || next.url !== current.url || next.anonKey !== current.anonKey) {
        throw new Error('A changed room scope requires a new subscription');
      }
      current = next;
      if (channelClosed) await connectFresh?.();
      else await client?.setAuth(next.token);
    },
  };
  options.signal?.addEventListener('abort', handle.close, { once: true });
  if (options.signal?.aborted) { handle.close(); return handle; }
  status('connecting');
  try {
    const { RealtimeClient } = await import('@supabase/realtime-js');
    if (disposed || options.signal?.aborted) return handle;
    connectFresh = async () => {
      if (disposed || options.signal?.aborted) return;
      if (client) {
        void client.removeAllChannels().catch(() => undefined);
        void client.disconnect();
      }
      client = null;
      channelClosed = true;
      const activeClient = new RealtimeClient(current.url, {
        params: { apikey: current.anonKey }, heartbeatIntervalMs: 30000,
        reconnectAfterMs: attempts => [1000, 2000, 5000, 10000][Math.min(attempts - 1, 3)] + Math.floor(Math.random() * 500),
        logger: () => undefined,
      });
      client = activeClient;
      channelClosed = false;
      status('connecting');
      try {
        await activeClient.setAuth(current.token);
        if (disposed || options.signal?.aborted || client !== activeClient) return;
        activeClient.channel(current.topic, { config: { private: true, broadcast: { self: false, ack: false }, presence: { enabled: false } } })
          .on('broadcast', { event: 'invalidate' }, event => {
            if (disposed || options.signal?.aborted || client !== activeClient) return;
            const hint = hintFrom(event.payload);
            if (hint) options.onInvalidate(hint);
          })
          .subscribe(state => {
            if (client !== activeClient || disposed || options.signal?.aborted) return;
            if (state === 'SUBSCRIBED') status('connected');
            else if (state === 'CLOSED') { channelClosed = true; status('closed'); }
            else status('reconnecting');
          });
      } catch (error) {
        if (client === activeClient) {
          client = null;
          channelClosed = true;
          void activeClient.removeAllChannels().catch(() => undefined);
          void activeClient.disconnect();
          status('closed');
        }
        throw error;
      }
    };
    await connectFresh();
    return handle;
  } catch (error) {
    if (disposed || options.signal?.aborted) return handle;
    status('closed');
    handle.close();
    throw error;
  }
}
