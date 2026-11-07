# Dima after hours — prepared dark appearance

**Status:** design proposal and isolated visual specimen, 2 November 2026. **Not integrated, enabled, deployed or user-approved as a final appearance.** The production site remains light-only. This package is the proposed replacement for historical dark styles when implementation is explicitly requested; it does not supersede the current production `DESIGN.md`.

## Intended experience

Same Dima, after hours: an ink-navy canvas, legible layered surfaces, cobalt actions, pale-blue links and restrained orange momentum. The approved staircase/book geometry, Arabic lettering, Manrope/Noto Sans Arabic, spacing, interaction logic and 100% zoom sizing survive. Darkness is an appearance preference, not a focus mode, privacy state, timer phase or new product tier.

The landing can be expressive. The workspace should be calm enough for sustained use. Visual impact comes from the typography, path, measured color areas and a meaningful response to progress; not a neon halo, animated background or extra decorative controls. The reference samples are illustrative, not new product behavior or real users' records.

**Completion criteria for preparation:** inspectable sample screens; explicit token roles; real reverse-logo assets; component/state coverage; implementation map and acceptance gates; no application imports, preference mutations or deployment. Runtime integration is intentionally deferred.

## Surface hierarchy and color roles

`tokens.json` is the machine-readable source. `dark-tokens.css` is a **preview-scoped** equivalent, not a stylesheet to drop into the application unchanged.

| Role | Value | Intended use |
|---|---|---|
| Canvas | `#0C1220` | Page behind content. Avoid absolute black over the entire application. |
| Sidebar | `#0E1727` | Quiet navigation, separated with a fine structural rule. |
| Surface | `#111B2D` | Course lists, room members, forms, main work areas. |
| Raised | `#18243A` | Menus, dialogs, preview card; elevation must convey a relationship. |
| Hover surface | `#20304B` | Row hover; selected state remains separately identified. |
| Field | `#0D1626` | Inset editable controls with a stronger control outline. |
| Ink / secondary | `#F3F5FC` / `#A6B3CA` | Primary reading / descriptions, dates, placeholders. Never dim a whole completed row. |
| Action / hover / pressed | `#3565F5` / `#2855DB` / `#2046B8` | Primary control fills, with white labels. |
| Link / hover | `#A5BEFF` / `#CFDCFF` | Text links and active icon strokes. Not a large CTA fill. |
| Accent / accent text | `#FF650A` / `#FFA36C` | Brand momentum / small warm text on dark surfaces. Orange fill takes navy text. |
| Selected / focus | `#20345B` / `#B9CDFF` | Selected area / visible 3px keyboard outline with 4px offset. |
| Structural / control border | `#2B3951` / `#7485A2` | Passive grouping / interactive boundary. They are intentionally different. |
| Success | `#79D8AE` on `#142D29` | Saved/completed + text or check. Not generic engagement decoration. |
| Warning | `#F0C675` on `#342B19` | Needs review + explanation and route forward. |
| Danger text | `#FF9AA9` on `#361E2B` | Validation/error or outlined destructive action. |
| Destructive fill | `#B83250`, hover `#9E2843` | Strong destructive confirmation only, with white text. Never use pale error-text color as a white-label fill. |
| Disabled | `#8D9AB1` on `#1E293D` | Stable pairing. No whole-control opacity multiplication. Explain why disabled when it is not obvious. |
| Track | `#2B3951` | Paired with `#5C89FF` progress; preserve labels/counts. |
| Overlay | `#030712CC` | Modal backdrop; raised dialog has a strong boundary, maximum soft offset shadow. |

Do not turn every container into a card. Keep schedule rows, modules and leaderboards grouped by content with deliberate whitespace. A subtle boundary is appropriate for passive grouping; interactive controls use stronger borders or obvious labels. No global CSS `invert()`, brightness filters, opacity-darkened screenshots or giant blue gradients as theme conversion.

## Logo: actual assets, not a filter

The original horizontal master remains unchanged. Its two ink lettering paths become soft white `#F3F5FC`. Orange dots and right page stay **exactly `#FF650A`**. The left page uses **`#5C89FF` in the proposed dark-use color derivative**. All SVG paths, transforms, dimensions, viewBox, counters, stair passage and composition remain identical to the supplied master.

| Asset | Use |
|---|---|
| `assets/logo-dark-color.svg` | Proposed default for dark header/sidebar/auth footer on canvas/surface/raised navy. |
| `assets/logo-dark-exact-color.svg` | Comparison proof retaining original cobalt; not the selected default. |
| `assets/logo-dark-mono.svg` | Single-color fallback on solid cobalt or one-color reproduction. Not the normal navy-header logo. |
| `assets/icon-dark-color.svg` | Dark-surface icon proof; use only where the symbol already has adjacent identity or established recognition. |
| `assets/logo-light-original.svg` | Untouched reference for visual comparison; light version remains the production asset. |

