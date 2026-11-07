# Dima native UI kit

Eight reusable UI patterns for the existing HTML/CSS/JavaScript product. No framework, runtime package, CDN or service is required. Load the shared Dima foundations before this kit; the fonts and semantic light/dark colors remain owned by the foundations.

```html
<link rel="stylesheet" href="foundations/tokens.css">
<link rel="stylesheet" href="ui/dima-ui.css">
<script src="ui/dima-ui.js" defer></script>
```

Paths above are relative to the delivery root. Adjust `../` when importing from another directory. Use modern browsers with custom elements, native dialog and Web Animations support. Basic content remains visible without animation support. This kit is plain web UI, not a native iOS/Android implementation; the companion foundation tokens can inform those clients.

The classic script exposes exactly three public methods:

| Method | Contract |
| --- | --- |
| `DimaUI.init(root = document)` | Idempotently attach enhancement to existing content; call after replacing a page region. Custom elements initialize themselves. |
| `DimaUI.replay(element)` | Replay the short reveal; returns its animation when motion is allowed, otherwise does nothing. |
| `DimaUI.openCommands(items, trigger)` | Open or update the native destination dialog; return the dialog element. |

## 1. Uneven path field

```html
<section style="position:relative;overflow:hidden;min-height:400px">
  <dima-path-field></dima-path-field>
  <div style="position:relative">Your foreground content</div>
</section>
```

Eight thin, rounded, uneven stair paths evoke repeated effort. The field is decorative, hidden from assistive technology, noninteractive and absolutely positioned. Give its parent a meaningful height and keep it away from dense reading surfaces. No gradients, glow, canvas/WebGL, network assets or logo modifications. Animation pauses out of view and in background tabs, and stops through the motion control or system reduced-motion preference. At rest, the geometry remains visible. The field has no essential information.

## 2. Magnetic action label

```html
<a href="prototype/index.html#setup" data-magnetic>Build my study plan</a>
<button type="button" data-magnetic>Preview my next step</button>
```

Add this only to one or two principal actions. It moves the inner label by at most 4px total with a mouse/fine pointer. The actual clickable target, focus outline and layout stay fixed. Touch, keyboard focus, disabled controls and reduced motion have no movement. Existing visual button styles remain the integrator's responsibility. The component wraps existing children in `.dima-magnetic-content`; do not replace those children after initialization without preserving this wrapper.

## 3. Visible-first reveal

```html
<h1 data-reveal>Small steps. Lasting progress.</h1>
<button type="button" id="replay">Replay introduction</button>
<script>
  document.querySelector('#replay').addEventListener('click', () => {
    DimaUI.replay(document.querySelector('[data-reveal]'));
  });
</script>
```

The first viewport entry gets a 360ms settling movement. The entire text node stays intact for selection, translation and assistive technology; words and Arabic characters are not split into hidden duplicates. Content is fully visible in the default CSS, before JavaScript, and after cancellation. Use one authored introduction, not identical reveals on every task or section. The replay listener must run after the deferred kit has loaded, e.g. in the app's deferred script.

## 4. Task completion ring

```html
<div class="completion-summary">
  <dima-progress value="25" label="Sample task completion">25%</dima-progress>
  <p>1 of 4 sample tasks completed</p>
</div>
<script>
  document.querySelector('dima-progress').setAttribute('value', '50');
</script>
```

An accessible `progressbar` has an explicit label, minimum 0, maximum 100 and clamped numeric value. Invalid/nonfinite values become 0. Display precision is one decimal place at most. The visible percent supplements the adjacent exact task count; it does not replace it. There is no invented increase or automatic completion. Use this for task completion, not study hours or ranking eligibility. Default size is 88px; set `--dima-progress-size:72px` on the element for a smaller supporting indicator. Keep adjacent content honest about sample/local data.

## 5. Setup steps

```html
<dima-steps current="2"
  labels="Choose course|Set rhythm|Review plan"></dima-steps>
```

`current` is **1-based** and clamped to the supplied nonempty labels. The native ordered list names every step and gives only the current item `aria-current="step"`. Earlier positions are visually marked as previous, not asserted as validated/completed. The indicator has no click handlers and does not implement a wizard or change user data. Keep validation, Back/Continue controls and actual screen state in the application. At widths of 520px and below the sequence stacks vertically.

## 6. Command destinations

```html
<button type="button" id="quick-nav">Quick navigation</button>
<script>
  const trigger = document.querySelector('#quick-nav');
  trigger.addEventListener('click', () => DimaUI.openCommands([
    {label:'Today', description:'Return to your next task', href:'#today'},
    {label:'My courses', description:'View your personal course plans', href:'#courses'},
    {label:'Component studio', description:'Preview the reusable UI kit', href:'studio.html'}
  ], trigger));
</script>
```

Run the listener setup after the kit script. The native modal dialog traps focus, has a labeled searchable combobox/listbox, arrow-key selection, Enter navigation, native Escape dismissal, Close button and trigger focus restoration. A no-result search reports an actual empty state. Results use plain text; blank names and unsafe URL schemes are rejected. Relative, HTTP(S) and local-file destinations are accepted for this local package. Selecting an item closes the dialog before navigating, including a same-hash selection. The kit does not attach a global shortcut: the application may attach Ctrl/Cmd+K while avoiding conflicts with editable controls. It does not provide fabricated AI, cache clearing, account settings, history or database mutation actions.

