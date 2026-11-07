# Dima UI experience — implementation handoff

This package extends the approved Dima identity into an expressive landing, a refined local learning workspace and an eight-pattern component studio. It is a static native-web implementation; it is not a React package, a native mobile application or a deployed service.

## Entry points

| Surface | File | Purpose |
|---|---|---|
| Public experience | `prototype/landing.html` | Demonstrate learning, planning and recovery; lead into the local app. |
| Workspace | `prototype/index.html` | 12 hash-based sample views, local completion and focus sessions. |
| Component studio | `studio.html` | Eight live patterns, dark preview, motion control and usage examples. |
| Existing state examples | `prototype/components.html` | Additional component/loading/error state examples retained from the prior prototype. |

Serve the delivery root over localhost. There is no install/build step. Keep the relative directories intact. Manrope and Noto Sans Arabic are local WOFF2 assets. The interface makes no automatic network requests for fonts, component runtimes or analytics. Provider links navigate to their external sites only when activated.

## Import order

```html
<link rel="stylesheet" href="foundations/tokens.css">
<link rel="stylesheet" href="ui/dima-ui.css">
<link rel="stylesheet" href="ui/preview-switcher.css">
<link rel="stylesheet" href="ui/course-explorer.css">
<!-- Your page CSS follows. -->
<script src="ui/dima-ui.js" defer></script>
<script src="ui/preview-switcher.js" defer></script>
<script src="ui/course-explorer.js" defer></script>
<!-- Your page's deferred script follows. -->
```

Load only the feature-specific files you need. The workspace needs the shared core kit; it does not need the public preview/explorer scripts. Resolve paths relative to the page. Set theme on `<html data-theme="dark">` where a dark working surface is required. The public preview intentionally stays light; the core kit inherits semantic dark tokens.

## Reusable contracts

| Pattern | Contract |
|---|---|
| Path field | `<dima-path-field>` inside a positioned, sized container. Decorative only. |
| Magnetic action | `[data-magnetic]` on a styled button/link. Calls are initialized through `DimaUI.init(root)`. |
| Text reveal | `[data-reveal]`, optionally `DimaUI.replay(element)`. Content is visible by default. |
| Progress | `<dima-progress value="25" label="Task completion">`; update the value attribute from actual completion data. |
| Steps | `<dima-steps current="1" labels="Course|Rhythm|Review">`; 1-based indicator, no workflow engine. |
| Commands | `DimaUI.openCommands([{label, description, href}], trigger)`; navigation only. |
| Product preview | `<dima-preview-switcher app-href="prototype/index.html#setup">`; `selectTab('learn'|'plan'|'recover')`; `preview-change` event with `detail.tab`. |
| Course explorer | `<dima-course-explorer library-href="prototype/index.html#library">`; `selectCourse(0|1)`; `course-preview-change` event with `detail.index`. |

See `ui/README.md` for copy/paste examples and limitations. Preview and explorer currently ship Dima seed content; their public API switches state and destination, not arbitrary server-fed course arrays. Refactor that content deliberately when integrating a real catalog. Do not assume the sample preview is a scheduling engine.

## State and interaction boundaries

Workspace state uses the browser key `dima.identity.prototype.v1`. Same-origin tabs may synchronize through the storage event; another origin, browser or device is a separate store. Theme, task completion, private course outlines and sessions are local. A storage failure is surfaced by the app. Reset is an inline confirmation that concerns only this demo's state. Export produces a local JSON download.

Completing/reopening a task changes task progress. Timer duration and manual duration remain separate records. Manual time never becomes ranked hours. The recovery screen compares a fixed sample scenario; an explicit apply action preserves completed work. Saved setup preferences can be reopened, but a complete cross-course scheduling engine is not implemented. Course-publication requests remain local drafts. The leaderboard presents rules/empty states rather than fabricated participants or scores.

The public preview is intentionally independent: its checked tasks, selected days and recovery choice remain in that component instance and reset on reload. They do not update workspace completion or account data.

## Accessibility and motion integration

The core kit provides semantic progress/steps, a searchable native dialog with keyboard navigation and focus restoration, and a reduced-motion-aware reveal. The app supplies Ctrl/Cmd+K. The preview tabs support arrow keys/Home/End; course details can be opened with touch or keyboard focus. Use real buttons/links rather than clickable wrappers.

Motion controls are page-local and do not persist. System reduced motion takes priority. Path animation pauses offscreen and while the document is hidden; pointer attraction is limited to fine pointers and moves the inner label rather than its target. Keep these effects away from repeated study actions.

## Assets, provenance and reuse

Use `assets/logo/` geometry unchanged and the local fonts under `assets/fonts/`. The foundations directory also retains platform token exports, which are references for later mobile development, not built mobile components.

`catalog/selection.json` maps all eight references. `catalog/ATTRIBUTION.md` distinguishes MIT evidence from references whose license was not established. For those references, only the general interaction idea informed an independent native implementation; original demo imagery/layouts/source chunks are not runtime assets. Keep applicable license notices with adaptations. The private raw catalog/source archive is excluded from the reusable runtime archive. Reuse does not make upstream work exclusive Dima intellectual property.

## Verification and next implementation boundary

`node prototype/verify.mjs` exercises app-level state and delegation contracts. Syntax checking alone is not visual or browser verification. The root delivery QA record owns the actual viewport, interaction and review evidence; this document adds no production or accessibility-conformance claim.

Production integration still requires the chosen backend, authentication, access control, durable data schema, real scheduling, verified course outlines, shared catalog moderation and leaderboard rules. This task did not publish or provision those services. Porting the web components to React or to native clients is a separate implementation step; retain their behavior, semantics and token roles when doing so.