The original cobalt against the raised navy measures 2.62:1; the optical blue measures 4.79:1. These are **optical diagnostics**, not a legal accessibility requirement for logos. The purpose is to preserve the visible blue page and central stepped passage at small size. The blue derivative is named and restricted to dark use, not a global brand-color replacement.

Actual-size preview examples: 180px regular header, 140px compact, 108px narrow, icon at32/16px. These are sample use sizes, not universal minimum reproduction certifications. Keep transparent background and existing proportions. No glow, bevel, extra stroke, white backing tile, crop, mirrored book or recolored user photo. The favicon must be checked against actual browser chrome at implementation; its appearance can follow the browser scheme independently of the account preference. Do not assume a page-level theme attribute changes SVG favicon media queries.

## Page-by-page visual contract

| Surface | Dark treatment and user priority |
|---|---|
| Landing | Full-width **opaque** navy sticky header; logo and links aligned to content grid. Keep the fixed-header clearance. Hero: pale main text, blue emphasis, navy-blue path field, raised readable sample. Orange appears in the finite completion feedback. |
| Landing recovery | Deeper royal blue `#123B9D` replaces the large, very bright cobalt field; white/pale blue reading and orange route retain the identity. No visible seam/transparent header above it. |
| Landing community / library / origin | Named avatars and labeled sample progress; controlled local animation. Course cards preserve provider text and disclosure. Arabic hadith stays exactly as current sourced copy, with generous line height and no moving/glowing text. |
| Public library / detail | Dense content on surface, covers explicitly themed, clear filters and enrollment CTA. Source/provider logos are preserved on their approved field rather than inverted. |
| Auth / onboarding | Calm bounded form; labels and OTP remain visible. Google brand button follows its supplied approved asset treatment. Email validation, retry, expired code and busy controls must all be themed. |
| Today | Single primary next action. Course/module context secondary. Completed work is readable with a check; sparse state offers one useful next step. No oversized empty statistics. |
| Plan / recovery | Week selection is outlined and filled; day label and workload remain visible. Rest is a named state, not gray invisibility. Proposed/save/current/stale statuses remain semantically distinct. Compare pace and finish, not just color. |
| Course / modules | Search and source order remain clear. Completed/next/optional/excluded states have labels and glyphs. An open module has a visible boundary and a compact completion action. One small completion response, not every row flashing. |
| Focus | Large stable tabular numerals in soft white. Low-chroma surrounding UI. One primary start/pause/resume control. Phase has a text label. No pulsing ring, moving wallpaper or ticking announcement to screen readers. |
| Rooms | Shared timer uses the same clock treatment. Present/away/reconnecting states keep labels and timestamps where applicable. Member photos are never dimmed/inverted. Chat color treatment is conditional on implemented chat capability, not a promise to add chat. |
| Friends / profiles | Personal invitation link appears immediately. Pending/accepted/following/private are explicit. Public identifiers and photos remain distinct from private progress. Do not silently change sharing defaults with appearance. |
| Leaderboards / course positions | Own row uses name/“You” and a warm progress marker; peers use blue. Percent, completed activities and tracked time are different units. Ties, zero results, hidden participation and unavailable peers remain understandable. No fabricated XP. |
| Progress / history | Chronological rows stay readable. Charts need labels, legends and shape/pattern distinctions where needed. Heatmaps must show zero vs missing vs private distinctly. |
| Milestones / share cards | Keep unlocked marker and text; locked has lock + explanation, never low-opacity unreadable copy. Shared export chooses its own stable background and assets; changing theme does not republish or change privacy. |
| Notifications / settings / admin / help | No exception to the theme: fields, menus, moderation rows, destructive dialogs, read/unread, legal body links, keyboard focus and errors get explicit roles. |

The isolated preview contains eight views: Landing, Today, My Plan, Course, Focus & rooms, Friends & ranking, Components, Logo. Unrendered states/pages above are specifications for implementation, not claimed screenshots of finished production UI. See `IMPLEMENTATION_AUDIT.md` for exact source ownership.

## Component and interaction rules

- Buttons: preserve target size, shape and hierarchy across themes. Hover does not invert text or enlarge layout. Press moves at most1px; disabled stays legible. Loading reserves label width and leaves a useful status message.
- Links: pale blue, underline on hover/focus where surrounding text could be confused. A room-card link must use link color, not saturated action fill.
- Forms: inset field, visible label, readable placeholder, caret and outline; error text names a correction. Theme native selects, dates, autofill and check/radio state. Do not hide native browser feedback without replacement.
- Tabs/navigation: selected fill plus label/weight/indicator; color alone is insufficient. Side/bottom navigation positions and breakpoints do not change with appearance.
- Dialog/menu: raised surface + clear edge; one appropriate offset shadow only. Backdrop blocks distractions. Focus enters, stays and returns correctly; Escape obeys the existing safe-dismiss behavior.
- Toast: small raised surface, status text, correct success/error symbol; not a full-screen color blast. Saved vs queued vs failed must remain truthful.
- Skeleton: stable dark blocks; no endless high-contrast shimmer. Existing content stays mounted during background revalidation.
- Browser: `color-scheme`, selection, scrollbar, caret, focus and theme-color must agree. Forced-colors needs a native readable fallback rather than brand paints forced with `!important`.
- Artwork: use role-based fills/strokes; preserve logos/photos. Inspect any raster with white edges; do not use blanket filters to disguise them.

