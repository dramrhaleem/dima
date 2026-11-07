# B2 learning surfaces

## Routes and transitions

- `/library` → `/library/:offeringId` → authentication with the selected offering retained → `/app/courses/add?offering=:id`.
- `/app/library` → reviewed outline → selected scope, estimates and explicit prior progress.
- `/app/courses/new` → save private draft → choose scope. Draft edits preserve the already-enrolled snapshot.
- `/app/plan/setup` → shared weekday capacity and individual targets → `/app/plan/previews/:id` → explicit Apply → `/app/today`.
- `/app/courses` → `/app/courses/:enrollmentId` → ordered outline, required progress, estimates, source, completion/undo.
- `/app/plan` → saved days, target versus forecast, completed marks and remaining unscheduled work.
- `/app/today` → Continue course → relevant module expanded in the full outline → provider lesson or activity details. Completion lives in the course outline; Today keeps a secondary linked focus action and course shortcuts, including before a plan is applied. A planned block never completes the whole activity automatically.
- Module completion affects only unfinished selected activities. The learner chooses new completion or previous learning. Undo removes only unchanged completions from that batch, preserving earlier progress; no focus hours are invented.
- My Courses → Create my own course → private draft → Request library publication → admin review → public library listing. Private progress is not published.
- Course → People → course leaderboard → overall shared-course percentage by default, weekly new progress optional, named ranked rows and own-row emphasis. Visibility choices remain respected.

## Interaction contract

Private views use the B1 account shell. Data and in-flight responses are scoped to the current account. Failed saves preserve the form; uncertain retries retain the operation identity. Conflicts ask the user to refresh saved state without silently replacing their entries. A stale preview cannot apply over newer work.

Public library preserves search in the URL. Program/course/module hierarchy remains visible; an accordion exposes source activities without rendering every activity expanded. Public-source grouping is explicitly distinguished from the provider's authenticated lesson order.

The current workspace is light-only, using the approved paper/cobalt/orange system. Legacy appearance preferences do not reactivate dark mode. Fixed mobile navigation, keyboard focus, semantic controls, modal completion confirmation and reduced motion remain part of the shared UI.

## Evidence boundaries

Screenshots in `.impeccable/review/b2-*.png` contain isolated synthetic learner data. They are functional UI captures, not the owner's progress. Scope/Today/Library/Preview are checked on responsive Chrome viewports; this is not an actual APK or iOS-device test. Source links and estimates were reviewed separately in [course audit](../research/B2_COURSE_AUDIT_AR.md).
