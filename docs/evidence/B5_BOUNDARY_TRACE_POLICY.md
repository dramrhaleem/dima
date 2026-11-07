# B5 bounded boundary diagnostics

The diagnostic layer was reviewed separately before the v3 UI-contract mirror. It adds observation only and retains the2s gate. The current helper additionally contains the explicit workload-fidelity correction described below; runtime evidence is pending.

- At most1000 records identified by numeric room-index/tab-index and real phase deadline; records are materialized only within−3s/+15s of that deadline. Each record permits32 HTTP requests and80 metadata events; explicit counters report truncation.
- The latest/initial server anchor carries revision, server timestamp, monotonic timestamp and room/hint versions. Current and previous pending anchors permit a late old-boundary response to retain its correct identity.
- Each request has a helper-generated per-tab integer ID, static endpoint/reason, wall and monotonic start, completion/duration and whitelisted Server-Timing. Recorded requests may complete after the observation window. No headers, body, names, account IDs or roster is stored.
- Metadata records Time deadline scheduling/dispatch, Room pump detection/dispatch lag, coalesced reads, refresh reasons, accepted/discarded/error Me/Time states, snapshot outcome/retry/version/serverTime, and the first fresh snapshot confirmation with its readiness latency.
- In the diagnostic-only patch, request scheduling, API operations, timer delays, observer cadence, command concurrency and acceptance thresholds were unchanged. Instrumentation itself adds no network traffic or timers; the subsequent v3 mirror is separate.
- Three deterministic tests cover old-boundary correlation after reanchoring, completions beyond the window, caps/truncation, payload exclusion and room-distribution isolation. Existing21 workload and3 burst tests also pass.

Limits: this is the synthetic current-UI request model, not100 DOM-rendering measurements. Request observations add small local bookkeeping/serialization cost. Diagnostic completeness must be checked from truncation counters before interpreting a trace. The next UI boundary-contract change requires a separately reviewed helper mirror and browser fidelity evidence.

Review adjustment: record ceiling increased from700 to1000 as bounded headroom. The default classic two-hour window has seven transitions (25/30/55/60/85/90/115minutes); its final long break ends at130minutes, so700 records cover the nominal100-tab window. Raw first-confirmation readiness and the aggregate gate now use the identical single computed value.

## Subsequent v3 workload-fidelity correction

The helper now mirrors the current RoomView/RoomsProvider contract: an independent timer keyed by effective snapshot-or-Me deadline and membership scope/live, without rearming on unchanged clock anchors; a deadline freshness floor in the snapshot coalescing identity and stale/reconcile retries; and one750ms retry for retry/unavailable, canceled with scope changes. The outer pump retains virtual phase expectations but no longer dispatches boundary network refreshes. The observer cadence, initial command concurrency and Time→Me reconciliation remain. This is an explicit model correction and UI behavior change, not evidence of a performance improvement. Prior v2 measurements remain historical v2 results.

Current pure verification:31 tests across workload, burst and diagnostic helpers, plus scoped ESLint. Live/browser fidelity and measured capacity remain separate gates.

## V4 Time reconciliation mirror (candidate, not a load result)

The known live-member Time effect now mirrors the production provider's `SnapshotFreshness` object: `minimumServerTime` and `minimumTimeRevision` are both part of the snapshot flight identity, checked before acceptance, and retained through the bounded stale retry and safe Me reconciliation fallback. Expired membership retains Me-first recovery. The room-boundary timer still supplies only its server-time floor and retains its original independent scheduling and750ms retry behavior.

The diagnostic allowlist adds only numeric `minimumTimeRevision`. The harness profile label is `current-ui-foreground-room-v4-time-snapshot-floors`. Actor/tab distribution (including40 connections in room0), observer cadence, resources, clocks and acceptance thresholds are unchanged. Historical v3 run778e13f0 remains a failed first-boundary result; it is not rewritten as v4 evidence.

Scoped ESLint and36 client/burst/diagnostic pure tests passed. Five new regressions cover separate held/Time flights, stale Time revision despite fresh timestamp, floor preservation through reconciliation, expired-member recovery and denied private state. Independent helper/provider source comparison found no material divergence. Production browser and full real-time load acceptance are separate gates owned by the parent workflow.

### Scope-bound required-Time fence follow-up

A later red browser/pure regression showed that request-local floors alone allowed an older ordinary reply to install a stale roster after accepted Pause when the newer Time-floored request failed. Pre-fence proof is preserved in `B5_TIME_FRESHNESS_HELPER_RED.json`; the earlier36-test source review remains historical evidence, not acceptance of the fix.

The helper now mirrors the provider's latest-required Time fence, bound to owner/room/member/controller scope and permission epoch. Explicit Time floors raise maximum requirements; new flights inherit them and every response rechecks the current fence. Permission invalidation clears it. Boundary-only deadlines are not made persistent. Last confirmed display and accepted Time remain usable while stronger reads fail. Scoped ESLint and40 pure client/burst/diagnostic tests pass; exact hashes and review state are in `B5_TIME_FRESHNESS_HELPER_FENCE_REVIEW.json`.