## Motion and sound

Default motion remains on as currently agreed; honor `prefers-reduced-motion`. Appearance does not introduce a new “Motion on” toggle.

| Moment | Treatment |
|---|---|
| Hover/press | 120–180ms color feedback; no magnetic or perpetually moving controls. |
| Expand/collapse | 200–240ms where it clarifies the relationship, no delayed access to content. |
| Your completion | 400–600ms local marker movement and a small check/warm response; reset/reconnect does not replay history. |
| Peer progress | At most one short move per actual new progress event; coalesce bursts, stable names, announce a concise summary rather than every frame. Never infer a physical course location from percentage alone. |
| Focus | Timer updates text; no visual pulse every second. On completion, clear phase text + optional short sound. |
| Theme change | Instant atomic theme update. No page-wide crossfade, flash, unmount or timer restart. |

Sound is off in the standalone preview until explicitly checked. The sample sound is two quiet synthesized notes after a user action; it changes no product sound preference. Future implementation reuses existing sound/mute settings, requires browser audio unlock, avoids duplicate cues across tabs, and never substitutes sound for visible completion. No automatic audio on opening dark mode. Muted/reduced-motion/offline users get equivalent information.

## Future appearance preference behavior — proposed, not implemented

1. Offer **Light / Dark / Device** in Settings. Light remains the default until a deliberate future rollout decision; historical stored dark values do not auto-activate this preparation.
2. Store the chosen preference, not only the resolved color. Device follows OS changes only when Device is chosen. A simple accessible appearance entry can link to this control; do not add a floating theme widget over study content.
3. Resolve before first paint on both generated landing HTML and Next account pages. Use one shared small resolver with CSP-compatible delivery; no private user data in the public cache or HTML.
4. Signed-in server preference is authoritative. For instant first paint use only a non-sensitive resolved local hint. If account settings differ after login, update once without reloading; never overwrite server preference with a stale browser hint.
5. On logout retain the current visual mode for that browser visit but remove any account-associated hint. Public preference may be stored separately. On account switch apply the new account’s own saved preference; never save the previous account’s value to it.
6. Explicit change updates view immediately, then saves with current revision/conflict guards. On failure state “Applied on this device; couldn’t save to your account” with Retry; do not report success. Preserve form drafts and running sessions.
7. Other tabs follow the deliberate preference event without reload. Device media-query changes never override explicit Light/Dark. No theme query parameter in shared friend links unless a future design explicitly needs it.
8. Browser theme-color tracks resolved mode. Print/export/share assets choose explicit backgrounds separately; a dark browser must not silently produce an unreadable printed report.

## Readability, scale and verification

Preserve existing workspace and landing fluid sizing at100% zoom. Theme must not change layout geometry. Check1440,2160 and375CSSpx, and ordinary browser zoom/reflow during eventual integration. Arabic uses the existing Arabic font and joins, normal tracking, and separate bidi handling for embedded identifiers. Large text is not a reason to make descriptions faint.

Palette targets: normal text/placeholder4.5:1; large text3:1; required control/state graphics3:1 against adjacent backgrounds. Passive panel rules are not substituted for required control boundaries. Logos are exempt from the WCAG text requirement, but remain visually inspected. Reference: [W3C contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [W3C non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), checked2November2026.

`python3 verify-palette.py` recalculates37 defined solid pairs and checks unchanged SVG geometry. The report is arithmetic evidence for these pairs, **not** certification of every browser state, photo, blend or full WCAG conformity. The selected palette has no failures in those37checks.

## Integration order and stopping boundary

1. Review this standalone proposal, especially the logo/color treatment and dense workspace.
2. When explicitly requested: map these roles into one canonical theme layer, add the shared brand asset selector, remove hard-coded exceptions listed in the audit. Keep originals and light baselines.
3. Build first-paint resolution, persistence and Settings as one coherent change; the public landing needs its own generated initialization.
4. Apply page/state coverage above, verify active-session continuity and light-mode regression; sample prototype interactions are not production logic.
5. Deploy only under a future activation request after visual and functional acceptance. Keep a reversible light-only fallback.

No app import, runtime toggle, database change, public asset replacement, rollout flag or deployment is part of this preparation. The package is local design work, ready to guide implementation, not an implemented dark theme hidden behind a switch.
