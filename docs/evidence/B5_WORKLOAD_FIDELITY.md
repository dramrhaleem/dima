# B5 workload fidelity audit

The baseline audit and earlier browser traces below describe v1. The final section records the independently checked v2 source and representative browser trace; neither profile is a capacity result.

Status: source audit, isolated helper checks and representative browser request traces passed. The `current-ui-foreground-room-v1` harness profile is ready for its first load probe. This is not a new load pass or hosted-capacity claim. No runtime calls were made for the source-audit portion. Historical failed load artifacts remain unchanged.

## Verdict

The legacy harness is a useful comparative stress workload, but not an exact current-browser model or a proven upper bound. It adds preparatory reads and omits other real reads. Removing only the preparatory reads would leave incorrect caches and under-model parts of the UI.

Audited legacy harness SHA-256: `4d74e771b8796e970785bd87c28e6bfc9f35167ca959f6c8e444ad1c1284fda8`.

## Current request contract

| Trigger | Current browser | Legacy harness difference |
| --- | --- | --- |
| Explicit JoinRound | Submit cached membership/control, run/round and Focus time revision directly; accept returned TimeData and RoomMe; fetch private snapshot. | Always GET time, then GET rooms/me before POST. Action latency includes these two reads. |
| Presence heartbeat | Visible online controlling tab every30s: POST renewPresence, accept returned TimeData/RoomMe, then private snapshot. Ordinary renewal is not a broadcast trigger. | POST plus snapshot already matches; retain it. |
| Secondary tab | Independent local caches. Every30s, GET rooms/me then snapshot; newer timeRevision conditionally loads compact time. No second time renewal for a live Room membership. | Secondary poll exists, but its /me result is discarded and it shares the actor's time cache. |
| Connected / realtime hint |120ms coalescer covers the whole /me→snapshot chain, including one bounded stale retry; hints during the flight mark a trailing refresh dirty. Every hint immediately invalidates in-flight permission generation. | Hint chain is single-flight, but connect, action and secondary paths lack browser-equivalent keyed read sharing. |
| Accepted RoomMe | Apply freshness/owner checks; if timeRevision exceeds that tab's TimeData revision, GET time?limit=1 through one time flight. Snapshot.me also participates. | Hint/connect/secondary /me replies and snapshot.me are not applied to actor caches. |
| Accepted direct time update | If time revision is ahead of RoomMe, request /me→snapshot. | No equivalent effect. |
| Focus end | Every tab displaying the active running session schedules GET compact time at interval boundary+150ms. Room detail independently requests /me→snapshot at phase boundary+200ms; overlapping keyed reads may share. | Phase /me→snapshot exists, but independent personal time-boundary reads are omitted. |
| New run / round | JoinRound component remounts and GETs /learning, including Work selection and secondary tabs. This is current UI overhead, not an optimization assumption. | Omitted entirely. |
| Future-round participation | Fresh capabilities enable a button; a user must explicitly choose Join. Break and phase changes never start personal time. | The pump simulates every controller choosing Join promptly at each future round. Keep this declared stress assumption, not a claim of automatic product behavior. |
| Grant refresh / failure | Refresh15s before server-anchored expiry. Transient grant failure backs off30s; CLOSED schedules fresh grant with bounded1–30s backoff, and the adapter recreates the closed channel. | A due failed grant can retry on the next200ms pump; setAuth alone does not recreate a CLOSED channel. |

Current implementation detail: accepting command TimeData does not synchronously update RoomsProvider's effect-maintained Focus reference. When that command advances time revision, accepting its RoomMe can still schedule a compact time read. A faithful profile must account for this auxiliary read until an actual UI change or browser trace establishes otherwise; it cannot assume that returned TimeData removes every GET.

## Single-flight boundaries

