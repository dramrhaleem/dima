# B4 independent acceptance review

Reviewed 31 October 2026. **PASS for the bounded local web B4 gate. No unresolved material finding remains within this review.** B5 may proceed through its own design and acceptance gate. This is not production deployment, hosted capacity, complete product acceptance or native/Android proof. Phone work is explicitly deferred.

Scope: the central time ledger; Work, Open and Solo Pomodoro; pause/resume/finish/review; manual personal time; cross-device control; offline Stop; durable settlement jobs; and affected account/navigation behavior. The review used canonical specifications, source inspection, actual API/browser artifacts and rendered captures. The integrating and implementation owners ran the acceptance suites; this reviewer independently inspected evidence and verified the browser acceptance index against raw reports.

## Acceptance matrix

All statuses below mean local acceptance within the cited coverage, not exhaustive proof.

| Gate | Verified behavior and evidence | Status |
|---|---|---|
| AC02 | Work-only browser journey starts and finishes focus without a course; manual time remains separate. API assertions also verify no learning writes. | Pass |
| TM01 | Real API concurrent starts commit one active account session; identical operations replay. Browser navigation retains the same session. | Pass |
| TM02 | Solo settles at its persisted boundary despite delayed execution; pause/resume preserves remaining focus. Browser summary separates the break and requires explicit next-round setup. | Pass |
| TM03 | Open continuous-period cap becomes NeedsReview; new start is blocked until resolution. API covers capped late intent and browser covers review. | Pass |
| TM04 | Committed Finish with a lost response reloads and replays its original receipt without duplicate time or unnecessary personal conversion. API also tests reconciliation/original-request races. | Pass |
| TM05 | Offline reconciliation affects only its referenced interval, preserves earlier valid time and cannot alter a newer controller's work. Browser tests aged offline lease, reload, signout, another account and eventual personal sync. | Pass |
| TM06 | Explicit takeover preserves the existing cutoff and rejects stale control. API covers old-control/cap cases; browser covers two tabs. | Pass |
| TM07 | Manual overlap is rejected explicitly, adjacent ranges remain valid, and personal provenance is shown. Browser exercises manual entry/conflict; local-time unit cases reject nonexistent times. | Pass |
| OP01 | API checks lease recovery, duplicate/stale claimants, old deadlines, bounded retries, terminal failure/operator retry and protected dispatch. The integrating owner also reports successful local jobs:once execution. | Pass |
| AC03/AC04, B4 scope | API ownership/RPC/RLS/FK checks and browser account-switch/outbox isolation pass. Retained A intents are not shown or replayed as B. This does not close future public-room/moderation requirements. | Pass |
| UX regression | Prior 17 account, learning, recovery and performance journeys remain valid; eight B4 journeys cover the new controls. Light-only navigation, mounted shell and preserved drafts remain covered. Responsive captures have no material observed layout issue. | Pass |
| Separation | Timer writes do not create learning completions, claims or B3 WorkEvents. Linked-session browser flow offers explicit separate outcome actions; API verifies unchanged learning state. | Pass |

Canonical sources: `IMPLEMENTATION_PLAN_AR.md` B4; `DELIVERY_AND_ACCEPTANCE_AR.md` TM01–TM07, OP01 and progressive AC02–AC04; `ARCHITECTURE_AND_DATA_AR.md` sections 3–7 and 10; `ROOMS_AND_FOCUS_SPEC_AR.md` sections 1–2 and 7; and `RECOVERY_AND_PROGRESS_SPEC_AR.md` time eligibility.

## Architecture findings

The implementation uses one normalized TimeSession/TimeInterval/TimeCorrection ledger. Account-first serialization, one active session, one open interval, and GiST exclusion of overlapping accepted/personal ranges protect the write boundary. Device identity controls a session but does not authenticate its owner. Composite owner/session/interval foreign keys and explicit direct-write revokes supplement server authorization.

The server stores authoritative timestamps and deadlines. Takeover partitions an interval without resetting its cap; an explicit Open Pause/Resume starts a new continuous period. Solo resumes only its remaining duration. A delayed or stale job cannot extend or close a different interval. Active, paused and review periods remain pending; eligible totals require finalization.

Atomic offline reconciliation checks the original receipt under the account lock before applying a correction. When no accepted original exists, it corrects only the referenced interval and stores an original-operation tombstone in the same transaction. A late original request cannot restore eligibility. Receipt metadata remains immutable. A stop at or after an already stored Solo boundary does not falsely shorten that interval.

IndexedDB intents are owner-scoped and stored before network when available. The UI distinguishes durable pending work from a volatile fallback, offers explicit signout handling, and guards both late responses and requests delayed by storage waits. Manual entries disclose their input timezone, remain personal, and reject overlaps rather than silently clipping them.

Job claiming commits leases separately; execution locks account before job. User commands do not mutate old jobs. Durable user commands retain receipts; the approved renewal exception keeps bounded latest-renewal metadata rather than adding permanent heartbeat receipts, account revisions or invalidations every 30 seconds. Timer duration remains independent of learning progress and planning effort.

