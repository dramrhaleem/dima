# Separate initial JoinRound burst probe

Status: implemented in the test harness after ordinary probe 28bc40a8 passed. Independent source review and complete burst rerun62ce7f12 passed the existing HTTP/error/ledger gates. See B5_INITIAL_BURST_ACCEPTANCE.json. Sustained acceptance and the observed post-commit UI latency remain open. Interrupted7e66ddc7 is retained as partial evidence only.

Add a probe-only `--initial-join-burst` flag, rejected without `--probe`. Ordinary setup retains concurrency6 and its existing report labels. The new mode is a separate readiness measurement, never two-hour sustained acceptance.

1. Reuse the current-UI model and its live read/renewal/grant pumps. Establish80 Watching primary controllers plus20 real secondary subscriptions before StartRun; assert no accepted personal sessions yet.
2. Start the four real Runs. Acquire each primary actor's existing action guard, preserving per-account serialization. Wait at a shared bounded readiness barrier until all80 have an authoritative cached focus snapshot for their own expected Run/round, `canJoinRound=true`, matching control, no active session and a live membership. No JoinRound runs before the barrier. The server snapshot must postdate that Run's start; record its age at release instead of describing all cached state as instantaneous.
3. Release the80 guarded actions in the same JavaScript turn. Submit the exact cached-state command through the existing operation store; add no convenience GETs and no hidden concurrency limiter. Existing post-action snapshot and background reads remain active.
4. Instrument actual JoinRound HTTP dispatch/completion, not just Promise creation: first/last dispatch skew, actual peak in-flight POSTs, per-actor action-guard wait and snapshot age, command latency and full action latency. Report the measured peak honestly; releasing80 promises alone does not prove80 concurrent HTTP requests.
5. Require80 successful unique account/Run/round acceptances and a real ledger probe showing80 unique active personal Sessions with no duplicate active accounts. Keep the existing2s command p95,10s hint-delivery checks, error/deadlock counters and bounded final drains. Preserve every slow/error sample.
6. Perform normal release, then repeat with eight rooms of ten primaries and the same20 secondary connections. Keep the two distributions separate in metrics. Preserve normal heartbeat, token refresh, dispatcher, fault/reconnect, privacy and cleanup evidence.

No database clock aging, API test flag, pool increase, tenant-limit change or deadline relaxation. A short initial-join burst does not substitute for real later phase transitions or the full100-connection/two-hour gate. Readiness timeout is a failed/incomplete probe, not permission to release fewer actors or silently fall back to concurrency6.

Implementation validation: new barrier tests 3/3 passed, existing workload helper tests 21/21 passed, and scoped ESLint passed. Invalid flag without `--probe` exits before runtime access. Each nonempty operation group now independently enforces the same 2s p95 for join, startRun and joinRound; aggregate checks remain.
