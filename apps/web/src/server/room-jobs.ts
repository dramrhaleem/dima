import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { environment } from './foundation';
import { publishRoomHint } from './realtime';
import { drainHintQueue, HINT_DB_TIMEOUT_MS, RoomHintScheduler, type HintAck, type HintClaim, type HintTask, type HintDrainResult } from './room-hint-delivery';

type JobClaim = { id: string; claimToken: string };
function database(): SupabaseClient | null {
  const env = environment() as { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.any([AbortSignal.timeout(HINT_DB_TIMEOUT_MS), ...(init?.signal ? [init.signal] : [])]) }) },
  });
}
let diagnosticBatch = 0, diagnosticChain = 0;
type HintDiagnosticContext = { batch: number; source: 'postcommit' | 'dispatcher'; chain: number | null; pass: number | null };
function hintDiagnostic(context: HintDiagnosticContext, stage: 'claim' | 'publish' | 'ack' | 'release',
  started: number, ok: boolean, code: string | null = null, status: number | null = null, claims: number | null = null): void {
  try {
    const env = environment() as { SUPABASE_URL?: string };
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(env.SUPABASE_URL ?? '').hostname)) return;
    console.info(JSON.stringify({ event: 'room_hint_diagnostic', batch: context.batch, source: context.source, chain: context.chain, pass: context.pass, stage,
      durationMs: Math.round(performance.now() - started), ok,
      code: code && /^[A-Z0-9_]{1,32}$/.test(code) ? code : null, status, claims }));
  } catch { /* Diagnostics never change a delivery result. */ }
}
function hintDrainDiagnostic(context: HintDiagnosticContext, started: number, task: HintTask, result: HintDrainResult): void {
  try {
    const env = environment() as { SUPABASE_URL?: string };
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(env.SUPABASE_URL ?? '').hostname)) return;
    console.info(JSON.stringify({ event: 'room_hint_drain', source: context.source, chain: context.chain,
      reason: result.reason, delivered: result.delivered, durationMs: Math.round(performance.now() - started),
      remainingBudgetMs: Math.max(0, Math.round(task.deadline - performance.now())) }));
  } catch { /* Observability never changes delivery. */ }
}
function storageCode(error: { code?: string; message?: string } | null): string | null {
  if (!error) return null;
  if (error.code) return error.code;
  // Inspect only fixed type prefixes; never log message, details, SQL or payloads.
  if (error.message?.startsWith('TimeoutError:')) return 'FETCH_TIMEOUT';
  if (error.message?.startsWith('AbortError:')) return 'FETCH_ABORT';
  return 'FETCH_ERROR';
}
const scheduler = new RoomHintScheduler();
async function flushRoomHints(db: SupabaseClient, task: HintTask, roomIds: string[] | null, limit: number,
  source: 'postcommit' | 'dispatcher'): Promise<HintDrainResult> {
  const diagnostic: HintDiagnosticContext = { batch: 0, source, chain: ++diagnosticChain, pass: 0 };
  const started = performance.now();
  const result = await drainHintQueue({
    claim: async signal => {
      diagnostic.batch = ++diagnosticBatch; diagnostic.pass = (diagnostic.pass ?? 0) + 1;
      const started = performance.now();
      const { data, error, status } = await db.rpc('claim_room_hints', { p_limit: limit, p_rooms: roomIds }).abortSignal(signal);
      hintDiagnostic(diagnostic, 'claim', started, !error, storageCode(error), status, error ? null : (data as HintClaim[]).length);
      return error ? null : data as HintClaim[];
    },
    publish: async claim => {
      const started = performance.now();
      try {
        await publishRoomHint(claim.topic, claim.hint);
        hintDiagnostic(diagnostic, 'publish', started, true);
        return true;
      } catch (error) {
        const status = error instanceof Error ? error.message.match(/^Realtime delivery failed \((\d{3})\)$/)?.[1] : undefined;
        const code = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'TRANSPORT_TIMEOUT' : 'DELIVERY_ERROR';
        hintDiagnostic(diagnostic, 'publish', started, false, code, status ? Number(status) : null);
        return false;
      }
    },
    acknowledge: async (claim, signal) => {
      const started = performance.now();
      const { data, error, status } = await db.rpc('ack_room_hint_result', { p_room: claim.roomId, p_claim: claim.claimToken, p_version: claim.version }).abortSignal(signal);
      hintDiagnostic(diagnostic, 'ack', started, !error, storageCode(error), status);
      return error ? null : data as HintAck;
    },
    fail: async (claim, signal) => {
      const started = performance.now();
      const { error, status } = await db.rpc('fail_room_hint', { p_room: claim.roomId, p_claim: claim.claimToken }).abortSignal(signal);
      hintDiagnostic(diagnostic, 'release', started, !error, storageCode(error), status);
    },
  }, task, () => performance.now(), roomIds === null ? 'all' : 'room');
  hintDrainDiagnostic(diagnostic, started, task, result);
  return result;
}
/** Only hints run after the response; the durable ledger committed before this call. */
export function scheduleRoomHints(ids: (string | null | undefined)[]): void {
  const rooms = [...new Set(ids.filter((id): id is string => typeof id === 'string'))].slice(0, 2);
  if (!rooms.length) return;
  try {
    const context = getCloudflareContext();
    for (const room of rooms) {
      const pending = scheduler.schedule(room, async task => {
        // This client belongs only to the original owner's waitUntil task.
        const db = database();
        if (!db) return 'error';
        return (await flushRoomHints(db, task, [room], 1, 'postcommit')).reason;
      });
      // Every coalesced producer attaches lifetime, including secondary callers.
      context.ctx.waitUntil(pending.catch(() => { /* Durable dispatcher recovery. */ }));
    }
  } catch { /* Non-Worker development retains the durable periodic fallback. */ }
}
export async function dispatchRoomJobs(db: SupabaseClient): Promise<Record<string, number>> {
  const result = { roomCompleted: 0, settlementCompleted: 0, roomRetried: 0, hintsDelivered: 0 };
  for (const kind of ['room', 'account'] as const) {
    const { data, error } = await db.rpc(kind === 'room' ? 'claim_room_jobs' : 'claim_room_account_jobs', { p_limit: 3 });
    if (error) throw new Error('Room job storage unavailable');
    for (const job of data as JobClaim[]) {
      const { data: execution, error: executionError } = await db.rpc(kind === 'room' ? 'execute_room_job' : 'execute_room_account_job',
        kind === 'room' ? { p_room: job.id, p_claim: job.claimToken } : { p_actor: job.id, p_claim: job.claimToken });
      if (executionError) {
        await db.rpc('fail_room_job', { p_kind: kind, p_id: job.id, p_claim: job.claimToken });
        result.roomRetried++;
      } else if (execution.status === 'done') {
        if (kind === 'room') result.roomCompleted++; else result.settlementCompleted++;
      }
    }
  }
  await scheduler.schedule('$dispatcher', async task => {
    const hintDb = database();
    if (!hintDb) return 'error';
    const delivered = await flushRoomHints(hintDb, task, null, 3, 'dispatcher');
    result.hintsDelivered += delivered.delivered;
    return delivered.reason;
  });
  return result;
}