- Rooms `/me` flights are keyed by requested room, not one universal global flight.
- Snapshot flights are keyed by room, membership, control generation, permission epoch, account revision and serverTime. Different epochs can have independent requests; stale responses cannot restore private state.
- Realtime's connected/hint queue owns one complete chain and one dirty trailing refresh. Explicit actions, passive focus refresh, heartbeat, time-revision and phase-boundary effects are separate callers sharing the keyed flights where their inputs match.
- Compact TimeData refreshes share one flight per FocusProvider/tab. Session-summary detail fallback is separate when a finalized prior session is absent from the compact response.

## Error amplification to avoid in the faithful model

Legacy `roomCommand` accepts a successful command's state before awaiting its snapshot, but an error in that snapshot prevents `explicitJoinRound` from setting its joined marker. The next200ms pump can repeatedly GET time/me and return on an existing active session. The real UI has already accepted that session; snapshot failure is displayed without discarding the successful action. Preserve the original failed request in evidence, but do not manufacture repeated user clicks or fresh operation IDs while reconciliation is pending.

## Faithful-profile requirements

1. Preserve80 controlling accounts,20 independent secondary tabs,100 authorized subscriptions, actual renewal snapshots, both room distributions, real deadlines,30s jobs, user-action bursts, intent changes, reconnect scenario, privacy checks and existing latency thresholds.
2. Maintain RoomMe, TimeData, snapshot and monotonic anchors per connection. Apply returned command/snapshot state; conditionally refresh time using the current UI rules. Keep controller actor state synchronized with its primary connection only.
3. Model same-key read sharing and connected/hint dirty trailing refresh without serializing independent browser effects globally. Retain phase, personal boundary, new-round learning and grant calls.
4. Simulate future-round clicks only after current visible capabilities allow them; record their number. Never count Waiting as participation or create time automatically in the product model.
5. Keep command acknowledgment separate from snapshot success. Retain stable operation identity on uncertain failures, refresh on definitive conflicts, and bound automatic retries. Reconciliation must not erase failures or grant unearned successful latency samples.
6. Label metrics as a new current-UI profile; retain legacy reports/hashes and their failures. Report POST latency separately from complete action refresh latency. Do not compare different profiles as a pure SQL speed-up.
7. Before acceptance, verify representative request traces (primary + secondary, join, renewal, boundary, hints and failures). Source/static tests alone do not prove runtime fidelity or100-client capacity.

## Source anchors

- `packages/ui/src/rooms.tsx`:129–171 (JoinRound),224–240 (view/boundary reads),259 (run/round key).
- `packages/ui/src/rooms-provider.tsx`:79–92 (effect-maintained Focus reference),113–183 (acceptance/read sharing),185–211 (actions),235–248 (heartbeat/time effect),253–325 (realtime/grants).
- `packages/ui/src/focus.tsx`:149–177 (time acceptance/load),215–247 (passive/cross-tab),251–265 (time actions),362–381 (renewal suppression/boundary).
- `packages/client/src/realtime.ts`: fresh-grant CLOSED recovery and official SDK lifecycle.
- Legacy `tests/integration/rooms-load.mjs`:163–184 (cache/read/action handling),252–261 (pre-reads),272–290 (snapshot handling),369–386 (connect/heartbeat),522–557 (future actions/polls/grants).

Auth/onboarding bootstrap, public room metadata, route transitions and optional session-history views are additional browser traffic. The sustained room-view profile must explicitly state which cold-start and unrelated-route traffic it excludes; none may be presented as an all-platform capacity forecast.

## Implemented profile and remaining verification

