---
name: Dima — ديمة
description: Catalog-informed native web components, expressive landing and local learning workspace, recorded 31 October 2026.
colors:
  bg: '#FAF9F6'
  surface: '#FFFFFF'
  surface-subtle: '#F0F3FA'
  ink: '#0B142C'
  muted: '#586174'
  line: '#D7DDE7'
  control-border: '#7A8599'
  primary: '#0751F8'
  primary-hover: '#003CC8'
  on-primary: '#FFFFFF'
  accent: '#FF650A'
  on-accent: '#0B142C'
  accent-text: '#9C3500'
  accent-soft: '#FFF0E5'
  focus: '#0751F8'
  success: '#176742'
  success-soft: '#E7F5ED'
  warning: '#855100'
  warning-soft: '#FFF3D6'
  danger: '#AD2834'
  danger-soft: '#FDECEF'
  selected: '#E9EFFF'
  dark-bg: '#101318'
  dark-surface: '#1A1F27'
  dark-surface-subtle: '#242B35'
  dark-ink: '#F1F2F5'
  dark-muted: '#ABB3C0'
  dark-line: '#303843'
  dark-control-border: '#647084'
  dark-primary: '#93B0FF'
  dark-primary-hover: '#BBCCFF'
  dark-on-primary: '#0B142C'
  dark-accent: '#FF853E'
  dark-on-accent: '#0B142C'
  dark-accent-text: '#FFAC79'
  dark-accent-soft: '#33251E'
  dark-focus: '#93B0FF'
  dark-success: '#8ED8B0'
  dark-success-soft: '#1C3028'
  dark-warning: '#EFCA83'
  dark-warning-soft: '#332C20'
  dark-danger: '#FFACB4'
  dark-danger-soft: '#38242B'
  dark-selected: '#1D2D4D'
  dark-field: '#14181F'
  dark-sidebar: '#14181E'
  dark-action: '#245FEE'
  dark-action-hover: '#346CF5'
  dark-on-action: '#FFFFFF'
typography:
  display:
    fontFamily: Manrope, Noto Sans Arabic, sans-serif
    fontSize: clamp(58px,5.5vw,80px)
    fontWeight: 800
    lineHeight: 1.055
    letterSpacing: -0.035em
  headline:
    fontFamily: Manrope, Noto Sans Arabic, sans-serif
    fontSize: clamp(30px,2.7vw,40px)
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: -0.035em
  title:
    fontFamily: Manrope, Noto Sans Arabic, sans-serif
    fontSize: 21px
    fontWeight: 800
    lineHeight: 1.35
    letterSpacing: -0.025em
  body:
    fontFamily: Manrope, Noto Sans Arabic, sans-serif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: -0.01em
  label:
    fontFamily: Manrope, Noto Sans Arabic, sans-serif
    fontSize: 12px
    fontWeight: 750
    lineHeight: 1.45
  arabic:
    fontFamily: Noto Sans Arabic, sans-serif
    letterSpacing: normal
rounded:
  small: 8px
  control: 10px
  panel: 14px
  large: 20px
  pill: 999px
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 20px
  '6': 24px
  '8': 32px
  '12': 48px
  '16': 64px
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.on-primary}'
    typography: '{typography.label}'
    rounded: '{rounded.small}'
    padding: 11px 18px
  button-secondary:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    rounded: '{rounded.small}'
    padding: 11px 18px
  button-orange:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.on-accent}'
    typography: '{typography.label}'
    rounded: '{rounded.small}'
    padding: 11px 18px
  button-quiet:
    backgroundColor: transparent
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    rounded: '{rounded.small}'
    padding: 11px 18px
  button-primary-hover:
    backgroundColor: '{colors.primary-hover}'
  input:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.small}'
    padding: 11px 13px
  navigation:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.on-primary}'
    padding: 10px 15px
  badge:
    backgroundColor: '{colors.selected}'
    textColor: '{colors.primary}'
    padding: 4px 8px
  panel:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.panel}'
    padding: 26px
  recovery-option:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    padding: 20px
  progress-ring:
    height: 88px
    width: 88px
  progress:
    backgroundColor: '{colors.line}'
    height: 5px
