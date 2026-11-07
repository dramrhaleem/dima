# B6 — interface preparation

**Design only; B5 performance gate remains open.** This document proposes composition and interactions for implementation after that gate. It adds no code, API contract, deployment or claim that B6 services exist. The binding rules remain [integration notes](../B6_INTEGRATION_NOTES_AR.md), [screens](../SCREEN_SPEC_AR.md), [progress/sharing/publication](../RECOVERY_AND_PROGRESS_SPEC_AR.md), [architecture](../ARCHITECTURE_AND_DATA_AR.md) and [B6 plan](../IMPLEMENTATION_PLAN_AR.md#b6--التقدم-والمجتمع-والمحتوى-والإدارة).

## Existing foundation and proposed extensions

Keep the approved English, **light-only** workspace: paper surfaces, ink text, semantic cobalt actions, restrained orange accents, Manrope and the original Arabic wordmark. The current decision in `.21st/design.json` takes precedence over older Light/Dark wording in the screen/reference documents. No new logo, decorative dashboard background, component dependency or paid asset is needed for this preparation.

| Existing source | Reuse in B6; boundary |
|---|---|
| `account.tsx`, `navigation.tsx` and persistent workspace providers | Existing shell, route heading/focus, navigation adapter, account ownership and timer strip. Add destinations inside this shell; no remount on every tab/filter change. |
| `learning.tsx`: `Progress`, `Outline`, `CourseDetail`, preview/schedule presentation | Coverage breakdown, curriculum disclosure and source/version labels. **Current percentage counts tasks; it is not the canonical weighted B6 calculation.** Retain activity counts, but reconcile the weighted measure through the agreed contract and label it clearly. Do not reuse this helper for ranking. |
| `focus.tsx`: `ActivityHistory`, `SessionDetail`, `Dialog` | Reuse paginated history, source/correction explanation and modal behavior. Existing totals are account-wide, not period totals. History/detail are internal functions; extraction and period aggregation need agreed contracts. |
| `recovery.tsx`: comparison and workload presentation | Before/after denominator and forecast changes, unknown estimates, stale preview and explicit Apply. Version migration must use its own authorization and preview semantics. |
| `rooms.tsx`: `CourseRooms`, compact filters and consent patterns | Keep course rooms first in People; add independently opted-in peers below. Reuse the disclosure pattern, never room membership as progress consent. |
| `styles.css`, `theme.css`, existing account/learning/focus styles and approved brand SVGs | Panels, labels, notices, controls, spacing and focus treatment. Extract a shared primitive only where actual duplication warrants it. |

Today remains the action home. Progress becomes **Overview / Activity / Circle / Leaderboards**; existing Activity deep links remain valid. Course navigation becomes **Outline / Progress / People / Leaderboard**. Contributions, notifications and settings are separate destinations, not extra dashboard panels. Administrative navigation appears only for authorized roles.

## Progress: four meanings, four useful actions

Use one compact heading, period controls and a two-column grid where space permits; stack without horizontal scrolling on narrow screens. Each section has a plain metric label, its denominator/window, a short explanation and a relevant action. No combined score or decorative percentage ring that obscures the denominator.

| Section, in order | Content and primary action | Important states |
|---|---|---|
| **Course progress** | Selected course/version and personal scope; weighted required coverage plus completed/total activity counts; separate **Before Dima** and **Completed here**. **Continue course** opens the next usable task. | Optional work stays separate. Zero required denominator is **Not applicable**, not 100%. No mastery claim. No enrolled course is an optional **Browse courses** invitation; Work-only users can continue using time/rhythm without enrolling. |
| **Time recorded** | Learning and Work totals, Timer/Manual sources, active/pending amounts separate from accepted history; breaks separate. **View activity** retains the selected period. | Completion never creates hours. No sessions offers **Start focus** or personal manual entry. Explain eligibility without making personal manual time appear worthless. |
| **Weekly rhythm** | Meaningful active days against the chosen weekly goal; accessible day labels distinguish activity, planned rest and no activity. **Adjust weekly goal** shows when the revision takes effect. | Explain the current experimental threshold: a new nonbaseline learning completion or 10 recorded Learning minutes; Work requires 10 minutes. Shorter sessions remain visible. No mandatory streak, shame or fabricated improvement without a comparable period. |
| **Plan health** | Target, forecast, remaining workload, last calculation and provisional/review-needed state. **Review plan** opens the existing recovery preview. | Unknown remains unknown. A past target stays visible. Work-only users need no course plan. Goal/capacity changes never silently replan. |

The period selector applies where meaningful: time/rhythm use its window; course coverage is cumulative and explicitly labelled; plan health is the latest forecast. Do not suggest that all four measures describe the same interval. Comparison uses equal elapsed portions or completed weeks. Local study days and UTC competition windows have different labels.

Activity keeps existing source filters, pagination, session detail and pending-stop recovery. Add period selection and a visible explanation of any eligibility change; correcting one interval explains that interval's effect, not removal of all earlier session time. Partial card failure offers a scoped retry without replacing the whole workspace or losing a manual-entry draft.

## Circle, People and sharing previews

**Circle:** requests needing a response first, then a bounded list of accepted relationships and the summaries actually shared. Each row contains permitted identity, the available period/metrics and **Open summary**. No infinite feed, session count, room history or private task/course names. An accepted relationship with no grants says **No metrics shared**, never zero progress. No relationships offers **Find course peers**; receiving follow requests can be disabled.

**Course People:** show relevant rooms first, followed by peers who explicitly opted into that offering. Versions may study together; a peer's visible version/scope identifies their chosen progress without making it a rank. Joining the course, room or People list are separate actions. Private-course users get general topic rooms, with no publication of their private title.

**Follow journey:** permitted identity → **Request to follow** → Pending/Cancel → recipient's preview → Accept or Decline → shared summary. Acceptance is directional, never mutual. The recipient can accept without sharing metrics. Existing grants must be shown honestly: the preview cannot promise “nothing shared” when an AcceptedFollowers grant already applies.

Use one consistent audience-preview pattern for sharing settings, first acceptance, People and board opt-in:

1. Name the exact audience: **Internet**, **Accepted followers**, or **Members of this course**.
2. List the actual identity, selected fields, selected public courses and time windows that audience will see; show a viewer-shaped preview, with sensitive omissions stated briefly.
3. Explain the change before the explicit save/accept/participate action, including previous eligible periods exposed by late board opt-in.

The canonical grants are audience-based: changing AcceptedFollowers fields affects that audience, not just the person whose request is open. Do not label this as “only this person.” If existing grants apply, accepting without metrics would require an explicit audience-wide change; no per-person exception is implied. Internet profile is limited to alias/avatar/bio; public boards are separate. There is no public internet weekly-time/rhythm summary switch. CoursePeers may see only the selected course's permitted progress/stage.

Milestones require both a separate grant and explicit publication of a public-course achievement. **Share milestone** previews the specific item; completing a task never posts it automatically. “Nice work,” if included, has no points and only applies to an available shared milestone. Withdrawal/Undo removes the shared item and prevents further reactions.

Member summary shows only authorized fields and **Manage relationship**. Remove follower, withdraw request, revoke fields and Block have distinct explanations. Block reuses B5's bilateral policy; it cannot hide internet-public content from anonymous visitors or erase screenshots. Private/revoked/blocked destinations use **Unavailable** without a stale name/title or an explanation that reveals hidden relationships.

## Boards: comparable, optional and stable

Global Time ranking opens with **This week**, All/Learning/Work, UTC window and local end time, then personal participation state and real rows. Show finalized eligible time, ties and **Last updated**. A new result offers **Refresh results** before reordering; never move a row under the pointer. Public `/leaderboards` uses only authorized public projections, not a private account summary.

Course boards put **Offering · Version · Comparison scope · Metric** above rows. **This week** counts first new completion claims; **Overall** includes baseline coverage within the full required public scope. Explain the reviewed scoring rule and its limits in a disclosure. Personal scope percentage remains separately labelled; choosing a subset does not manufacture an easier board. Preview the full comparison denominator before joining, and do not merge unmatched versions.

States need useful explanations: **Not participating**, **No eligible activity**, **No comparable scope**, **No required denominator**, **Results pending**, or **Couldn’t refresh**. Preserve valid displayed order while a newer projection is pending, but known visibility revocation removes a row immediately. Undo/recomplete and equivalent version mapping retain the original claim/week; delayed sync distinguishes **Credited on** from the personal completion date. Leaving the board removes public participation without deleting personal history. Report goes through existing moderation, without accusing high-hour users of cheating.

## Contributions, version review and administration

**Private draft → publication preview → Submit for review → contribution detail.** Preview the exact curriculum-only snapshot: source, language, ordered outline, types/required flags, estimates/provenance and rights checklist. Private progress, plan and notes never appear. A duplicate suggestion links to the existing offering without merging automatically. The submitted snapshot stays fixed while the private draft remains editable and usable.

Contribution detail foregrounds status and the next action: Pending, Changes requested, Resubmitted, Approved or Rejected, with dated reasons and the reviewed revision. **Edit and resubmit** creates the next review snapshot. Approval and public availability are distinguishable; do not imply that an approved request is already published or enroll its author again.

**Available version → Review changes → optional Apply.** Put current/proposed version and required denominator side by side, then Added/Changed/Removed/Mapped and unresolved mappings, followed by coverage and forecast effects. Mobile uses labelled before/after rows. Unresolved or stale preview blocks Apply; Cancel retains the current enrollment. Publication is not migration, matching titles are not proof of equivalent work, and upgrading cannot create duplicate credit. Withdrawn sources show **Source unavailable** while retaining the user's existing progress.

Admin uses a compact queue/detail layout, not new analytics dashboards:

- **Reviews:** age/status → immutable curriculum and source checks → required decision reason → Approve/Request changes/Reject. No author plans or private progress.
- **Catalog:** version/status → publication/withdrawal impact → explicit permitted action. Explain that existing learners are not silently upgraded.
- **Reports:** minimum relevant reported material → permitted action/impact → audit result. Reporter identity and internal notes stay role-limited.
- **Operations:** actionable failures/capacity/jobs → bounded detail → permitted retry and resulting state. No secrets, arbitrary time edits or cosmetic “restore successful” claim.

Empty queues say **Nothing awaiting review**. Permission loss removes the restricted content/action, not merely disables a button. A changed revision requires a fresh review; retry never duplicates a decision.

## Notifications, export and deletion

Notifications prioritize decisions over informational updates. Opening or marking read never accepts a follow request or a version upgrade. Resolve the target's current authorization before rendering linked private text; revoked items become generic unavailable notifications. Preferences cover implemented in-app types and quiet behavior only; do not promise email/push or prompt browser permissions on first visit.

Settings groups Profile/Timezone, Motion, Notifications, Sharing/Blocked and Account. Public-profile editing includes audience preview. Timezone changes explain the effect on day grouping and route affected plans to review; historical dates are not silently rewritten. Keep the latest light-only decision, with reduced-motion preference available.

**Data → Request export → Processing → Ready → authorized download.** Show included own-data categories, provenance/versions, creation time and the actual expiry. Expired offers a new request; Failed offers retry with a useful reason. Exclude others' emails, sessions, private material and moderation internals. A private short-lived link is not an authorization bypass; never reuse another account's cached artifact.

**Delete account** is a separate deliberate flow, away from routine Save. First show the concrete effect on public visibility, owned data, active time, room seat/host role and any local pending stop; then reverify identity and confirm. Explain retention from the implemented policy, without inventing a deletion deadline. Pending/Done/Failed are authoritative states; a click or Auth sign-out is not proof of deletion. Write suspension, cutoff settlement, room/host cleanup, visibility removal and tombstone handling are backend dependencies. Do not erase a pending local intent without explaining its outcome; the exact treatment must be agreed before enabling deletion. Restore verification remains a B7 gate.

## Continuity, accessibility and implementation checks

- Preserve the account-keyed workspace, focus session/room presence and durable stop policy. B6 reads must not create a second timer, extra room socket or duplicate heartbeat. New social invalidation needs a defined permission contract and capacity budget, not an assumed realtime channel per card.
- Same-account quiet refresh keeps forms, scroll and selected filters. Meaningful filters/tab destinations belong in URLs. Late saves may update their owner's state but cannot redirect a form the user left. Failed saves retain inputs and operation identity; definitive conflicts request a new preview rather than overwriting.
- Cache private projections by owner, subject, scope/window and permission revision; never treat a cache as authorization. Account change clears private memory/listeners and rejects old responses. Revocation/Block clears affected fields and prevents a delayed response from restoring them. If a shared view's access cannot be revalidated, withhold its private fields and offer retry; keep unrelated own workspace/session state usable.
- Publishing, sharing, accepting follows, board participation and destructive actions require online validation. Do not advertise an offline queue for these actions. First load may use a skeleton; refresh retains authorized content without white-page flashes. Saved means server acknowledgement, and local-only/pending state is labelled accurately.
- Reuse one route `h1`, visible keyboard focus, native labels and the existing dialog focus return. Navigation stays links; actual tabs implement keyboard semantics. Touch targets remain at least 44px. Tables become labelled rows at narrow widths; filters collapse without losing selections. Reserve space for mobile navigation, keyboard and the existing session strip.
- Motion explains an acknowledged change, never manufactures activity: short existing transitions, reduced-motion support, no animated rank reshuffle, automatic celebration or per-second screen-reader announcements. Charts require equivalent text; color never carries status alone. Validate 320/375/768/1280 widths, 200% zoom and long names/titles.

Before B6 implementation, agree the weighted progress/lineage and projection contracts, audience previews and immediate revocation behavior, authoritative publication/mapping previews, export/deletion states and role permissions. None is supplied by this document as an invented endpoint or completed service.

Targeted acceptance must include: baseline/new and zero-denominator progress; equal scope/version comparisons; acceptance without grants and audience-wide changes; private course titles absent from every social surface; revoked data racing a late response; late opt-in/opt-out and corrected interval eligibility; immutable submission and ambiguous upgrade; owner-isolated export/notifications; deletion while member/host/owner with pending time. These refine the B6 screen work under AC05, SC01–SC05, LB01–LB04, CM01–CM02, OP03 and repeated AC03/AC04, without replacing the canonical gate.


## Observed implementation seams — B6 integration handoff

Read-only source review, 2026-11-01; **B5 remains open and B6 implementation has not started.** These observations preserve integration/audit work under the existing scope.

- **Command bytes are not aggregate bytes.** `packages/ui/src/learning.tsx` (`request`, lines 35–36) posts a `LearningCommand`; `apps/web/src/server/learning.ts` (lines 21–38) reads the whole workspace, caps the incoming command at **600,000 bytes**, then commits and returns the whole resulting state. Domain limits of 30 drafts, 20 enrollments and 1,500 tasks per outline do not establish an aggregate byte ceiling. Enrollment snapshots copy the offering. The current commit migration (`20261031211000_learning_commit.sql`, line 24) already stores compact result receipts; do not diagnose obsolete full-result receipt duplication.
- **Actionable draft recovery gap:** a structurally permitted large `saveDraft` can exceed the command byte limit. `readJson` returns `BODY_TOO_LARGE`/413, but the learning UI maps it to a generic retry message. During later integration, retain the draft, preflight the serialized command's UTF-8 size, and show an explicit size error while keeping the server authoritative. Repeating an unchanged oversized request cannot recover it. Do not raise the cap blindly. Separately prove aggregate RPC/response and complete immutable export capture against the largest supported account; a safe `TooLarge` rejection does not satisfy complete-export acceptance. Existing input/artifact capture and quota requirements remain in [B6 API/data §7](../B6_API_AND_DATA_AR.md).
- **Progress/ranking seam:** replace the local task-count `progress()`/bar in `learning.tsx` with the agreed domain weighted calculation for My Courses, Course Detail and Overview, retaining separate counts and withholding unsupported weighted percentages for unclassified required private kinds. Completion claims currently live inside enrollment state (`packages/domain/src/learning.ts`, line 105); cross-version lineage and atomic first-credit ownership must precede ranking projections. Preserve existing claim history; do not substitute personal percentage or estimated effort for public scores/hours.
- **Route/consent seam:** `FocusArea` currently sends every `progress` route to Activity History or Session Detail (`focus.tsx`, lines 604–611); introduce Overview without breaking Activity deep links or remounting persistent providers. Course People currently means `CourseRooms` (`rooms.tsx`, line 284). Add independently authorized peers alongside it; room visibility acknowledgement and enrollment are not sharing grants. The catalog is still seeded in `apps/web/src/server/catalog.ts`; publication/review requires the agreed authoritative version source before its controls are exposed.
- **Account lifecycle seam:** Settings currently supplies profile editing/sign-out (`account.tsx`, line 301), while `requestAuth` verifies the current Auth user (`server/auth.ts`, line 149), not a deletion lifecycle. Export/delete controls depend on the agreed recent-challenge proof, external ledger acknowledgements and lifecycle checks **inside write transactions under the Account lock**; an HTTP-only guard or sign-out does not enforce deletion. Preserve active Time/Room cutoff and pending-stop outcomes.

Smallest build order after B5 closes:

1. Establish the supported byte/capacity envelope and complete-export capture feasibility; make oversized draft recovery actionable.
2. Implement authoritative publication/lineage and shared weighted progress calculations.
3. Implement lifecycle, recent-verification proof and the agreed ledger/export/delete states.
4. Implement grants/cache invalidation and authorized aggregates/rankings.
5. Compose Overview/Activity/People/Settings in the existing shell, then run the canonical acceptance checks above.

Material evidence still required: measured aggregate/capture budgets, concrete challenge-bound recent-verification proof, and hosted ledger/restore verification. This note does not close those gates or change the existing permission-freshness contract.
