# B3 recovery and partial-work surfaces

Mode: **Operate**. Extend the established white-only Dima workspace, using its paper surfaces, cobalt actions, warm orange accents, Manrope type, shared native controls and persistent navigation. Approved landing and logo remain intact.

## Purpose and hierarchy

A returning learner can understand what is saved, record actual partial work, and explicitly choose a feasible revised plan. The interface distinguishes completion, accepted planning effort, remaining work and timer hours.

- Today retains the useful next activity. One calm return prompt explains missed study days, offers **Start small** and links to **Review recovery**. Rest and pause are not missed days. Start small refers to a real ready activity and proposes at most 15 minutes; it never starts a timer or completes the activity.
- The task interaction separates **Worked on**, **Mark complete**, and resolving unknown work. Partial work has two independent inputs: accepted effort and confirmed remaining work. Unknown is an explicit state. Completion proposes only the remaining work. Undo mistake retracts completion-derived work only; Reopen keeps recorded work and asks what remains.
- `/app/plan/recovery` starts with preserved progress and the current plan, then editable assumptions: shared weekly capacity, dated exceptions/rest, explicit buffer use, per-course target/priority/pause, and pinned task blocks. Edits generate a preview; they do not apply themselves.
- Preview places current/proposed values side by side on desktop and in reading order on mobile. It names the target and estimated finish separately, shows moved activities and changed day loads, explains reasons and keeps unscheduled/paused work visible. Conflicting pins block application. Partial application requires explicit acknowledgment. No schedulable work with unresolved backlog remains a draft; a valid pause-only proposal can explicitly Apply pause while keeping excluded work visible.
- Undo recovery creates a new proposal against current progress. It never replays old completion history.

## Interaction and safety

All changes use the existing owner-scoped API, operation identities and conflict handling. Transport failures preserve entries. Stale previews cannot apply. Account changes discard private view/cache; ordinary focus refresh retains the workspace and local forms. Successful redirects use the shared client navigation adapter.

Native labels, keyboard controls, focus restoration, 44px targets, readable errors, meaningful empty states and reduced-motion behavior remain required. No drag-only controls. Detailed schedules begin compactly and remain fully available on demand.

## Component decision

21st metadata search reviewed Calendar Planner (8201), Habit Tracker Calendar (25158) and Meeting Booking Calendar (38035). Existing agenda, form, disclosure and dialog primitives fit the workload model better than importing time-slot booking or streak semantics. No third-party code retrieved, dependency added or paid generation used.

## Verification boundary

Verified with synthetic accounts against the real local API on 2026-10-31:

- Full browser suite: 17 passed, no skipped/flaky/unexpected results. Report: `docs/evidence/B3_BROWSER_RESULTS.json`.
- Final affected rerun after planner performance optimization and pure policy import: 9 passed (B3 recovery + persistent-navigation/performance), no skipped/flaky/unexpected results. Report: `docs/evidence/B3_FINAL_BROWSER_RESULTS.json`.
- Actual browser checks cover separate partial effort/unknown remaining, 40 + 80 accounting, completion correction versus Reopen, committed-response-loss retry, explicit pin fulfillment, preserved conflicting inputs, partial acknowledgment, pause-only Apply, recovery Undo using newer progress, visible zero-capacity rest day, and retained 40/80 draft after a second device completes the task.
- Captures under `.impeccable/review/b3-*.png` cover 320/375/768/1280 widths, readable dialogs and recovery comparisons, and reduced-motion preference. Final rest-day capture expands the changed daily workload disclosure.

Browser evidence is local web evidence, not deployment or Android-device proof. Initial failures were test synchronization/selector issues, retained separately in `docs/evidence/B3_BROWSER_RESULTS_INITIAL.json`; assertions were corrected without weakening functional behavior.
