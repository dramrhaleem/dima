import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { RoomCommand, RoomCommandResponse } from '@dima/contracts';
import { environment } from './foundation';
import { committedRoomHint, CommittedHintPublisher, type FastHintResult } from './room-hint-fast';
import { scheduleRoomHints } from './room-jobs';
import { publishRoomHint } from './realtime';

function diagnostic(result: FastHintResult): void {
  try {
    const env = environment() as { SUPABASE_URL?: string };
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(env.SUPABASE_URL ?? '').hostname)) return;
    console.info(JSON.stringify({ event: 'room_hint_fast', ...result }));
  } catch { /* Observation cannot fail an already-committed command. */ }
}
// Shared state contains plain committed metadata, scheduling promises and
// watermarks only. Fetches/timers are created inside their original owner's task.
const publisher = new CommittedHintPublisher((descriptor, signal) => publishRoomHint(`room:${descriptor.roomId}`, descriptor.hint, signal), diagnostic);

export function scheduleCommittedRoomHints(command: RoomCommand, response: RoomCommandResponse): void {
  const descriptor = committedRoomHint(command, response);
  const sourceRoom = 'fromRoomId' in command ? command.fromRoomId : null;
  if (!descriptor) { scheduleRoomHints([response.receipt?.roomId, sourceRoom]); return; }
  try {
    const context = getCloudflareContext();
    // Every follower attaches lifetime; the original owner's fixed deadline is
    // never extended. This path never claims, acknowledges or clears the outbox.
    context.ctx.waitUntil(publisher.schedule(descriptor).catch(() => { /* Durable dispatcher recovery. */ }));
  } catch { /* Development without a Worker retains the durable outbox. */ }
  if (sourceRoom && sourceRoom !== descriptor.roomId) scheduleRoomHints([sourceRoom]);
}
