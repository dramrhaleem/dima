import type { RoomCommand, RoomCommandResponse, RoomHint } from '@dima/contracts';

export const FAST_HINT_POLICY = { keys: 32, publications: 2, watermarks: 128, watermarkTtlMs: 120_000,
  initialDelayMs: 100, intervalMs: 2000, taskMs: 28_000, publishMs: 5000 } as const;
export type CommittedHint = { roomId: string; hint: RoomHint; urgent: boolean };
const emittingCommands = new Set(['create', 'join', 'switchToRoom', 'leave', 'switchToSolo', 'takeControl', 'setIntent',
  'startRun', 'joinRound', 'edit', 'close', 'offerHost', 'acceptHost', 'claimHost', 'remove', 'ban', 'suspendAccount',
  'suspendRoom', 'block', 'unblock', 'react']);
const urgentCommands = new Set(['startRun', 'close', 'suspendRoom']);
const phases = new Set(['lobby', 'focus', 'shortBreak', 'longBreak', 'completed', 'cancelled']);
/** Only trusted committed RPC output enters this path; never derive versions from a request. */
export function committedRoomHint(command: RoomCommand, response: RoomCommandResponse): CommittedHint | null {
  const room = response.data?.room;
  if (response.replayed || !emittingCommands.has(command.type) || !room || room.id !== response.receipt?.roomId
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(room.id)
    || !Number.isSafeInteger(room.hintVersion) || room.hintVersion < 1 || !phases.has(room.phase?.kind)
    || !Number.isInteger(room.reservedCount) || room.reservedCount < 0 || room.reservedCount > 20
    || !Number.isInteger(room.connectedCount) || room.connectedCount < 0 || room.connectedCount > room.reservedCount) return null;
  return { roomId: room.id, hint: { version: room.hintVersion, phase: room.phase.kind,
    count: { reserved: room.reservedCount, connected: room.connectedCount } }, urgent: urgentCommands.has(command.type) };
}

type Watermark = { seen: number; published: number; lastStart: number; touched: number };
type Entry = { latest: CommittedHint; urgentVersion: number; watermark: Watermark; deadline: number; initialAt: number;
  wake: (() => void) | null; promise: Promise<void> };
type Permit = () => void;
type Waiter = { entry: Entry; grant(permit: Permit | null): void };
export type FastHintResult = { reason: 'settled' | 'error' | 'budget' | 'capacity'; published: number; durationMs: number };
type Publish = (descriptor: CommittedHint, signal: AbortSignal) => Promise<void>;