---

> B0 integration note (31 October 2026): this visual authority is carried forward from the preserved reference package. Relative asset/code paths mentioned in the historical description below resolve under `assets/reference-ui/`, not the production app. Current product scope and navigation are defined by `docs/PRD_AR.md` and `docs/SCREEN_SPEC_AR.md`. Prototype implementation descriptions are historical; they do not claim production functionality.

# Design System: Dima — ديمة

## Overview

**Creative North Star: "Small steps. Lasting progress."**

Dima keeps the approved Arabic wordmark, orange diamond dots and soft-step book, then extends their route language into the interface. Warm paper and deep ink make room for a strong cobalt next-step surface; orange marks energy and return. English controls use Manrope, while Arabic text uses Noto Sans Arabic. The logo remains supplied artwork.

The landing page makes the learning rhythm tangible through a live product preview and uneven route geometry. The workspace prioritizes the next task, exact completion and a separate focus session. The studio presents the eight reusable patterns with isolated sample controls. This record describes the implemented iteration; it does not claim a newly approved visual comp, production service or native app.

**Key Characteristics:**

- Approved Arabic artwork with English interface text.
- A paper-and-ink working canvas with decisive cobalt focal areas.
- Soft stair geometry used as decorative route language, never a redrawn logo.
- Native reusable components and purpose-limited motion.
- Explicit sample data, browser-local saves and separate time/completion measures.

The source of truth is `foundations/tokens.json` / `foundations/tokens.css`, the actual surface styles and the supplied `assets/logo/` files. This package is a separate iteration from the earlier identity delivery. UI adaptations live in `ui/`; the catalog selection and rights evidence live in `catalog/ATTRIBUTION.md`. Scope and data boundaries remain in `PRODUCT.md` and `CONTENT_AND_UX_RULES.md`. Validation evidence belongs to the delivery QA report, not to this design record.

## Colors

Cobalt and orange retain the approved brand character; warm paper and deep ink carry readable content.

### Primary

- **Cobalt:** `primary` for selected controls, task progress and principal actions. The public hero and course panel use fixed brand cobalt; the workspace uses a cobalt next-task focal panel.
- **On-primary:** pair it with semantic primary. Dark working UI uses the pale-blue semantic action with an ink foreground.

### Secondary

- **Orange:** fixed brand orange for route details and an energetic action. Filled orange actions use ink text. `accent-text` is the darker text role on light surfaces.
- **State colors:** success, warning and danger remain semantic, accompanied by text. Decorative graphics do not imply task completion.

### Neutral

- **Paper / surface:** the light canvas and white working surfaces.
- **Ink / muted:** primary and supporting text. Dark variants retain the same role names.
- **Line / control-border:** fine content divisions and stronger interactive edges.

**The Artwork Rule.** Use the supplied SVG geometry. Do not typeset the wordmark, move its dots, redraw the book passage or add glow.

**The Semantic Theme Rule.** Use semantic theme roles for the workspace and studio; preserve fixed brand artwork and intentional light preview surfaces.

The landing is an intentional light surface. `dima-preview-switcher` presents a fixed light sample interface, including when embedded in the dark studio. The course panels retain cobalt and ink fills. Core progress, step and command components inherit semantic light/dark roles. A light backing protects the full-color logo in dark studio/workspace placement; reverse SVG variants are also supplied.

## Typography

**English display and body:** Manrope, self-hosted in `assets/fonts/`. **Arabic text:** Noto Sans Arabic, also local. Both fall back to sans-serif. The interface is English/LTR; Arabic artwork must not be mirrored.

