# B5 first local readiness probe — not sustained acceptance

Source: `B5_ROOMS_LOAD_PROBE_2510e7b1-b79a-40e3-a624-f4704991d9aa.json` (original artifact retained unchanged).

- Real window: 120.18 seconds at 4×20 members + 20 secondary connections; then 60.14 seconds at 8×10 + 20 secondary connections.
- First window: 100 authorized subscriptions throughout sampled observation, no unplanned connection deficit. Varied window deliberately disconnected all 100 transports, then restored 100. All 300 transports opened across setup/reconfiguration/reconnect were closed at cleanup.
- Cleanup: 80 synthetic accounts released from membership/time; 12 owned rooms closed to new joins. Synthetic accounts and immutable histories retained.
- No HTTP errors or duplicate-active-ledger findings. This is not a complete B5 acceptance result.
- **Latency failed:** 160 `joinRound` requests, median 167.48ms, p95=2317.90ms, p99=5280.97ms, against the unchanged 2 s p95 target. Both 80-call batches were setup at actor concurrency 6, before their 100 subscriptions opened. Active hint-driven client reads therefore cannot explain those particular samples. Post-commit publication activity and the action's follow-up snapshot were still present.
- No application hints or fixed phase boundaries occurred in these short, initially quiet windows. No periodic dispatcher was running. These behaviors remain unproven by this artifact.
- The 300 `subscriptionFailures` counter includes deliberate teardown callbacks. It cannot be interpreted as 300 unexpected subscription failures; the diagnostic harness now separates deliberate closes.
- Sampled DB occupancy: 13 client backends of 30 configured (3 superuser-reserved); no DB-capacity saturation established. Current host pressure was observed separately, including substantial swapped workerd memory. Neither pressure nor a later lock-wait sample retrospectively identifies the slow request's cause.
- `resourceUsage.maxRSS` is a high-water mark, not current generator RSS. A separate live `/proc` sample showed the generator around 72MiB RSS; revised metrics capture current RSS and worker swap alongside PSI.

## Next diagnostic window (requires root runtime/browser GO)

The revised harness retains the aggregate 2 s target, adds maximum/setup/steady groups and safe local `Server-Timing` parsing, and records receipt lock-boundary segments. `rpc` timing includes PostgREST transport/pool/lock/SQL; it is not SQL-only. It also adds actual hint pulses, normal authenticated 30 s job dispatch with existing-backlog baseline, bounded own-job drain, and accurate teardown classification. Reviewer released the bounded diagnostic probe. Full real 2 h sustained acceptance remains withheld pending these results.
