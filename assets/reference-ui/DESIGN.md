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
  dark-bg: '#0B1424'
  dark-surface: '#141F34'
  dark-surface-subtle: '#1D2B43'
  dark-ink: '#F5F7FC'
  dark-muted: '#B3BED1'
  dark-line: '#35435D'
  dark-control-border: '#8997B0'
  dark-primary: '#A5BFFF'
  dark-primary-hover: '#C2D3FF'
  dark-on-primary: '#0B142C'
  dark-accent: '#FF995B'
  dark-on-accent: '#0B142C'
  dark-accent-text: '#FFB384'
  dark-accent-soft: '#3D281F'
  dark-focus: '#A5BFFF'
  dark-success: '#8CDDB2'
  dark-success-soft: '#18392C'
  dark-warning: '#F8D48A'
  dark-warning-soft: '#3B301D'
  dark-danger: '#FFAFB8'
  dark-danger-soft: '#42232E'
  dark-selected: '#253C67'
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
- Don't claim backend accounts, cloud sync, live rankings or native clients from this local web prototype.