/** Isolate-local coalescing only; the SQL outbox is never acknowledged here. */
export class CommittedHintPublisher {
  private readonly entries = new Map<string, Entry>();
  private readonly watermarks = new Map<string, Watermark>();
  private waiters: Waiter[] = [];
  private active = 0;
  constructor(private readonly publish: Publish, private readonly observe: (result: FastHintResult) => void = () => {},
    private readonly now = () => performance.now()) {}
  get size(): number { return this.entries.size; }
  get running(): number { return this.active; }
  get waiting(): number { return this.waiters.length; }
  schedule(descriptor: CommittedHint): Promise<void> {
    const room = descriptor.roomId, now = this.now();
    const existing = this.entries.get(room);
    if (existing) {
      if (descriptor.hint.version > existing.latest.hint.version) existing.latest = descriptor;
      existing.watermark.seen = Math.max(existing.watermark.seen, descriptor.hint.version);
      if (descriptor.urgent && descriptor.hint.version > existing.watermark.published) {
        existing.urgentVersion = Math.max(existing.urgentVersion, descriptor.hint.version);
        existing.wake?.();
      }
      return existing.promise;
    }
    const cached = this.watermarks.get(room);
    const watermark = cached && now - cached.touched < FAST_HINT_POLICY.watermarkTtlMs ? cached
      : { seen: 0, published: 0, lastStart: -Infinity, touched: now };
    // Seen is not delivery acknowledgment. The same failed version may retry
    // on a later request; an obsolete lower response never replaces newer data.
    if (descriptor.hint.version < watermark.seen || descriptor.hint.version <= watermark.published) return Promise.resolve();
    if (this.entries.size >= FAST_HINT_POLICY.keys) { this.observation({ reason: 'capacity', published: 0, durationMs: 0 }); return Promise.resolve(); }
    watermark.seen = Math.max(watermark.seen, descriptor.hint.version);
    const entry: Entry = { latest: descriptor, watermark, urgentVersion: descriptor.urgent ? descriptor.hint.version : 0,
      initialAt: now + FAST_HINT_POLICY.initialDelayMs, deadline: now + FAST_HINT_POLICY.taskMs, wake: null, promise: Promise.resolve() };
    this.entries.set(room, entry); this.remember(room, watermark);
    entry.promise = this.run(entry, now);
    return entry.promise;
  }
  private remember(room: string, mark: Watermark): void {
    mark.touched = this.now(); this.watermarks.delete(room); this.watermarks.set(room, mark);
    while (this.watermarks.size > FAST_HINT_POLICY.watermarks) this.watermarks.delete(this.watermarks.keys().next().value!);
  }
  private observation(result: FastHintResult): void { try { this.observe(result); } catch { /* Observability cannot affect delivery. */ } }
  private async wait(entry: Entry, until: number, signal: AbortSignal): Promise<void> {
    if (until <= this.now() || signal.aborted) return;
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); if (entry.wake === done) entry.wake = null; resolve(); };
      const timer = setTimeout(done, until - this.now()); entry.wake = done;
      signal.addEventListener('abort', done, { once: true });
    });
  }
  private async acquire(entry: Entry, signal: AbortSignal): Promise<Permit | null> {
    if (signal.aborted || entry.deadline - this.now() < FAST_HINT_POLICY.publishMs) return null;
    return new Promise<Permit | null>(resolve => {
      const waiter: Waiter = { entry, grant: permit => { signal.removeEventListener('abort', cancel); resolve(permit); } };
      const cancel = () => { this.waiters = this.waiters.filter(item => item !== waiter); resolve(null); this.pump(); };
      signal.addEventListener('abort', cancel, { once: true }); this.waiters.push(waiter); this.pump();
    });
  }
  private pump(): void {
    while (this.active < FAST_HINT_POLICY.publications && this.waiters.length) {
      // Phase changes take the next free permit, without preempting an active
      // fetch. Equal-priority owners retain their arrival order.
      const urgent = this.waiters.findIndex(item => item.entry.urgentVersion > item.entry.watermark.published);
      const [waiter] = this.waiters.splice(urgent < 0 ? 0 : urgent, 1);
      if (!waiter) break;
      if (waiter.entry.deadline - this.now() < FAST_HINT_POLICY.publishMs) { waiter.grant(null); continue; }
      this.active++; let released = false;
      waiter.grant(() => { if (released) return; released = true; this.active--; this.pump(); });
    }
  }
  private async invoke(descriptor: CommittedHint, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new Error('Publication cancelled');
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => { abort = () => reject(new Error('Publication cancelled')); signal.addEventListener('abort', abort, { once: true }); });
    try { await Promise.race([this.publish(descriptor, signal), cancelled]); }
    finally { signal.removeEventListener('abort', abort); }
  }
  private async run(entry: Entry, started: number): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(0, entry.deadline - this.now()));
    let published = 0, reason: FastHintResult['reason'] = 'settled';
    try {
      while (entry.latest.hint.version > entry.watermark.published) {
        if (controller.signal.aborted || entry.deadline - this.now() < FAST_HINT_POLICY.publishMs) { reason = 'budget'; break; }
        const urgent = entry.urgentVersion > entry.watermark.published;
        const due = urgent ? this.now() : Math.max(entry.initialAt, entry.watermark.lastStart + FAST_HINT_POLICY.intervalMs);
        await this.wait(entry, due, controller.signal);
        if (controller.signal.aborted || entry.deadline - this.now() < FAST_HINT_POLICY.publishMs) { reason = 'budget'; break; }
        // A wakeup can carry a new urgent version; ordinary updates never reset
        // the debounce or erase urgency that a newer payload can satisfy.
        if (entry.urgentVersion <= entry.watermark.published && this.now() < Math.max(entry.initialAt, entry.watermark.lastStart + FAST_HINT_POLICY.intervalMs)) continue;
        const release = await this.acquire(entry, controller.signal);
        if (!release) { reason = 'budget'; break; }
        try {
          if (controller.signal.aborted || entry.deadline - this.now() < FAST_HINT_POLICY.publishMs) { reason = 'budget'; break; }
          const descriptor = entry.latest;
          entry.watermark.lastStart = this.now(); this.remember(descriptor.roomId, entry.watermark);
          const publication = new AbortController();
          const timeout = setTimeout(() => publication.abort(), FAST_HINT_POLICY.publishMs);
          try { await this.invoke(descriptor, AbortSignal.any([controller.signal, publication.signal])); }
          finally { clearTimeout(timeout); }
          entry.watermark.published = Math.max(entry.watermark.published, descriptor.hint.version);
          this.remember(descriptor.roomId, entry.watermark); published++;
        } catch { reason = controller.signal.aborted ? 'budget' : 'error'; break; }
        finally { release(); }
      }
      // No await between the final version check and owner detachment below.
    } finally {
      clearTimeout(timer); entry.wake?.();
      if (this.entries.get(entry.latest.roomId) === entry) this.entries.delete(entry.latest.roomId);
      this.remember(entry.latest.roomId, entry.watermark);
      this.observation({ reason, published, durationMs: Math.round(this.now() - started) });
    }
  }
}
