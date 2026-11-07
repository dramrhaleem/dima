# B4 — solo focus and time activity

Mode: **Operate**. Extend the approved light-only workspace with native controls, Manrope tabular numerals, paper surfaces and restrained cobalt actions. Preserve the landing, logo, navigation continuity and reduced-motion preference.

## User path and composition

- Today’s Work-only entry opens Focus without requiring a course. Task and Today links carry private learning context to setup, never automatically start time.
- `/app/focus`: Work/Learning, optional private title/activity, Pomodoro/Open choice, supported preset or explicit custom settings, then Start. The desktop setup has a compact rhythm explanation; mobile keeps the operative controls first.
- An active session replaces setup. A clear clock, status and explicit Pause/Resume/Finish controls share one server snapshot. Control transfer is explicit, including another tab. Known boundaries cap the display; background return resynchronizes with HTTP. No subsequent round starts automatically.
- The persistent session strip stays across internal routes. A round ending elsewhere produces a dismissible saved-summary link without changing the current route or draft; a bounded detail read resolves summaries omitted from compact control snapshots. Mobile reserves space above bottom navigation; the strip is absent before a real session or pending stop exists.
- `/app/progress/activity/:sessionId`: real interval source and eligibility, saved duration, corrections, optional break, and separate task outcome links. A timer never writes completion or planning effort. Reaching a Pomodoro boundary leads to a summary; an open timer’s cap requires review.
- `/app/progress/activity`: source-labelled time history, category query and cursor navigation, separate server totals, and personal manual time. Manual/correction forms explicitly use the browser timezone, while history uses the account timezone. Overlap failures preserve form input. Nonexistent local times at a daylight-saving jump are rejected rather than silently shifted.

## Ownership and offline intent

A keyed account provider owns private memory, requests and the clock anchor. It aborts on unmount, rejects late responses and includes the account precondition in requests. Same-account background refresh does not remount forms or the workspace. Shared components use the generic navigation adapter, with no Next.js import.

IndexedDB stop rows are scoped by account and persistent browser device; the control identity is per tab. Rows preserve the exact original operation and target interval plus an anchored reported stop instant. A stop intent is saved before the network request. Original receipts are checked first; an absent receipt leads to explicit personal-sync review. The backend atomically rechecks that receipt before applying the personal correction and prevents a delayed original command from adding the offline gap.

Pending intents block new starts locally. A matching open interval holds its local display at the reported stop and clearly says it is waiting to sync; a newer interval is never frozen by an older request. Another account neither displays nor replays them. Sign-out exposes pending requests with receipt checking, export, return-to-session and preserve-on-device choices; explicit local deletion explains that it does not alter the server session. If storage fails, the UI states that the intent is held in memory only, keeps online Finish possible, and never claims durable saving. Start/Resume are disabled offline. A last-known controlling tab can record an offline stop after its lease expires; that intent does not renew server control.

## Component choice

21st metadata search reviewed Countdown Timer 6070 and 38214, plus modal17825. Drag-to-set duration, automatic sound and independent local countdown semantics did not fit Dima’s ledger. Existing labels, inputs, buttons, native dialog and disclosure patterns were reused. No paid retrieval/generation or new dependency was added.

## Verification boundary

Source typecheck and scoped lint pass. Browser acceptance covers **25 distinct local journeys across retained runs**: 17 prior-stage regressions plus all 8 B4 cases. The [acceptance index](../evidence/B4_BROWSER_ACCEPTANCE.json) maps every case to its latest passing raw report; it does not claim a single all-green run. Initial failures and the timestamp-format harness correction remain visible in their original reports.

B4 cases verify Work-only setup, persistent navigation, paused/background behavior, real manual-time separation and overlap handling, automatic Pomodoro boundaries with an independent break, no automatic next round, second-tab control transfer, committed-stop response loss, durable offline stop across account switch, IndexedDB failure, open-cap review, and separate task outcomes. Pending display remains fixed for a full clock tick. Main and strip clocks agree within one display tick, and tablet strip geometry stays above navigation. Browser clock instrumentation is installed before app timers.

Eight captures under `.impeccable/review/b4-*.png` were inspected at 320, 375, 768 and 1280 widths. Final active captures replace the earlier clock-instrumentation skew. These checks establish synthetic local behavior and responsive browser layout; they are not production deployment, real offline boot, or physical-device evidence.

## Focus refinement — 2026-11-01

The setup keeps 25/5 as its default and adds a supported 15/3 small-start preset beside 50/10 and custom settings. Timer choices explain countdown versus count-up; the desktop rhythm preview describes the selected round, break and explicit next-round choice instead of decorative bars. Session title and activity remain optional. Repeating a saved round restores its matching preset; genuinely custom settings remain editable.

The active workspace gives the authoritative clock a bounded, quiet stage with tabular numerals and a factual progress line for solo rounds only. Pause is the primary running action, Resume the primary paused action, and Finish stays available as a secondary action. The pending stop, offline, control-transfer and review states retain their existing guards. Room timing and the provider are unchanged. Break controls are grouped with the next-round link and a Done for now exit to Today; no new focus session starts without Start.

Two bounded local browser regressions in `tests/e2e/focus-refinement.spec.ts` cover supported preset persistence, primary controls, pause/finish, optional rest, explicit next-round start, custom validation and the saved boundary. Captures target desktop and narrow layouts. Source checks and browser run evidence must be reported separately; this entry does not claim hosted verification.

## Session sound refinement — 2026-11-01

Sound is optional and subordinate to starting, pausing and finishing. A collapsed, labelled sound control follows primary actions. Enable/Test is the explicit browser gesture, Mute stops active audio, and saved-on preferences may need reactivation on a new page. A gentle synthesized chime announces confirmed natural solo completion, an observed break deadline or a new accepted room phase. Initial history reads, manual early finishes, stale transitions and repeated event keys are silent. Audio does not mutate timer or completion state. Background/closed-tab delivery is not guaranteed. Root release evidence records integrated checks separately from the module's unit tests.