Reviewed source: contracts/domain time modules; Focus, outbox, local-time and account integration; server time adapter; both time-ledger migrations; time/local-time units; time API integration cases; and Focus browser cases. The compact migration was independently compared function-by-function with the original before application.

## Material findings resolved before acceptance

- Late offline intent after the Open cap now resolves only the correct capped interval. Same-control and latest-interval guards prevent an older intent from finishing newer work or bypassing review.
- Composite ownership foreign keys, same-owner previous-round linkage and direct-write revokes close storage-integrity gaps.
- Requests awaiting local storage now check liveness before fetch. Transient failures retain operation identity; retained renewals no longer suppress their own retry.
- The last-known controlling tab can save an offline Stop after lease expiry. Pending display freezes only the matching stopped interval, labels it as awaiting sync, and does not freeze a newer interval or mutate the ledger.
- Manual maximum uses projected server time. Local datetime parsing rejects invalid calendar/DST input instead of silently normalizing it. Open focus after Solo sends a fresh-session payload.
- Detail view uses fresh renewal metadata even when account revision is unchanged. Volatile-to-durable outbox recovery removes both storage copies correctly. Filtered history empty states reflect visible rows.
- Compact responses retain the affected command/receipt session. When an automatic completion is omitted because a newer manual session exists, a bounded owner-guarded lookup retrieves the previous active session without replacing the route or draft.
- Explicit linked-activity setup waits for that activity before enabling Start. This was a real failure exposed by the initial browser run and fixed before the final affected run.
- Responsive strip/navigation breakpoints agree. Pending copy clearly separates a local stop from server confirmation.

The earlier main-timer/strip clock contradiction was traced to installing Playwright's clock after native timers had started. Installing it before page load removed the artifact without an app change; final Work/Pomodoro tests assert clock agreement and matching control state. The superseded capture is not acceptance evidence.

## Execution evidence and its limits

- `B4_TIME_API_RESULTS.json`: **24/24 passed**, including concurrent starts, receipt/reconciliation races, caps, takeover, owner/FK boundaries, overlap, jobs and compact affected-session behavior. Inherited API reports contain **B2 18/18** and **B3 15/15** passes.
- `B4_BROWSER_ACCEPTANCE.json`: **25 distinct accepted cases: 17 previous regressions + 8 B4 cases**. This reviewer independently verified all three raw-report SHA-256 hashes and that every accepted title maps to an actual passed result. **This is composite evidence, not one fresh 25/25 run.**
- Preserved runs: initial full25 = 20 passed/5 failed; affected8 = 7 passed/1 failed; final targeted Work/Pomodoro2 = 2 passed. The index records why valid earlier regressions were reused, the real setup fix, harness corrections, and semantic timestamp comparison. No failures were erased or relabeled as passing.
- The integrating owner reports **82 unit tests across nine files passed**, plus **three separate local-runtime process/foreign-runtime tests passed**, general/scoped lint and typecheck passed, and final Workers build **71168** passed. The three script tests were separate execution, not claimed as a single combined 85-test run. Local script safety review belongs to the integrating/backend owners.
- All browser/API users were synthetic and local. Cap/deadline and interruption cases use controlled or accelerated time/state; they are not four-hour production observations. No actual Android gate was executed.

## Rendered review

Independently inspected the current captures below in `.impeccable/review/`:

- `b4-setup-desktop.png`: clear Work/Learning choice, mode/preset, private title and explicit Start.
- `b4-takeover-desktop.png`: explicit cross-device control state.
- `b4-active-small.png` (320 px) and `b4-active-tablet.png` (768 px): agreeing clocks and controls; strip above navigation; no observed horizontal overflow.
- `b4-pending-mobile.png` (375 px): local stopped time and pending sync are distinct; no misleading expired-control action for that intent.
- `b4-summary-desktop.png` and `b4-summary-mobile.png`: saved focus, uncredited break, explicit next round and interval provenance remain readable.

No material rendered issue remains in these captures. Full-page captures place fixed navigation at the original viewport boundary; that artifact alone is not a persistent overlap defect. This bounded visual review does not claim a full assistive-technology audit.

## Resource measurements and B7 follow-ups

The same 31-session/one-interval-each fixture changed renewal payload from **28,904 to 1,850 raw bytes**; compact control GET is **2,533 bytes**. Explicit history remains **28,623 bytes**. Source artifacts are `B4_TIME_PAYLOAD_PROBE.json` and `B4_TIME_PAYLOAD_PROBE_AFTER.json`. The optimization changes internal snapshot defaults and explicit affected-session selection, preserving totals and requested history/detail behavior.

These are fixture measurements, not payload upper bounds or hosted-cost guarantees. The integrating owner has explicitly retained a **100-interval pause-heavy active session** resource case for B7. Final `B4_BUNDLE_RESULTS.json` measures auth/onboarding **166,164 bytes** and app **168,063 bytes** of route client chunks, **45,930 bytes more than B3**. These raw route figures exclude shared bootstrap, fonts, CSS and compression; there is no bundle-size improvement claim. Route splitting, hosted request/CPU budgets and full-product loading remain B7 work.

The B4 gate can close on the evidence above. Production hosting, later rooms/rankings, the final whole-product audit and deferred native work retain their own acceptance boundaries.
