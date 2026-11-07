# B5 settlement cost repair

Status: SQL030 was independently source-reviewed and applied transactionally by the owner at 2026-11-01 02:02:17 UTC. Runtime GREEN passed; subsequent load evidence is pending. This is not a B5 acceptance result.

The current-UI probe373aadba failed despite zero deadlocks or HTTP errors. Its later-window database sample observed lock waits, but did not cover early setup. Independently, SQL source and transaction-local counters identified repeated settlement and unchanged job-row rewrites. These measurements establish redundant work; they do not isolate the cause of every slow request or late broadcast.

RED evidence: [complete counters and schedule-state checks](B5_ROOM_READ_COST_BEFORE_2b7e94c4-d732-4d51-b4fa-c0c60ad9707f.json). All measured mutations rolled back; no global statistics were reset. Synthetic setup was released and its room closed.

| Operation | Settlement calls | Public projection calls | Job tuple updates |
| --- | ---: | ---: | ---: |
| Read own room context | 2 | 3 | 2 |
| Read own private snapshot | 2 | 4 | 2 |
| Issue Realtime grant | 1 | 1 | 1 |
| Set intent | 2 | 4 | 3 |

SQL030 introduces an internal three-argument settlement overload that settles the sorted, deduplicated union of explicit targets and the exact existing covered set before the unchanged time-ledger tail. Existing two-argument behavior/ACL stays intact. Private context, snapshot and initial command settlement use the new overload; receipt replay, post-mutation settlement and the single grant settlement remain unchanged. The snapshot reuses its already computed public room projection only after an exact room-ID match.

The job scheduler skips physical updates only when the assigned status and next-run date are unchanged, or an already-idle job has no claim/lease to clear. Pending earliest-date behavior, running/failed states, attempts, claim tokens, leases and error fields retain their previous semantics. Eight RED state-transition checks already pass; the ninth intentionally records existing idle tuple churn.

The GREEN runner remeasured actual calls/tuple updates and compared both ledger paths from identical rolled-back running and paused Room sessions at a fixed deadline. This test clock is confined to the rolled-back synthetic SQL comparison; it is not used for load acceptance. No UI protocol, connection pool, provider limit or privacy freshness policy is relaxed.

GREEN: [measured results](B5_ROOM_READ_COST_AFTER_8f9ab1c4-03cc-4fa4-8f2e-1ccc539e4528.json) on build `f4f8424b7256cf150941f4a676406dbbd8677b325fcd0c81006d5fb53c6fefa3`:

| Operation | Settlement calls | Public projection calls | Job tuple updates |
| --- | ---: | ---: | ---: |
| Read own room context | 1 | 2 | 0 |
| Read own private snapshot | 1 | 2 | 0 |
| Issue Realtime grant | 1 | 1 | 0 |
| Set intent | 1 | 3 | 0 |

All nine job-policy checks passed. Running and paused Room sessions produced identical old/new state at the original deadline, with duplicate/null targets deduplicated and internal-only privileges verified. Synthetic cleanup passed. These results establish the scoped SQL behavior/cost change; they do not establish a new load latency or delivery result.

Follow-up functional gates on the same build passed: Rooms API 24/24, FK 4/4, Time 24/24, producer 6/6 and [private Realtime 9/9](B5_PRIVATE_REALTIME_b847b8a7-c616-45f0-bd73-662f100121fb.json). An earlier private Realtime evidence write raised ENOSPC and truncated its latest report; that failed run remains unclassified and its underlying failure is unknown. The authorized diagnostic rerun used atomic evidence saving and passed, with [64 filesystem samples](B5_PRIVATE_REALTIME_RERUN_SPACE.json) showing 973–977MB available on root. No prior report was reconstructed.
