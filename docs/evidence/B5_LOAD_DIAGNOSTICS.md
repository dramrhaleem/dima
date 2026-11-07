# B5 local load diagnostics — sustained gate still open

The unchanged action target is p95 ≤ 2 seconds. These are real short probes, not two-hour acceptance or hosted capacity evidence. Original JSON artifacts are retained.

| Probe artifact suffix | Connected during Start / JoinRound | JoinRound calls | Aggregate p95 | Maximum | Outcome |
|---|---:|---:|---:|---:|---|
| `2510e7b1-b79a-40e3-a624-f4704991d9aa` | No | 160 | 2317.90 ms | See original artifact | Latency failed; no periodic dispatcher/hints |
| `3c407f37-85cf-40dc-a8ef-b7d86f768f31` | No | 160 | 1174.66 ms | 4372.28 ms | Own-job drain exhausted its old 10-batch bound; 8×10 setup p95 2078.11 ms |
| `109023f8-244c-49e1-b74f-8fcb98a445ef` | **100 Watching subscriptions** | 160 | **2382.79 ms** | **3384.55 ms** | **Latency failed**; all other measured short-probe checks passed |

Artifacts are `B5_ROOMS_LOAD_PROBE_<suffix>.json` in this directory. Different harness workloads are explicitly distinguished; these three rows are not a controlled optimization comparison.

The final connected probe runs the real UI request pattern: controller renewal plus snapshot, secondary `/me` then snapshot, coalesced invalidation `/me` then snapshot, grant renewal, and the ordinary 30-second durable dispatcher. The connection pump remains active during setup, before Run start and explicit personal participation.

## Connected-probe evidence

- 4×20 setup JoinRound p95 **2183.00 ms**; 8×10 setup p95 **2582.21 ms**. The aggregate must not hide either subgroup.
- Room join p95 219.31 ms; StartRun p95 744.03 ms. No HTTP errors or duplicate active-ledger findings.
- 100 authorized connections restored after the labeled 15-second all-transport interruption; no unplanned authorized deficit. 300 transports opened/closed across setup, redistribution, interruption and cleanup.
- 2300 actual invalidation deliveries; 3300 expected-version acknowledgments (one newer hint can acknowledge multiple prior expected versions), p95 1376 ms. No malformed, missing or pending deliveries; no unexpected subscription failures.
- Measured steady window 120.02 s, varied window 60.03 s. No real 25-minute phase boundary or one-hour Auth expiry occurred; those remain sustained-test obligations.
- Cleanup released all 80 synthetic memberships/time and closed all 12 owned rooms. Own jobs ended at 0 due, 0 failed, 172 future after 10 normal dispatcher batches. No queue rows were deleted or rescheduled to pass.

## Bounded interpretation and next change

The worst first-setup request measured 3358.64 ms end-to-end: Auth 75 ms, profile request 2389 ms, room RPC 750 ms, total handler 3215 ms. Another request's room RPC dominated instead. These timings include transport, PostgREST pool waits and SQL/lock work; they do not isolate SQL CPU or prove that every tail request has the same cause.

The approved next experiment moves the existing onboarding requirement into each of the five private room RPC transactions, then removes the separate BFF profile SELECT. It retains fresh private snapshots, current authorization, receipt semantics and Account→Room lock order. Denial without side effects and existing positive/replay cases must pass before repeating the **same connected harness**. No latency target is relaxed and no improvement is claimed before measurement.