The frontmatter records the principal landing display and workspace heading roles, not a single compulsory size for every surface. The landing headline uses `clamp(58px,5.5vw,80px)` in its base layout, 86px in the widest rule, then narrower breakpoint rules. The workspace page heading uses `clamp(30px,2.7vw,40px)`; mobile uses 32px. The studio title uses `clamp(46px,5.8vw,78px)` and 44px on small screens. Body sizes vary by use: 16–17px in public introductions, compact 12–14px supporting working text, and 16px studio explanatory copy.

Weights and line-height establish hierarchy. Use tabular numerals for timers, percentages and numerical state. Keep reveal text intact for selection and assistive technology; do not split Arabic letters into animation fragments.

**The Two Scripts Rule.** Use Manrope for the English interface and Noto Sans Arabic for Arabic text. The logo is artwork, not a font sample.

## Layout

Three surfaces share foundations but serve different tasks:

- `prototype/landing.html`: asymmetric introduction beside a working sample preview, followed by an explanatory sequence, a broad cobalt recovery moment, course exploration, community rules and closing action. The main width is capped at 1280px. Its layout rules occur at 1500, 1100, 850 and 600px.
- `prototype/index.html`: desktop side navigation, top command search, focused next task and contextual progress column. Mobile uses a compact header and bottom navigation. The fixed session rail keeps time controls available; lower content includes room for the rail. Existing layout rules include 700, 950, 1150 and 1600px, with narrower refinements in the current stylesheet.
- `studio.html`: an explanatory introduction, sticky component index and sequential specimens. The index becomes a wrapped list below 950px; compact layout starts at 600px.

Component responsiveness belongs to its own stylesheet: steps stack at 520px, course panels stack at 700px, and preview controls tighten at 450px. Foundation breakpoints are nominal cross-platform tokens; they do not replace these observed surface breakpoints.

## Elevation & Depth

Use tone and spacing for the working hierarchy. The preview window has a soft offset shadow; the command dialog and session rail sit above their context. No logo asset includes a glow or shadow.

### Shadow Vocabulary

- Product preview: `0 20px 55px #03173f25` in `ui/preview-switcher.css`.
- Session rail: `0 8px 28px #0b142c20` in `prototype/styles.css`.
- Current workspace feedback: `0 10px 30px #0B142C26` in the workspace refinement.

**The Work Surface Rule.** Separate routine content through spacing, dividers and surface tone. Reserve soft elevation for the product preview, session rail, command dialog and transient feedback.

## Shapes

The source logo combines an open book with an irregular soft staircase. Decorative SVG routes extend this idea with rounded turns and uneven rises. They carry no learning data and are hidden from assistive technology. Buttons use compact rounded rectangles; working panels use restrained corners. Small badges and switches may use their own compact forms. Use original logo files rather than reconstructing the mark from CSS or type.

## Components

| Pattern | Source files | Built behavior |
|---|---|---|
| Path field | `ui/dima-ui.*` | Eight independently drawn stair paths; offscreen/background pause; no data meaning. |
| Magnetic action | `ui/dima-ui.*` | Inner label moves at most 4px; hit area stays fixed; fine pointer only. |
| Text reveal | `ui/dima-ui.*` | One 360ms visible-first settling movement; replay API; reduced-motion fallback. |
| Completion ring | `ui/dima-ui.*` | Labeled 0–100 progressbar, value clamping; adjacent exact count supplied by caller. |
| Step indicator | `ui/dima-ui.*` | Ordered list and one current step; indicator only, not a fabricated wizard. |
| Command navigation | `ui/dima-ui.*` | Native dialog, search, arrow keys, Enter, Escape, empty state and focus restoration. |
| Product preview | `ui/preview-switcher.*` | Learn / Plan / Recover tabs with instance-local sample interactions. |
| Course explorer | `ui/course-explorer.*` | Two seed-course panels with click/focus disclosure and actual library links. |