## Global motion control

```html
<button type="button" data-motion-toggle>
  <span data-motion-label>Motion on</span>
</button>
```

The button's visible label and pressed state track whether decorative motion is enabled. Its state controls `document.documentElement.dataset.dimaMotion` (`on` / `off`). The effective state also honors `prefers-reduced-motion` and tab visibility. A system request for reduced motion takes priority; the button says “Motion off · system” and exposes `aria-disabled="true"`. This is an in-page preference; it is not claimed to persist across sessions or accounts. All matching buttons are synchronized. If the button contains an icon, retain the `data-motion-label` span so updating text preserves it.

## Theme, integration and verification

- Use the existing `[data-theme="dark"]` semantic token overrides. No second palette is introduced.
- The kit scopes styles to its custom elements/classes. It does not re-style existing app navigation, logo, forms or buttons, except their requested enhancements and focus states.
- The path field and reveal are for deliberate public/studio moments; working pages should mainly use the progress, steps and command navigation.
- `init(main)` may be called after every render. Existing DOM listeners are deduplicated. Keep modal triggers connected for meaningful focus restoration.
- Navigation labels and application routes are supplied by the caller. No fake authentication, persistence, leaderboard verification or course enrollment is implemented here.
- JavaScript syntax is checked with `node --check ui/dima-ui.js`. Visual, responsive and keyboard behavior requires the delivery's browser QA; it is not established by this syntax check alone. Consult the delivery QA record for the checks actually performed.

## Provenance and reuse

| Native component | 21st reference | Adaptation |
| --- | --- | --- |
| Magnetic label | [Mohammad Shehadeh / Hirael](https://21st.dev/@mohammadshehadeh/components/magnetic-button), MIT | Cursor-center attraction, clamped and restricted to inner content; native events replace React/Motion. Original source notice retained in JS. |
| Completion ring | [Dillion Verma / Magic UI](https://21st.dev/@dillionverma/components/animated-circular-progress-bar), MIT | SVG circumference-based progress becomes a bounded, labeled native custom element. |
| Reveal | [ddoemonn](https://21st.dev/@ddoemonn/components/text-reveal), MIT | Viewport-triggered settling; native animation, intact text and default-visible content. |
| Steps | [Origin UI](https://21st.dev/@originui/components/stepper), MIT | Sequence and current-state pattern become a noninteractive semantic ordered list. |
| Path field | [uniquesonu](https://21st.dev/@uniquesonu/components/animated-svg-background), license unresolved | Independent Dima path geometry and CSS implementation; no original source/path data copied. |
| Command dialog | [rafa-porto](https://21st.dev/@rafa-porto/components/command-palette), license unresolved | Independent native dialog/search implementation of the general command-palette pattern. No original source/layout copied. |

The source retrieval archive and full license/provenance record are maintained outside this runtime folder. Preserve upstream notices when reusing adapted work. These are reusable project assets, **not a claim of exclusive ownership** over third-party components or general interface patterns. Do not publish the private raw catalog archive as your component product.


## 7. Interactive product preview

Load `ui/preview-switcher.css` and the deferred classic script `ui/preview-switcher.js` after the shared foundations. The core kit supplies shared motion controls when present.

```html
<dima-preview-switcher app-href="prototype/index.html#setup"
  active="learn"></dima-preview-switcher>
```

`app-href` defaults to `index.html#setup`, relative to the embedding page. `active` chooses the initial `learn`, `plan` or `recover` tab. After initialization, use `element.selectTab('plan')`; the bubbling `preview-change` event carries `{tab: 'plan'}` in its `detail`.

Learn exposes two sample checkboxes; Plan exposes sample study-day choices; Recover previews one of two sample choices. This state is isolated to the component and resets when the page reloads. It never changes saved workspace data. Tabs include proper relationships, a roving tab stop, arrow-key/Home/End navigation and a keyboard-focusable panel. The sample window intentionally uses its own light surface even inside a dark host page.

The current implementation contains Dima-specific sample content. It is reusable across Dima pages, not a generic schema-driven course renderer. Supply trusted application destinations. Adapt the content source deliberately before using it with a production catalog.

## 8. Course explorer

Load `ui/course-explorer.css` and deferred `ui/course-explorer.js` after the shared foundations.

```html
<dima-course-explorer library-href="prototype/index.html#library"
  active="0"></dima-course-explorer>
```

`library-href` defaults to `index.html#library`. `active` selects the initial 0 or 1 panel. `element.selectCourse(1)` selects the CS50 sample; the bubbling `course-preview-change` event carries `{index: 1}`. Click and focus open detail. Essential course identity, summary and library link remain visible in both states; at 700px and below the panels stack.

These are two seed offerings with pending outline review, not a claim of complete synced provider content, affiliation, enrollment or learner counts. Both links enter the app library. The component uses its own authored route/code geometry rather than downloaded catalog images.

The preview-switcher pattern was informed by [Ruixen UI](https://21st.dev/@ruixen.ui/components/preview-switch-hero); the course disclosure pattern by [vaib215](https://21st.dev/@vaib215/components/expanding-cards). Both runtime implementations are independent native code; their upstream JSX, copy and media are not included in the runtime. See `../catalog/ATTRIBUTION.md` for the full record.
