# Dima dark appearance — implementation audit

Status: preparation only, 2 November 2026. Source inspection, not implemented or production-tested. No application file, preference, account, deployment, or live asset changed by this audit.

## What can be reused

The current app already uses semantic CSS variables for most learning, planning, focus, rooms and community UI. Keep the existing geometry, type scale, 100% viewport sizing, icons and interaction flows. `packages/ui/src/theme.css` holds historical disabled dark tokens; `assets/reference-ui/foundations/tokens.css` also contains an older dark palette. These are evidence of prior work, not the new design or an activation switch.

The account contract already accepts `system`, `light`, `dark`: `packages/contracts/src/account.ts:13`, `supabase/migrations/20261031190000_accounts.sql`. No database schema migration is evidently needed to support the preference. Current runtime deliberately ignores these historical values and forces light. Re-enable only under a separate implementation instruction.

## Future integration map

| Owner/source | Required change when authorized | Important detail |
|---|---|---|
| `packages/ui/src/theme.css` | Replace historical dark semantic assignments with the approved new mapping; add explicit overlay, disabled, danger-action, chart/track and elevation roles | Do not append another contradictory theme override layer. Keep brand artwork constants separate from UI links/actions. |
| `packages/ui/src/account.tsx:190–191` | Replace unconditional light assignment with shared preference resolution | Motion is independent; changing appearance must not reload/unmount the account, timer or room. |
| `packages/ui/src/account.tsx:240–279` | Restore appearance draft/control/save/review behavior; remove light coercions from Settings payload and conflict handling | Preserve revision guards, account ownership and save conflicts. Loading an old saved preference must not silently enable dark during a preparation release. |
| `apps/web/app/layout.tsx:21` | Remove unconditional inline `colorScheme: light` and provide first-paint theme initialization | First HTML paint, auth, refresh, browser back and account routes must agree. Inline style currently wins over CSS `color-scheme`. |
| `packages/ui/src/account.css:2` | Replace `.account-root {color-scheme: light}` | Needed for native select/calendar/form controls as well as the canvas. |
| `scripts/prepare-landing.mjs` | Add future generated theme initialization and theme-aware logo selection | `/` is its own HTML response, not the React layout; do not assume an app provider controls the landing. Never edit generated `apps/web/src/generated/landing.ts` manually. |
| `apps/web/public/landing-composition.css` and `landing-enhancements.css` | Map fixed light backgrounds, text, demo cards, navy button, orange feedback, source quote and footer roles | Preserve full-width opaque sticky header. No blur/glass regression above the blue recovery area. Recheck footer/logo and all demo states. |
| `apps/web/public/reference/ui/{preview-switcher,course-explorer}.css`, `reference/prototype/landing-v2.css` | Adapt via production build overrides or generation, not by editing archived originals | Three preview tabs and both course explorer states must work in the selected appearance. Embedded SVG fills/strokes require separate inspection. |
| `packages/ui/src/profile-settings.css` | Convert fixed white inputs/cards, dark text, muted labels, blue links and focus colors to semantics | This is a material missed area: generic dark tokens alone will leave white forms and unreadable text. Includes public profile, editable bio and privacy controls. |
| `packages/ui/src/account-operations.css` | Add `danger-action`/`on-danger-action` pairing for deletion button | Current pale dark `--danger` with white `--on-primary` risks low contrast. Error text and destructive fill need separate roles. |
| `packages/ui/src/rooms.css:27` | Use the accessible link foreground for `.room-card-link`, not `--action` | Saturated action fill is not necessarily an accessible small-text color on dark panels. |
| `packages/ui/src/account.tsx:68`, `profile-settings.tsx:37`, `foundation-panel.tsx`, `apps/web/src/components/public-page.tsx` | Use a shared theme-aware brand asset choice | These currently hard-code the light logo. Logo dimensions, aspect ratio and aria text must remain stable; avoid duplicate accessible names. |
| `apps/web/src/components/public-page.module.css` | Confirm inherited dark tokens | Public library, rooms, privacy, terms and public profile are outside parts of the signed-in shell. |
| `packages/ui/src/styles.css` plus component sheets | Theme selection, caret, focus ring, scrollbars, native controls and disabled states | Avoid broad opacity on a whole card or foreground. Existing opacity-based disabled buttons need pairing review. |

## Logo finding

`apps/web/public/brand/logo-horizontal.svg` contains two ink lettering paths, two orange paths (dots and right page), and one cobalt page path. The current `logo-horizontal-reverse.svg` is **five white paths**, not a color-preserving dark signature. `icon-reverse.svg` is likewise monochrome.