- The runner uses `tests/helpers/room-load-client.mjs` for independent tab caches/read sharing. It retains100 foreground subscriptions,80 controllers,20 secondary views, renewal snapshots, boundary reads and the actual Work-view learning-list overhead. Primary heartbeat and secondary polling start at each tab's mount; phase changes do not reset their cadence.
- Synthetic user retries are bounded to one attempt per30s after failure, preserve the original uncertain operation, and never turn a successful command plus failed snapshot into repeated fresh JoinRound commands. HTTP/transport failures remain counted and make acceptance ineligible.
- Every room/round with at least5s of opportunity before observation ends must have all declared controller joins acknowledged. Missing choices fail the profile; fewer actual participants cannot silently make it pass.
- Grant denial immediately clears the private view and stops its realtime refresh queue; own TimeData remains. Subsequent permitted explicit/periodic HTTP reads are separate from grant authorization.
- The normal local dispatcher remains single-flight on a30s cadence, with the current45s HTTP envelope and a consumed JSON body. This is an envelope, not proof that a complete batch fits; room-action2s thresholds are unchanged.
- Public metadata is fetched when each foreground room view opens. HTML/assets, cookie-auth shell bootstrap, unrelated routes and host-absence claim-capability timers are excluded. All hosts in this cohort retain their seats, including during the declared WebSocket-only fault; the host-absence timer therefore has no trigger in this scenario.
- Synthetic accounts have empty learning state and choose Work without linked activities. The actual learning-list request frequency is retained; large enrolled-course payload and linked-activity validation costs are not represented. This remains a room-view workload, not an all-platform forecast.
- Isolated helper tests cover cache independence, conditional reads, renewal, accepted-command/snapshot failure separation, held hint bursts, stale snapshot retry, round remount requests, personal deadlines, permission denial/disposal and operation identity. Representative browser tracing is recorded below; capacity remains a separate gate.

## Representative browser trace: passed

Executed on preview build86070 using real primary/secondary pages, cookie Auth, HTTP API and private SDK updates. The boundary setup alone used guarded synthetic Run aging; subsequent deadlines and the30s heartbeat/grant wait elapsed normally. This is functional request evidence, never sustained-load evidence.

- [Corrected sanitized trace](B5_UI_WORKLOAD_TRACE_5aef80b9-0023-4bd6-b846-7a87403244eb.json): passed; every request has a final status; guest explicitly left and owner closed the synthetic room.
- [Corrected browser result](B5_UI_WORKLOAD_BROWSER_CORRECTED.json):1/1 passed in1.9min.
- [First trace](B5_UI_WORKLOAD_TRACE_a68e2c08-f066-437f-9706-3dcde82f7d5a.json) and [first browser result](B5_UI_WORKLOAD_BROWSER_FIRST.json) remain preserved. Its functional assertions passed, but next-round counts included hydration traffic and two cleanup requests were still pending when recorded. The corrected run waits for the rendered break/connected state before measuring next round, and settles cleanup before saving.

| Measured trigger | Primary requests | Secondary requests |
| --- | --- | --- |
| Run starts | me1, snapshot1, learning1 | me1, snapshot1, learning1 |
| Explicit JoinRound | POST JoinRound1, compact time1, snapshot2, post-hint me1; no preparatory time/me GET | me1, compact time1, snapshot1 |
| Ordinary30s heartbeat/poll | POST renewPresence1, snapshot1 | me1, snapshot1 |
| Three real hints, first primary snapshot held | me2 + snapshot2, one trailing chain | me3 + snapshot3; unheld requests completed between hints |
| Personal focus deadline | compact time1, me1, snapshot1 | compact time1, me1, snapshot1 |
| Next round becomes available | me1, snapshot1, learning1; no automatic JoinRound | me1, snapshot1, learning1; no automatic JoinRound |

Neither tab sent a separate Time renew during live Room membership. Initial grant503 retried successfully after30012ms. A successful JoinRound followed by snapshot503 retained its accepted session, recovered through a fresh hint read, and emitted exactly one JoinRound command.

Final source checks:11/11 helper tests; scoped ESLint, TypeScript and runner syntax check passed. The helper and harness source received independent review, including denied-grant private-view clearing and required per-round participation coverage. The browser trace validates representative current request chains; it does not prove that100 observers meet latency or capacity requirements.