Complete integration examples are in `ui/README.md`; live examples and controls are in `studio.html`. `DimaUI.init(root)` is idempotent and is called after app rendering. Custom elements initialize themselves. The workspace attaches Ctrl/Cmd+K to command navigation; the core kit does not install that shortcut on arbitrary pages.

Motion is a supporting brand feature. Decorative motion pauses when the page is hidden, respects system reduced motion, and has a page-local toggle where exposed. Fine-pointer attraction leaves the clickable target still. Routine task completion updates real state without decorative automatic increases. The study timer remains separate from completed tasks.

## Do's and Don'ts

### Do

- Do preserve the supplied wordmark, diamond dots and soft-step book geometry.
- Do use semantic colors for working controls and explicit labels for state.
- Do place exact task counts beside percentage progress.
- Do retain keyboard focus, reduced motion and a user motion control for decorative animation.
- Do distinguish isolated preview state from saved workspace state.
- Do retain source attribution and applicable licenses when reusing adapted work.

### Don’t

- Don't add glow, glass or baked shadows to the logo.
- Don't use white text on the bright orange action fill; use its ink foreground.
- Don't present hours, task completion and ranking eligibility as the same measure.
- Don't use repeating animation or magnetic effects on routine task controls.
- Don't claim that sample outlines are complete provider curricula.
- Don't infer hosted operation, live rankings or native clients from the local web build; current verified backend behavior is documented in the stage evidence.

## B0 foundation surface — implemented integration, 31 October 2026

The new internal proof at `packages/ui/src/foundation-panel.tsx` is an **Operate** surface, shared by the Next web build and standalone Vite client. It exercises disposable test authentication and a small saved-check form; it is neither the production landing nor the B1 account experience. The preserved landing and supplied logo geometry remain unchanged.

Its composition uses the existing paper/ink/cobalt tokens and local fonts: a branded header with explicit “Local development · B0” labeling, explanatory context alongside a bounded connection form on desktop, and the same content stacked on narrow screens. The mobile action group becomes full-width. The footer repeats the development-only boundary. No decorative route animation or new visual world was introduced.

Controls retain visible keyboard focus, labels, disabled/busy feedback and a polite status region. The surface covers disabled configuration, sign-in, signed-in saved checks, empty results, saving/loading feedback, recoverable error and sign-out. Reduced motion removes CSS transitions. These are implemented affordances, not a standalone accessibility-conformance claim.

Desktop and mobile captures in `.impeccable/review/desktop.png` and `mobile.png` were inspected for this documentation pass. Both show the same branded hierarchy and signed-out test form; the mobile capture stacks content without cutting off the controls. Functional verification and its limitations remain in the root B0 evidence report rather than being duplicated here. The bounded surface contract is [docs/surfaces/b0-foundation.md](docs/surfaces/b0-foundation.md).

## B1 accounts and workspace — implemented integration, 31 October 2026

The account surfaces now use the existing Dima visual system for email-code authentication, resumable onboarding, saved preferences and a responsive member shell. The Next pages wrap a shared React `AccountApp`; the supplied logo and reference landing remain the visual authority. Root integration adapts the approved landing's links to the real routes and keeps the B0 proof at `/dev/foundation`.

Desktop uses a calm sidebar and a bounded content area; mobile uses Today / Plan / Focus / Courses / More. Work-only entry requires no course. Later features have explicit preview notices, with no invented progress, time or participation. Account changes clear private state, stale save responses are owner-guarded, revision conflicts require review, and pending sign-out locks the private view even after a failed request. Saved appearance and motion preferences reuse the existing theme tokens and respect device reduced motion.

The implemented surface contract and evidence limits are recorded in [docs/surfaces/b1-accounts.md](docs/surfaces/b1-accounts.md). Google capability and hosted readiness remain separate from the UI's presence; neither is inferred from an enabled route or a screenshot.

## Refined dark workspace — historical B2 preparation (disabled by later user decision)

