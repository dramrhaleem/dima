# B5 hint producer repair

Status: migration029 applied; its focused real REST/workerd execution passed and private Realtime regression passed 9/9. The subsequent current-UI probe 373aadba failed: 220 expected client deliveries arrived after 10s, and JoinRound p95 exceeded 2s. Those failures remain preserved. The follow-up dispatcher/empty-claim fixes pass 15 unit tests and six real REST/workerd groups on the new Worker build; the next load measurement remains pending. Sustained acceptance remains pending; B5 is not closed.

The original two-pass producer could leave a newer committed version pending after its final ACK while the other producer had already observed the busy lease. `ack_room_hint_result` now atomically returns `{accepted,pending}`. A stale claim or a version beyond the current row is rejected; the old void ACK delegates to the same implementation.

Both paths share the bounded drain. A room-scoped producer stops after its accepted ACK has no newer data and no local dirty signal. The unscoped dispatcher continues across claim batches until nothing is claimable, or the budget/error boundary is reached: ACKs for three rows cannot establish that other rooms are empty. Local dirty signals cover commits after ACK and after an empty claim snapshot, including final promise settlement. Busy results retry only with a fresh dirty signal; errors/budget exhaustion do not retry. SQL leases remain the authority across Worker isolates.

The in-memory coordinator is an optimization per Worker isolate: two active producers and at most 32 distinct queued keys, including the dispatcher key. Shared state holds scheduling flags/resolvers and `Promise<void>` only. The original owner creates its client inside its asynchronous task; every producer attaches a `waitUntil` promise. Settled/expired entries are removed. Later callers never reset the original deadline.

The 28s budget starts when queued, so queue wait counts. RPCs have a 15s client bound. PostgREST14 hoists the four hint RPCs' 2s statement timeout before execution; local acquisition is 10s, leaving a transport margin. A new claim also requires the 20s publication/ACK allowance to remain. A slow claim or exhausted budget can therefore leave an accepted lease for normal recovery. No shorter delivery guarantee is claimed under saturation.

A fetch failure with no response remains an unknown claim outcome, not an empty queue. Pending rows/30s leases survive; retry limits and the durable dispatcher remain in force. No provider limits, pool sizes, room privacy projections, or time-ledger behavior were changed.

Verification:

- 15 deterministic tests now pass, including multi-batch global draining, no extra scoped claim, a fresh producer after an empty claim snapshot, and exactly one additional busy claim per fresh signal. The original 9 cover third-version handoff, post-ACK/final-settlement races, lost responses, budget fallback and bounded scheduling.
- `tests/integration/rooms-hints.mjs` passed 5/5 groups: REST permission/version fences; actual 57014 timeout in 2224ms with unchanged row; explicitly simulated lost-response recovery; and 8 concurrent commands across 4 rooms in workerd with latest-hint observation. [Evidence](B5_HINT_PRODUCER_b38ea877-7c7d-49cf-b7a7-4929d0c6baf3.json).
- The real-worker case passed with zero observed different-request I/O, hanging-Promise or never-response errors in the fresh preview log. This proves the exercised local workerd path, not hosted load capacity; sustained acceptance remains separate.
- The follow-up suite passed all six groups: [evidence](B5_HINT_PRODUCER_5648b895-21f6-461a-9a46-58b679f0f5af.json). One protected dispatcher request delivered eight total hints, including all four independently queued synthetic rooms, in 497ms across three-row claim batches. The actual SQL timeout/rollback case took 2218ms. Cleanup passed. Local-only drain outcome diagnostics distinguish settled/busy/error/budget exits without identifiers or payloads.