Recommended primary dark derivative: preserve every path, transform, viewBox, proportion and clear-space relationship; change the two ink lettering fills to the selected pale foreground only. Keep the dots/right page orange and the left page cobalt, then judge the actual-size result on the selected canvas, elevated panel and deep blue marketing section. If cobalt loses the stair cut-out at small size, use the mark on a quiet neutral dark surface or an explicitly reviewed color derivative; do not add glow or a white tile by default. The prepared specimen compares the exact cobalt version with a proposed optical-blue `#5C89FF` version on elevated `#18243A`; root reports the canonical cobalt has only 2.62:1 against that field. Treat the lighter blue as a named dark-use derivative, not a silent global change to the brand master. Pale lettering `#F3F5FC` and orange `#FF650A` remain fixed in that candidate. Final selection depends on the actual-size visual review and the package contrast report. Keep all-white reverse only as a documented single-color fallback. No global CSS `invert()` or brightness filters. Favicon can remain the existing approved color icon unless intended-size checks show a genuine failure.

## Coverage required before future launch

| Surface | States needing visual proof |
|---|---|
| Landing | Top and scrolled opaque header; all hero tabs; checked task; community progress advance/reset; focus preview running/paused; recovery blue field; both course cards; Arabic quotation and source/footer. |
| Auth / onboarding | Email input, Google button, OTP fields, busy, validation, expired/retry, disabled, focus, onboarding choices; loading/reconnect/sign-out lock. |
| Today | First-run guidance, next activity, completed/undo, no courses, no work, overdue/recovery hint, ongoing focus strip; one primary action remains clear. |
| Plan / recovery | Form selection, calendar days, paused/rest days, preview comparison, saved plan, late target, unknown estimate, stale preview, failure and conflict. Preserve meanings and original workload data. |
| Library / My Courses / outlines | Covers, normal/hover, filtered empty, module expanded/closed, completion marker and undo, prior work, optional/excluded work, private course editor, publish request/rejected/approved. |
| Focus | Setup, selected mode, active clock, pause, break, finish, ended/unsaved session, conflict/reconnect, sound controls and unavailable audio. No ambient blinking or glow while working. |
| Rooms | Directory cards, empty, topic/private/course room, join status, present/away peers, phase labels, shared timer, reconnect, moderation/report and chat states if that feature exists. Theme must not manufacture live presence or alter timer logic. |
| Friends / profiles | Link copy, invites/pending/accepted/unavailable, mutual/one-way connections, private progress, avatars/photo failures, bio/handle form and permission summaries. |
| Progress / leaderboards | Own vs peers, equal ranks, names/photos, rank advance, no results, hidden participation, zero data, activity history and course position. Color supplements name/position/shape, never replaces them. |
| Milestones / sharing | Locked/unlocked, shared/private, generated share artifact, privacy toggles and saved/error. Shared/exported imagery must explicitly select its own appearance and preserve text contrast. |
| Notifications / settings / help / admin | Read/unread, loading/empty/error, destructive dialog, input validation, account-data controls, moderation queue and legal body links. |
| Overlays / browser UI | Modal backdrop and raised panel, menus/selects, toast, skeleton, focus, scrollbar, selection, autofill, date input, browser theme-color, narrow-screen nav. |

## Preference behavior to settle in the future implementation brief

Recommend three explicit options: Light / Dark / Device, with Light remaining default until the user opts in. Resolve the chosen mode before first paint; do not derive it solely in a late React effect. Device changes affect only Device mode. Persist an explicit choice and synchronize other tabs without reload. Signed-in saved preference is authoritative after authentication; a local non-sensitive resolved hint can prevent a flash, but it must not overwrite account settings or leak account identifiers. Define logout and switching-account behavior before code. Error/loading states must retain the current resolved appearance.

Because `/` is generated/cached HTML and account pages use Next, use one small resolver contract across both outputs; account-specific content must never enter the public landing cache. Theme changes should update `theme-color` and `color-scheme` coherently. Check CSP compatibility for any first-paint script rather than loosening CSP generally.

## Bounded future implementation order

1. Approve the prepared visual specimen, token roles and color-preserving reverse logo; retain Light-only production meanwhile.
2. Introduce a single token mapping and shared logo component, resolve the listed hard-coded exceptions, then adapt the standalone landing generation.
3. Implement preference resolution/first paint and Settings persistence together; preserve account isolation and running sessions.
4. Verify representative dense screens and every material state above in Light/Dark, plus Device change, refresh/deep link, account switch, keyboard and reduced motion. At minimum 1440, 2160 and 375 CSS pixels at 100% zoom.
5. One measured correction batch; only then deploy under explicit activation scope. Passing token contrast is not evidence that every rendered overlay, photo or hover state passed.

This audit is based on current local source. It does not certify future contrast, production behavior or complete accessibility.
