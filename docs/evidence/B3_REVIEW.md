# B3 independent acceptance review

Reviewed 31 October 2026. Scope: partial work, remaining effort and recovery in the local Dima web application/API. **PASS for the bounded local B3 web gate. No unresolved material source, runtime or rendered finding remains in this review.**

## Architecture and scope

The existing pure domain transitions/planner, validated HTTP commands and authenticated server-only atomic commit are suitable B3 extension points. The owner/revision/idempotency transaction remains the write boundary. Shared UI uses the navigation adapter rather than Next routing directly; account identity changes invalidate private state while ordinary revalidation preserves mounted forms.

The user explicitly deferred all phone work and requested web stages B3–B7 in sequence. M0/Android is therefore outside this web gate, not a pending prerequisite and not a verified capability. The current client proof still renders B0; no native auth, transport, deep-link or device behavior is claimed. No deployed production, load, hosted CPU or Android acceptance is inferred from local tests.

Canonical acceptance sources: `IMPLEMENTATION_PLAN_AR.md`, `RECOVERY_AND_PROGRESS_SPEC_AR.md` sections 1–5 and `DELIVERY_AND_ACCEPTANCE_AR.md` RC01–13. The current light-only/persistent-workspace contract supersedes the earlier historical dark-mode record.

## Reviewed decisions and invariants

- WorkEvent effort, remaining workload, completed units and timer hours are separate. Unknown effort/remaining remains unknown; it is never silently zero or the original estimate. B3 creates no tracked timer hours.
- Worked on may record actual work before a prerequisite finishes. Scheduling and Complete still enforce prerequisites.
- Each completion has its own event ID and a stable first-credit claim. Undo mistake invalidates only the current completion event; Reopen keeps work and reviews remaining. Legacy active B2 completion normalizes deterministically once; absent undone history is not invented.
- Remaining includes unfinished pins. Pin reservations and accepted work consume capacity once. Completion pin coverage is a reservation checkpoint, not extra effort. Used pin identities cannot transfer between tasks.
- Apply validates owner, revision, profile context, local day, expiry and planner policy. Lost-response retries keep command identity; changed bodies cannot reuse it.
- Recovery Undo creates a new proposal from current progress; it cannot restore old completion or work snapshots. Missed-study history survives Apply, with rest/pause excluded and recent recurrence distinguished from old misses.
- An explicit valid all-paused/control-only Apply is permitted with excluded work visible and no conflicts/unresolved backlog. Zero allocation with unresolved work remains draft-only. This resolved control boundary is recorded by the integrating owner.

## RC acceptance matrix

**RC01–RC13 pass within the reviewed local scope.** Assertions and source paths were independently inspected; final API/browser JSON reports were also inspected. The integrating owner ran the unit/static/build gates. The matrix combines domain, transaction and browser evidence where applicable; it does not claim every possible input combination or production behavior was exercised.

| ID | Reviewed acceptance and evidence |
|---|---|
| RC01 | Unit conservation after two missed days; browser return journey offers Start small/rest/recovery without deleting work or inventing completion. Compact historical misses survive later Apply. |
| RC02 | Exact unit arithmetic: 150 remaining across two 60-minute days gives 102 available/48 deficit, or 120/30 with explicit buffer. Preview retains target and separately shows later forecast. |
| RC03 | Unit rest-day zero-capacity row, dated pauses/resume and no false miss/effort; browser rest and valid all-paused Apply/Undo. |
| RC04 | Unit/API partial40 plus unknown remaining creates one work event and no fresh120 schedule; explicit effort/remaining dialog and saved draft verified in browser. |
| RC05 | Unit remaining100 includes pin45 exactly once, leaving flexible55. Added fulfillment, unknown-work resolution, reopen, changed pin quantity and Undo checkpoint regressions. |
| RC06 | Exact unit 180−27−40−45=68 flexible. Planner input is accepted work ledger, with no B4 timer deduction. |
| RC07 | Unit stale preview; API revision/identity/idempotency rejection; browser cross-device stale handling and preserved 40/80 partial draft. Existing lost-response journey retained. |
| RC08 | Domain/API Undo creates a fresh proposal over current progress; browser newer completion/work remains intact until an explicitly applied proposal. |
| RC09 | Domain unknown estimate, expired target/horizon and dependency validation; API command validation; visible reasons/backlog and unknown forecast. Finished courses have Complete status without invented lateness. |
| RC10 | Fixed-time domain midnight/timezone/DST cases retain UTC/original day context; API profile change invalidates preview and conserves effort. No timer or additional first-credit claim is created. |
| RC11 | Domain/API guards require partial acknowledgement, reject conflicts and keep zero-feasible drafts unapplied. Browser partial, pause-all, conflicting pin and zero-work draft journeys. |
| RC12 | Unit/API/browser work ledger: 40 partial +80 completion =120, Undo removes only80. Reopen keeps work; later completions get distinct events and the same first-credit claim. |
| RC13 | Unit/API unknown accepted effort prevents current-day allocation until explicitly resolved; future days remain possible. Baseline consumes no day capacity or hours. Unknown-resolution control is exercised in browser. |

Source/test anchors: `packages/contracts/src/learning.ts`, `packages/domain/src/learning.ts`, `packages/domain/src/recovery.ts`, `packages/domain/src/planner.ts`, `apps/web/src/server/learning.ts`, `packages/ui/src/learning.tsx`, `packages/ui/src/recovery.tsx`, `tests/unit/recovery.test.ts`, `tests/integration/recovery-api.mjs` and `tests/e2e/recovery.spec.ts`.

## Material findings resolved during review