## V2 snapshot-first profile — representative browser verification

The approved bounded optimization is now represented in provider/helper source: known-live Realtime refreshes and ordinary live secondary polls read the authorized snapshot first, applying its embedded RoomMe. Bootstrap, foreground revalidation, expired/unknown membership, time-revision and phase-boundary paths retain their original reads; primary renewal still accepts its command response then reads the snapshot. Generation mismatch and denied access have bounded owner/scope/epoch-guarded membership reconciliation. A changed scope is handled by its new lifecycle, never followed from an old response.

Novel hint versions immediately fence older responses. Only an accepted private snapshot establishes coverage; `/me.room.hintVersion` alone does not. Duplicates/older hints do not cause another read or invalidate an in-flight replacement. An uncovered failed version retains one delayed retry, skipped if another accepted snapshot covers it. Raw delivered hints are still counted before client suppression.

The harness profile is labelled `current-ui-foreground-room-v2-snapshot-first`, preserving the v1 reports and all workload/SLO boundaries. On integrated build `cd96afe1ae85637e8803d033cc1b1bbb7245eac4bb68e17f28c0ee9ca12cbaa0`, DB030, the [revised browser trace test](B5_UI_WORKLOAD_BROWSER_SNAPSHOT_FIRST.json) passed in 113,565 ms. Its [sanitized109-request record](B5_UI_WORKLOAD_TRACE_3709938e-ff98-40b8-94c8-42ceb4c932c8.json) has 0 unresolved statuses and successful explicit member-leave/owner-close cleanup. Synthetic aging establishes functional boundary scenarios only; it is not used for load acceptance.

| Observed phase | Primary tab | Independent secondary tab |
|---|---|---|
| Host starts a run | snapshot1 + learning1; no me | snapshot1 + learning1; no me |
| Explicit JoinRound | POST1 + compact time1 + snapshot1; no pre-click time/me | snapshot1 + compact time1 |
| Normal 30s heartbeat | renewPresence1 + snapshot1 | snapshot1 only |
| Three novel hints while first primary snapshot is held | snapshot2, me0: one original and one trailing chain | snapshot3, me0: unheld reads completed between paced hints |
| Personal focus deadline | compact time1 + me1 + snapshot1 | compact time1 + me1 + snapshot1 |
| Next round available | me1 + snapshot1 + learning1; no automatic JoinRound | me1 + snapshot1 + learning1; no automatic JoinRound |

The trace intentionally injects two failures: initial grant503 recovers after 30,010 ms; an acknowledged JoinRound followed by snapshot503 retains its accepted session and emits only one JoinRound. Cleanup produces two legitimate snapshot403 responses after membership withdrawal, followed by each tab's own membership/time reconciliation. All other 105 requests return200. These statuses remain in the artifact, not erased or labelled capacity success.

The separate [26-journey acceptance index](B5_BROWSER_SNAPSHOT_FIRST_ACCEPTANCE.json) includes real-broker duplicate/older delivery suppression, an uncovered-version retry despite duplicate delivery, controller mismatch with Realtime unavailable, and a held changed-generation response after account replacement. The initial25/26 run retains its unrelated Playwright datetime-format failure; a standalone native-input reproduction and exact affected-case rerun establish the test-only correction. No application source changed during browser verification.

Final scoped source evidence: 21/21 helper tests, TypeScript, scoped ESLint and syntax checks passed; provider/helper fences and the latest browser index/counts/hashes received independent review. The helper's ordinary steady workload does not recreate React takeover effects automatically; controller transition correctness is instead covered by the actual browser cases. Existing HTML/assets/cookie-bootstrap, large enrolled-course payload and host-absence-timer exclusions remain. The [v2 evidence manifest](B5_WORKLOAD_V2_ACCEPTANCE.json) fixes the tested source/report hashes. This validates the stated representative request profile; 100-observer latency, capacity and sustained-duration gates remain separate and open.
