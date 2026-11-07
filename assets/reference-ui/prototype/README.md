# Dima responsive interface prototype

A usable, code-led web/mobile design reference for the approved Dima identity. Interface controls are English; the original Arabic wordmark and book/stair icon are linked SVG assets. This is a static interaction prototype, not the production learning service.

## Open

Serve the **identity-system root**, so shared fonts, tokens and artwork remain available:

```bash
cd /media/amro/Data2/Kanaf/outputs/dima-identity-system-20261031
python3 -m http.server 8765
```

Open `http://localhost:8765/prototype/index.html`. The server is a local preview only. No package installation, build step, API key, or paid dependency is needed. Opening HTML directly may work, but local browser storage behavior can differ on `file:` origins.

- `index.html` — responsive app prototype, default Today view.
- `landing.html` — secondary public overview; calls to action open the demo, not signup.
- `components.html` — live buttons, forms, tabs, selects, feedback states, switches and theme preview.
- `styles.css` — responsive component/application styles over shared foundation tokens.
- `app.js` — representative sample data, views, interactions, local-only storage.
- `components.js` — showcase interactions, validation and keyboard tabs.
- `verify.mjs` — dependency-free structural/behavioral checks (Node).

## Navigation and views

Desktop: Today, My Plan, My Courses, Library, Activity, Leaderboards, Settings. Mobile: Today, Plan, Courses, More; More exposes the other destinations. A persistent Work/Learning session control remains above the mobile navigation.

Direct routes: `#today`, `#plan`, `#recovery`, `#setup`, `#courses`, `#library`, `#detail`, `#editor`, `#activity`, `#boards`, `#settings`, `#more`.

| Flow | Implemented demonstration |
| --- | --- |
| Today | Next task, four-item agenda, explicit completion/reopen, immediate Undo, sample progress |
| Planning | Shared daily workload and selected study days, target date and prior-progress choice persisted locally |
| Recovery | Two fixed alternatives: keep target or keep workload; explicit apply; completed history untouched |
| Courses | Ordered representative sample outline, progress tab, community boundary, provider links |
| Library | Two seed offerings, working search and empty result state |
| Private course | Required title/outline, safe text rendering, optional source validation, ordered preview, local private save |
| Publication | Explicit local request-draft status; no submission, reviewer or public write |
| Activity | Local timer history and separately labeled manual duration; neither is ranked |
| Rankings | Separate hours/course contexts, units and rules; honest empty state without invented people or scores |
| Settings | Persisted light/dark appearance and local privacy preference, JSON demo export, confirmed demo-only reset |

## Content and persistence boundaries

The four sample task titles, durations, sample week, and recovery scenario are **representative interface content**, not audited provider curriculum. Progress percentages cover only the two sample tasks for the selected offering, never an invented official course total. The Google offering is a seven-course program; CS50 Business is standalone. Provider links open the official provider information in a new tab; this does not enroll anyone or infer provider progress.

All data uses the single localStorage key `dima.identity.prototype.v1`. Reset touches only that key's content and in-memory demo state; it does not clear unrelated browser storage. Export contains only this demonstration state. No accounts, remote persistence, analytics, provider synchronization, or production service exist. Browser storage failure is disclosed. Same-origin tabs receive storage updates, but no production cross-device concurrency or trusted timer ledger is implemented.

Task completion and time are separate actions. A timer does not complete a task. Completion never adds duration. One local timer can run at a time; pauses stop accumulation, finishing records local elapsed duration, and each continuous interval is capped at four hours. All local and manual time is explicitly unranked. This is not evidence of attention or a production eligibility implementation.

Plan setup stores preferences; it does not solve a curriculum schedule. Recovery is a reviewable **fixed demo scenario**, not a feasibility engine. Publication prepares a local status only. No actual user prior progress is preloaded.

## Interaction/accessibility design

- Semantic buttons, native inputs/selects, explicit labels and status messages.
- Visible keyboard focus, skip link, readable text states beyond color, and reduced-motion styles.
- App and showcase tabs support arrow keys; showcase tabs use roving tabindex.
- Reflow breakpoints support 360px mobile through desktop; mobile controls remain reachable above navigation.
- Shared semantic colors from `../foundations/tokens.css` own light/dark themes; original logo artwork remains fixed.
- Primary buttons use the semantic primary/on-primary pair. Orange accent buttons use dark text.
- Local-only wording is visible in the shell and relevant flows. Prototype labels do not claim cloud saving.

## Verification

```bash
node --check prototype/app.js
node --check prototype/components.js
node prototype/verify.mjs
```

The structural check exercises all 12 view render functions, completion and reopening, separation of task/time records, duplicate timer starts, pause/finish, continuous interval cap, namespaced persistence, and escaping user-created titles. These checks passed at handoff. They do not prove layout, accessibility conformance, usability, production security, or operational readiness. Rendered desktop/mobile inspection belongs to the identity package's QA record.

## Implementation handoff

Reuse the foundation roles, component hierarchy, navigation, original SVG assets and local fonts in a future app. Replace demo state and fixed previews with independently verified identity, ownership policies, persisted events, curriculum versioning, scheduling and ranking services. Preserve the distinctions between personal completion, elapsed time, and eligible public credit. Keep the canonical product planning documents authoritative for those production rules.