1. **False completed-course lateness:** empty unfinished work previously produced today's forecast and a Late status. It now produces Complete with no fabricated forecast; regression added.
2. **Undo discarded later uncertainty:** withdrawing earlier work after completion made remaining unknown, but Undo restored the old80 snapshot. It now preserves current uncertainty; exact-sequence regression added.
3. **Pin reassignment and reopening:** reused IDs could transfer work across tasks, and kept completion work could resurrect old reservations. Validation now forbids identity transfer. Completion coverage checkpoints preserve fulfillment without double-counting earlier resolved/withdrawn work; Undo affects only its associated checkpoint.
4. **Recovery history and suggestions:** old historical misses could permanently force Long break, while Apply could lose recurrence history. Current overdue/recent recurrence/recent actual work are separated, compact history is retained, and zero-remaining Start small candidates are skipped.
5. **Draft and disclosure correctness:** buffer labels and explicit rest rows were corrected. A stale pin remains visible until explicitly resolved. Completion on another device no longer remounts and erases a 40/80 partial-work draft; the dialog preserves values, explains the change and disables stale submission.
6. **Measured performance:** repeated history projection/formatter construction cost over one second with 200 events. The unchanged-fixture rerun below verifies the bounded local fix.

## Measured local performance

Node v22.23.4; one synthetic 10,000-minute project, 60-minute daily ceiling, 15% reserve, target on start day, 91 calendar dates through target+90, Africa/Cairo and 200 historical events spread two per day. Summary fixture: 90 past day/task buckets. No account/API write; import time excluded.

| Probe | Before wall / CPU | After wall / CPU |
|---|---:|---:|
| Planner, no history | 3 / 4 ms | 12 / 7 ms |
| Planner, 200 events | 1,636 / 1,636 ms; repeat 1,110 / 1,094 ms | 54 / 26 ms |
| Recovery summary, 200 events | 1,161 / 1,165 ms | 4 / 4 ms |

Both versions produced the same 182 blocks/91 dates/outcome and 90 missed days. Observed process RSS fell from about 201–205 MB to 60–66 MB; these values include Node/module overhead. Source now projects the ledger once per planner call, groups summary effort once per day/task, and caches at most 32 timezone formatters. Unknown effort still dominates day-capacity uncertainty; original event provenance is unchanged.

The measured local issue is resolved. This is not a browser benchmark, hosted Workers CPU guarantee or load test. See [B3_PERFORMANCE_REVIEW.json](B3_PERFORMANCE_REVIEW.json) and the reusable read-only `scripts/probe-b3-planner.mjs`; reproduction commands are in both artifacts. Scratch files are not needed.

## Browser and rendered evidence

Independently inspected `B3_BROWSER_RESULTS.json`: **17 passed, zero failures/skips/flakes, 61.575 seconds**. This contains all 12 prior account/learning/performance journeys plus five B3 journeys. It covers light-only rendering under OS/saved dark settings, persistent navigation without extra document loads, focus revalidation retaining drafts, account expiry/switch isolation, existing B2 completion/retry/capacity behavior and B3 recovery/work flows. This full run preceded the final performance-only backend/schema-free-policy rebuild. The affected nine tests then passed on the final build: all five B3 journeys and four continuity/performance journeys, zero failures/skips/flakes, 23.396 seconds (`B3_FINAL_BROWSER_RESULTS.json`). The other eight remain valid because their behavior/source was unchanged by the final performance/dependency patch.

Independently viewed these actual `.impeccable/review/` captures: `b3-recovery-desktop.png`, `b3-recovery-mobile.png`, `b3-return-desktop.png`, `b3-return-mobile.png`, `b3-work-desktop.png`, `b3-work-small.png`, `b3-return-rest-preview-mobile.png`, `b3-zero-work-draft-mobile.png`, and `b3-draft-retained-mobile.png`. No material layout defect was found in these views. The fixed mobile navigation appears at the original viewport bottom in full-page captures; this is not permanent content overlap. The retained-draft dialog scrolls internally and its Cancel action passed the browser journey. This is bounded visual/interaction review, not a full assistive-technology audit.

## Final integration evidence

- Integrating owner confirmed **68 unit tests across seven files**, typecheck, lint and the final Workers build passed. The reviewed recovery file contains the RC01–13 assertions plus regressions for the findings above.
- Independently inspected final API JSON: `B3_RECOVERY_API_RESULTS.json` has **15 passed** checks; `B2_LEARNING_API_RESULTS.json` has **18 passed** checks, both executed after the final build. They cover ledger normalization, ownership, revision/idempotency, stale policy/profile, pin/reopen accounting and preserved B2 behavior.
- Independently inspected full **17/17** and final affected **9/9** browser reports, with no skipped/flaky/unexpected outcomes.
- The bundle dependency finding is resolved: `@dima/contracts/policy` exports the constant without runtime schema imports. Inspected `B3_BUNDLE_RESULTS.json`: auth/onboarding route client chunks fell from 222,462 to 120,234 raw bytes, and app chunks from 224,361 to 122,133. These totals exclude framework bootstrap, CSS, fonts and compression; they are not total page-transfer bytes.
- The durable probe also ran successfully against freshly bundled final source: 200-event planner **22 ms wall/22 ms CPU**, summary **3 ms wall/4 ms CPU**, with unchanged 182 blocks/91 dates/90 misses. This extra reproduction is stored separately in the JSON to preserve the initial before/after comparison.

**Decision:** B3 can close and the next authorized web stage can begin. This is local web acceptance based on reviewed source, synthetic accounts, actual local backend/browser execution and bounded visual/performance evidence. Remote deployment, real-user load, hosted CPU/latency and Android remain unverified and are not represented as passed. The integrator's repository-wide secret/preservation check is a separate delivery check, not a result claimed by this review.
