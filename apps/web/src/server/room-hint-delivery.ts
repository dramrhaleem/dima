import type { RoomHint } from '@dima/contracts';

export const HINT_DB_TIMEOUT_MS = 15_000;
export const HINT_PUBLISH_TIMEOUT_MS = 5_000;
export const HINT_TASK_BUDGET_MS = 28_000;
export type HintClaim = { roomId: string; claimToken: string; version: number; topic: string; hint: RoomHint };
export type HintAck = { accepted: boolean; pending: boolean };
export type HintTask = { deadline: number; signal: AbortSignal; consumeDirty(): boolean };
export type HintIO = {
  claim(signal: AbortSignal): Promise<HintClaim[] | null>;
  publish(claim: HintClaim): Promise<boolean>;
  acknowledge(claim: HintClaim, signal: AbortSignal): Promise<HintAck | null>;
  fail(claim: HintClaim, signal: AbortSignal): Promise<void>;
};
export type HintDrainResult = { delivered: number; reason: 'settled' | 'busy' | 'error' | 'budget' };

/** A failed/lost claim response is never reclassified as an empty queue. SQL owns recovery. */
export async function drainHintQueue(io: HintIO, task: HintTask, now = () => performance.now(), scope: 'room' | 'all' = 'room'): Promise<HintDrainResult> {
  let delivered = 0;
  const enoughForDatabase = () => !task.signal.aborted && task.deadline - now() >= HINT_DB_TIMEOUT_MS;
  const databaseSignal = () => AbortSignal.any([task.signal, AbortSignal.timeout(HINT_DB_TIMEOUT_MS)]);
  while (enoughForDatabase() && task.deadline - now() >= HINT_PUBLISH_TIMEOUT_MS + HINT_DB_TIMEOUT_MS) {
    task.consumeDirty();
    const claims = await io.claim(databaseSignal());
    if (!claims) return { delivered, reason: 'error' };
    if (!claims.length) return { delivered, reason: 'busy' };
    let pending = false;
    for (const claim of claims) {
      // Never publish if the maximum publish time would consume the ACK allowance.
      // A known claim left here remains pending and is recovered through its SQL lease.
      if (task.signal.aborted || task.deadline - now() < HINT_PUBLISH_TIMEOUT_MS + HINT_DB_TIMEOUT_MS) return { delivered, reason: 'budget' };
      if (!(await io.publish(claim))) {
        if (enoughForDatabase()) await io.fail(claim, databaseSignal());
        return { delivered, reason: 'error' };
      }
      if (!enoughForDatabase()) return { delivered, reason: 'budget' };
      const ack = await io.acknowledge(claim, databaseSignal());
      if (!ack) return { delivered, reason: 'error' };
      if (!ack.accepted) return { delivered, reason: 'busy' };
      delivered++;
      pending ||= ack.pending;
    }
    // An ACK observes producers in other isolates; dirty covers a local producer
    // committing after that ACK. Neither is limited to an arbitrary pass count.
    const dirty = task.consumeDirty();
    // Per-row ACKs say nothing about other rooms outside this claim batch.
    // The unscoped dispatcher must ask again until nothing is claimable.
    if (scope === 'room' && !pending && !dirty) return { delivered, reason: 'settled' };
  }
  return { delivered, reason: 'budget' };
}

type Entry = { dirty: boolean; state: 'waiting' | 'active' | 'expired'; ready(admitted: boolean): void; promise: Promise<void>; deadline: number };
/** Per-isolate optimization only. No clients, Requests, Responses or streams are shared. */
export class RoomHintScheduler {
  private readonly entries = new Map<string, Entry>();
  private waiting: Entry[] = [];
  private active = 0;
  constructor(private readonly concurrency = 2, private readonly maximumKeys = 32, private readonly budgetMs = HINT_TASK_BUDGET_MS,
    private readonly now = () => performance.now()) {}
  get size(): number { return this.entries.size; }
  get running(): number { return this.active; }
  schedule(key: string, work: (task: HintTask) => Promise<HintDrainResult['reason'] | void>): Promise<void> {
    const existing = this.entries.get(key);
    if (existing) { existing.dirty = true; return existing.promise; }
    // Durable pending rows are deliberately left for the periodic dispatcher.
    if (this.entries.size >= this.maximumKeys) return Promise.resolve();
    let admit!: (admitted: boolean) => void;
    const ready = new Promise<boolean>(resolve => { admit = resolve; });
    const controller = new AbortController();
    const entry: Entry = { dirty: true, state: 'waiting', ready: admit, promise: Promise.resolve(), deadline: this.now() + this.budgetMs };
    const timer = setTimeout(() => {
      controller.abort();
      if (entry.state === 'waiting') { entry.state = 'expired'; entry.ready(false); }
    }, this.budgetMs);
    this.entries.set(key, entry);
    // This callback lives in its owner's asynchronous task; only its void promise
    // and plain scheduling data are visible to other requests.
    entry.promise = (async () => {
      const admitted = await ready;
      try {
        if (admitted) {
          const task = { deadline: entry.deadline, signal: controller.signal, consumeDirty: () => {
            const dirty = entry.dirty; entry.dirty = false; return dirty;
          } };
          do {
            entry.dirty = false;
            const outcome = await work(task);
            if (outcome === 'error' || outcome === 'budget') break;
            // No await separates this final check from detaching the entry below.
            // A producer before this check triggers another owner pass; one after
            // detachment creates a fresh owner. The original deadline never resets.
            if (!entry.dirty || controller.signal.aborted || entry.deadline - this.now() < HINT_PUBLISH_TIMEOUT_MS + HINT_DB_TIMEOUT_MS) break;
          } while (entry.dirty);
        }
      } finally {
        clearTimeout(timer);
        if (admitted) this.active--;
        if (this.entries.get(key) === entry) this.entries.delete(key);
        this.waiting = this.waiting.filter(item => item !== entry);
        this.pump();
      }
    })();
    this.waiting.push(entry); this.pump();
    return entry.promise;
  }
  private pump(): void {
    while (this.active < this.concurrency && this.waiting.length) {
      const entry = this.waiting.shift()!;
      if (entry.state !== 'waiting') continue;
      if (entry.deadline <= this.now()) { entry.state = 'expired'; entry.ready(false); continue; }
      entry.state = 'active'; this.active++; entry.ready(true);
    }
  }
}