Use the product theme layer in `packages/ui/src/theme.css`: charcoal canvas, slightly lifted panels, inset fields, cobalt action fill separate from accessible blue links, and approved reverse logo without a pale container. The original reference assets stay immutable. Desktop/mobile Settings and save/reload were visually and functionally checked before B2 implementation.

## B2 learning workspace — implemented integration

Library, private outlines, explicit scope and prior work, one shared planning budget, preview/apply, course progress and Today reuse the existing workspace. Long schedules show the first seven study days with accessible expansion; selected activities in a module can be marked as prior work explicitly. Saved, provisional, stale, failed and partially scheduled states have visible explanations. These are local functional surfaces; timers, rooms and social ranking remain later stages. See [B2 evidence](docs/evidence/B2.md).

## Current appearance and continuity — user decision, 31 October 2026

The product now ships light only, including accounts with saved dark/system preferences and devices set to dark. Appearance controls are removed; reduced motion remains. Keep the original/reference dark tokens archived, not selectable. Preserve the mounted workspace during ordinary background revalidation, use client navigation and a small route indicator, and reserve the private-view lock for real identity transitions or sign-out. Evidence: [continuity verification](docs/evidence/UX_CONTINUITY.md).

## Production landing refinement — 1 November 2026

The production landing uses `apps/web/public/landing-enhancements.css` and `.js`, composed by `scripts/prepare-landing.mjs`. The historical reference package stays unchanged. Motion is on by default; the user explicitly removed the motion toggle. System reduced motion remains respected. The authored stair-path entrance settles within 3.8 seconds, with finite recovery-path and room-clock sequences on entry, and feedback when the visitor operates the sample. No automatic tab switching or perpetual decorative loops. The shared-focus illustration is explicitly a sample, not live presence. This supersedes the historical landing toggle guidance above.

### Workspace wayfinding — 2026-11-01

Use visible labels with icons; never rely on color or icon recognition alone. Desktop navigation separates Your workspace from Discover, gives each main destination a short functional description, and places occasional contribution/admin tools inside More tools. Study rooms has its own desktop destination; mobile retains the existing five destinations with rooms accessible through Focus and More. Desktop breadcrumbs provide parent links; small screens use the existing page back links and bottom navigation without crowding the header.

Today guides the next real step from saved account state: choose a course, configure a week, or resume the latest unapplied preview. Work-only members can start a timer directly. The guide is not a forced wizard and never marks progress or applies a plan. Keep primary actions visibly stronger than secondary completion/history controls. Prefer useful empty-state actions to oversized zero metrics. Approximate durations are explanatory information, not a blanket error state. Long focus activity lists are first narrowed by course, then searchable; selected activities survive search changes until explicitly changed.

### Planning decisions and schedule density — 2026-11-01

Keep the proposed plan and verified faster alternative in one comparison area. The current-plan action names saving explicitly; the faster alternative creates a preview and requires a separate save. Preserve stale-preview, conflict, unknown-work and explicit partial-application guards. Preview calendars start with seven closed day summaries; saved calendars may open the first study day. Daily totals say scheduled minutes and study blocks, never a completion-like ratio. Show capacity, reserved time and historical allocation context inside the day. Attribute a single-course day once; retain per-activity attribution for mixed-course days. Put general estimate methodology after the week. Setup groups weekly inputs and course goals side by side where space permits, with compact optional adjustments below; narrower surfaces retain logical reading order.

### Workspace sizing at 100% zoom — 2026-11-02

Wide signed-in workspaces use `--workspace-type-unit`: 1px at 1280px, rising fluidly to 1.5px at 2080px and then capped. Typography, sidebar, catalog artwork, and constrained working surfaces share this scale. The main content limit grows from 1240px to 1860px, within the available viewport; horizontal gutters remain bounded. Keep readable form/text limits, existing reflow below 1280px, and native browser zoom. Do not apply CSS zoom, transforms, JavaScript device detection, or this workspace scale to public/auth pages. Shared primitives use the 1px fallback outside the workspace. The room directory aligns with the workspace rather than adding another centered fixed-width wrapper.


