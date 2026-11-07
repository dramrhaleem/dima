# Content and UX operating rules

This document connects the visual system to the product behavior. Interface copy is English; course titles retain their source language. The Arabic logo remains unchanged in either LTR or RTL layouts.

## Voice

Clear, energetic, specific and forgiving. Name the next action. Recognize effort without promising mastery or making comparison compulsory. The name story can explain sustained effort quietly; operational screens should not turn every task into a religious quotation.

Use: “Your next step”, “Review your plan”, “Keep my daily load”, “Keep my target date”, “Saved on this device”, “You can continue from here”. Avoid: “You failed”, “Your streak is ruined”, “AI guarantees success”, “Verified productivity”, and “Synced” before a real acknowledgement.

## Three records that must stay distinct

1. **Completion:** a user records a course task as complete. This does not create elapsed hours.
2. **Schedule:** the future plan assigns tasks or work blocks to days. Recovery does not rewrite historical completions.
3. **Time:** a Work/Learning session records elapsed intervals. Paused time is excluded; a timer does not certify attention or learning.

Task order is not automatically a prerequisite graph. Long tasks can span blocks without being falsely marked complete. Work sessions are valid without a course. Do not force course enrollment or public ranking to use the app.

## Screen responsibilities

| Area | The user must see | The user must be able to do |
|---|---|---|
| Today | Next task, source, daily work, plan health, save state | Open source, explicitly start a session, record completion, undo |
| Plan | Week, rest/buffer days, target and forecast separately | Review capacity and a proposed revision |
| Recovery | What moves, what stays, target/load tradeoff | Accept a specific proposal or keep the existing plan |
| Courses | Ordered curriculum, required/optional scope, prior progress | Continue, add a private course, make a publication request |
| Library | Provider, source, course edition, public/private distinction | Inspect before joining; add privately when missing |
| Activity | Work/Learning, timer/manual, pause/save status | Finish/pause a session, add a labeled manual entry |
| Global board | Period, eligible timer-hours unit, Work/Learning filter | Opt in explicitly; inspect the counting rules |
| Course board | Same course/version and fixed progress-credit unit | Compare compatible scope without converting hours into mastery |
| Settings | Visibility, timezone, local/remote scope | Change preferences and understand what will be public |

## Recovery copy pattern

**Problem:** “Two planned tasks are unfinished.”

**Choice A:** “Keep my target date” + explicit additional work on selected days.

**Choice B:** “Keep my daily load” + explicit revised forecast date.

**Protection:** “Completed work stays unchanged.”

**Commit:** “Apply revised plan”. Previewing or leaving the screen must not mutate the accepted plan. A stale preview in the eventual multi-device app must be recomputed, never blindly applied.

## Save, error and offline language

| Actual condition | Accurate label | Recovery |
|---|---|---|
| Local prototype persistence | Saved on this device | Explain the demo scope |
| Request pending in a future real app | Saving… | Preserve the user's input |
| Server acknowledged | Saved | Show last update if useful |
| Device offline, queued locally | Saved locally · waiting to sync | Retry without duplicating work |
| Failed operation | Could not save this change | Retry; keep the input |
| Account session expired | Sign in again to sync | Preserve safe draft; isolate accounts |
| Empty course list | Add your first course | Join the library or create privately |

The prototype demonstrates selected states; these are implementation contracts for the future service, not evidence that cloud sync exists today.

## Ranking fairness and privacy

- Public participation begins off. Show a preview of the public fields before opt-in.
- Use a public display name; never expose email, private titles, targets or recovery notes on a board.
- Manual time can be useful history without automatically counting toward ranked timer hours.
- A timer board and a course-progress board must have distinct titles, units and rules.
- Prior progress may count toward total completion while not earning fabricated current-week activity.
- Do not label sample ranks as live or use confetti for every increment. Keep celebration proportional and reduced-motion friendly.

## Mobile and assistive use

Bottom navigation keeps Today, Plan, Courses and More stable. Secondary destinations remain available under More. The active timer must not cover primary actions or the software keyboard. Restore scroll/context after returning from an external course.

Use native input types, associated labels, visible focus, meaningful headings, and text beside status colors. Reordering needs buttons as well as drag. Dialogs should be reserved for focused decisions, return focus to the trigger, and never hide the only recovery route.

## Product implementation boundary

The identity package and local prototype do not replace the authoritative product rules in the adjacent `learning-planner-design-20261031/SYSTEM_SPEC.md`. Before production, implement real authentication, account isolation, authorization, immutable curriculum versions, cross-device state, offline reconciliation, timer overlap/cap rules, privacy enforcement, deletion/export and backup/restore; verify each independently from the appearance of these screens.
