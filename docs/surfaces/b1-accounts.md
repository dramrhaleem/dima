# B1 accounts and workspace

Mode: **Operate** for account and member screens; **Persuade** remains the mode of the preserved landing. Implemented locally, 31 October 2026. This brief describes the UI that exists, not the complete learning platform or a deployed service.

## Routes and jobs

| Route | Implemented purpose |
|---|---|
| `/` | Approved landing adapted to the app by the root implementation; primary actions lead to sign-in and the public library destination |
| `/auth` | Email-code sign-in/sign-up, resend and change-email controls; Google is shown according to the server capability flag |
| `/auth/callback` | Server callback endpoint; provider success, cancellation and verification belong to the auth contract |
| `/onboarding` | Display name, confirmed timezone and starting view; explicit Save draft for later and Continue actions |
| `/app` | Redirect to `/app/today` |
| `/app/today` | Personalized initial workspace and saved preferences; work-only users need no course |
| `/app/settings` | Name, timezone, starting view, appearance and reduced-motion preferences; real account persistence |
| `/app/more` | Mobile-friendly access to Progress, Library, Contributions, Settings, Help and sign-out |
| `/app/plan`, `/app/courses`, `/app/focus`, `/app/progress`, `/app/library`, `/app/rooms/:id` and other later destinations | Explicit availability notices in the shared shell; no fabricated courses, statistics, sessions or room membership |
| `/library` and its nested paths | Public preview destination prepared by the root implementation; no claim that the course catalog is complete |
| `/privacy`, `/terms` | Preview information prepared by the root implementation; not a substitute for launch-ready operating policies |
| `/dev/foundation` | The separate B0 technical proof; it no longer occupies the public landing route |

Safe internal destinations and their query strings survive email authentication and onboarding. Visiting a future room destination preserves the requested address but does not join a room or reveal members. An unauthenticated workspace loads no private account content before the session and account identity checks finish.

## Composition and visual authority

Implementation is the shared React `AccountApp` in `packages/ui/src/account.tsx`, styled by `packages/ui/src/account.css`; Next pages are thin wrappers. The package uses the existing Dima paper, ink, cobalt, orange, semantic colors, fonts and supplied SVG wordmark. The landing source remains preserved under `assets/reference-ui`; its deployable adaptation is generated separately.

Sign-in uses an explanatory left column and a bounded form on desktop, stacking into a compact reading order on mobile. Its small static ascending path refers to the existing brand idea without redrawing the logo. Onboarding pairs three clear setup decisions with the actual form. The member workspace uses a persistent desktop sidebar and the agreed Today / Plan / Focus / Courses / More mobile navigation. Settings stays task-focused; Today prioritizes a useful account action and explains which learning/work capabilities are still unavailable.

There are no sample hours, progress percentages or rankings presented as a user's real activity. Future-feature notices are distinct from loading errors and from a genuine empty collection. No timer starts from a link, and no course setup is forced on work-only users.

## Implemented states and boundaries

| Situation | Response |
|---|---|
| Opening or revalidating a session | Private content stays hidden while identity is checked; connection failure offers retry |
| Email code requested | Code-entry form, explicit delivery wording, resend cooldown and change email |
| Invalid/expired code, unavailable provider or failed request | Recoverable message; no success or delivery claim from a failed response |
| Google not configured | Disabled provider button and an explanation pointing to email |
| Onboarding draft saved | Server-confirmed saved message; reload resumes the saved name, timezone and intent |
| Unsaved form | In-memory, scoped to its account; no promise of persistence after closing the page |
| Saving | Busy controls; success appears only after the API response |
| Network failure while saving | The current form remains available for retry; identical retry retains its operation ID |
| Another device changed the profile | Conflict notice preserves the draft; Review latest version shows saved values, and Use latest saved settings explicitly replaces the unsaved form |
| Account changes or an old response arrives | Account identity checks, keyed forms and guarded updates prevent the old profile from being applied to the newly loaded account |
| Sign-out begins or fails | Private UI clears immediately; a locked view explains pending sign-out and offers retry, including retry when connectivity returns |
| Reload during pending sign-out | A non-secret local sign-out barrier prevents automatic reopening of the previous cookie session where browser storage is available |

The barrier contains no token, email or profile. Browser storage may be unavailable, so the failed-sign-out message explicitly asks the user to keep the page open and warns that the server session may still be active. Server revocation and cookie behavior are independently owned by the auth implementation.

## Motion, theme and access

Appearance and reduced-motion settings are saved account preferences and applied after successful saving. System appearance follows the device theme. Device reduced-motion preferences remain respected even when the account toggle is off. The dark theme preserves logo colors on the existing paper token; the artwork itself is unchanged.

Controls have associated labels, visible focus and disabled/busy feedback. Meaningful feedback uses status/alert semantics. Route entry focuses the workspace heading; keyboard navigation is available without a hidden shortcut. Narrow layouts preserve the reading order and reserve space for the fixed bottom navigation and safe area. These affordances and responsive checks are not a comprehensive accessibility-conformance claim.

## Evidence and remaining limits

`tests/e2e/accounts.spec.ts` covers real local OTP delivery and verification, resumable onboarding, exact deep-link return, work-only entry, persisted preferences, two-device revision conflict, account switching, a delayed real account-A write response after B loads, and failed sign-out followed by reload and retry. It also captures 1280/375/320px layouts and checks horizontal overflow. Screenshots are under `.impeccable/review/b1-*.png`.

The UI pass inspected the auth desktop and Today mobile captures; the final integrated build and remaining visual evidence are owned by the root delivery report. Google OAuth is wired and capability-controlled, but this document does not claim successful live Google authentication. Public SMTP, hosted operation, full accessibility, Android, learning plans, course tracking, focus sessions, rooms and rankings remain outside the evidence of these account screens.