## Public landing refinement — 2 November 2026

The production landing retains the approved logo, paper/cobalt/orange palette and headline, while expanding to a maximum 1840px canvas at normal browser zoom. `--landing-unit` scales public typography between 1px and 1.4px; browser zoom and CSS zoom are not used. Originals under `assets/reference-ui` stay unchanged. Production adaptations are generated by `scripts/prepare-landing.mjs`; composition and sample interaction styles are in `apps/web/public/landing-composition.css`.

The story now goes from a usable planning example to how it works, studying together, recovering after a pause, course discovery, and the name’s origin. The community example has a visitor-controlled progress track and a 30-second shared-focus preview. Names/progress are explicitly illustrative, with no account writes. The preview pauses offscreen, on tab changes and when the document is hidden. Motion is finite or action-driven, with system reduced-motion respected. Public layout is expressive; no workspace styling or backend behavior changed.

### Action-led landing dynamics — 2 November 2026

The recovery section now demonstrates a fixed sample rather than only showing a static path: four planned25-minute steps plus two missed steps are redistributed across Tuesday–Thursday. Completed Monday work stays fixed. The two choices show later finish/same daily load vs original finish/higher daily load, conserving all150remaining minutes. `landing-dynamics.js` owns the finite FLIP transitions and hero route responses; hidden/offscreen/reduced-motion states cancel them without changing the settled sample data. A no-script visitor sees the static example with inactive controls hidden. Source originals and the separately prepared dark appearance remain untouched. No animation dependency, account writes, autoplay sound or unbounded loop was introduced.

### Optional dark appearance — 2026-11-02

The production UI now supports explicit Light/Dark choice; light remains the initial default even on dark devices. Shared first-paint `appearance.js` and semantic tokens cover static landing and React routes. Preference is browser-local (`dima-appearance-v1`), synchronized across same-origin tabs, and does not save account settings or interrupt sessions. A labeled header control and Settings control expose the same state. Preserve the approved geometry and cobalt/orange identity; use the prepared pale lettering/optical blue dark logo derivative. No inversion, automatic device switching, ambient glow, or full-page theme animation. Evidence: `docs/evidence/DARK_MODE_ACTIVATION_AR.md`.

### Passive landing paths — 2 November 2026

The user explicitly requested ambient movement and mouse response across the public landing. This supersedes the list-based recovery demo above: recovery is again a winding, stepped SVG journey, with completed work kept orange, a dip, and a continuing path. It reveals once on entry and supports a finite replay. Quiet blue/orange background paths and traveling points run only in visible sections; fine-pointer response is bounded to six pixels. Content never follows the pointer. Reduced motion, hidden tabs and offscreen sections stop the ambient effects. A discreet footer pause control persists locally; no header motion toggle, dependencies or account writes. Light remains default and the optional dark palette is preserved.

### Planning clarity — 2 November 2026

Planning remains an Operate surface: choose a sustainable week, review the resulting duration and finish, then save explicitly. Setup explains remaining workload, reserve-adjusted capacity and a clearly preliminary combined duration; missing estimates or special scheduling defer duration to the full forecast. Calendar-month goal shortcuts clamp month ends. Forecast rows show approximate elapsed weeks/months derived from the actual scheduler, exact finish and target difference, plus current completion and remaining work. Saved forecasts retain their original start/date basis and are labeled historical. Browse seven days at a time rather than expanding every future block. No planning input change silently changes the active schedule.

### Course enrollment and first entry — 2 November 2026

Enrollment is a decision surface: routine and target alongside the actual scheduler's uncommitted finish forecast. Keep provenance and detailed scope secondary; missing durations need explicit, editable user estimates rather than invented provider data. Carry the first routine into week review without applying or replacing a saved plan. Initial generic learning onboarding opens the library; intentional deep links retain their destination.
