# B5 — rooms interaction surface

Status: UI implementation and 26 distinct local browser journeys passed across retained runs on integrated snapshot-first build `cd96afe1ae85637e8803d033cc1b1bbb7245eac4bb68e17f28c0ee9ca12cbaa0`, DB030. The [acceptance index](../evidence/B5_BROWSER_ACCEPTANCE.json) maps 18 Rooms journeys and 8 affected B4 Focus regressions to exact titles, reports and hashes. The overall B5 API, Realtime and load gate is tracked separately by the root agent. Scope follows RF01–RF22 in `ROOMS_AND_FOCUS_SPEC_AR.md`, Focus/Rooms in `SCREEN_SPEC_AR.md`, and the B5 gate. No B6 social profiles, leaderboards, chat, microphone or camera UI.

## Navigation and entry

Focus retains the main navigation slot and gains Solo / Rooms links. Public `/rooms` and `/rooms/:id` show the same public directory/detail projection as signed `/app/rooms` and `/app/rooms/:id`: title, topic or approved offering, language, preset, current phase and reserved/connected counts. No participant names or private activities exist in this projection. Filters stay in the URL; cards lead to detail, never membership.

A visitor's Join action leads to authentication with `/app/rooms/:id` preserved. After authentication, an unchecked visibility acknowledgement explains that members can see the user's display name and declared focus state. Join creates Watching only. The alternative is Solo. Course People links filter by the approved offering; joining a room never enrolls the course or changes the private plan. Private-course People offers general topic rooms without publishing its title.

`/app/rooms/new` asks for topic or approved offering, title, optional description, language and a supported preset. It shows similar existing rooms and a public-fields preview before submission. No arbitrary URL, attachment or private-course publishing. Creation limits come from the server and preserve the form on rejection. Creation never starts a run or personal time. The aligned decision is an explicit-consent owner membership in Watching state, created atomically with the room. An existing live membership or TimeSession rejects creation before room or quota writes; the UI explains the precondition and retains form input.

## Room composition

The room header contains Back to rooms, title, topic/course, rules and a compact action menu. Desktop places a group-phase panel beside My participation; mobile places personal controls first, followed by the group phase and participants. Native buttons, forms, dialogs and disclosures reuse Dima's paper/cobalt visual system and B4 styles; no new decorative animation or dependencies.

- **Group panel:** Lobby / round number of four / Focus / Short break / Long break / Completed, the server-anchored phase remainder, and fixed-run preset. This clock is never labelled as earned time.
- **Personal panel:** Watching, Focusing, Paused personally, waiting for next round, reconnecting or removed. B4's provider, time ledger, controls, summary, pending-stop outbox and persistent strip remain authoritative. Optional task selection stays private; optional public intent comes only from the neutral supported list.
- **Participants:** only the currently authorized member projection. Name, declared state and role; no email, course progress, private title or fabricated avatar/person. Connected and reserved seats are separate. On small screens the participant list follows the immediate controls and keeps native per-person action disclosures.
- **Persistent navigation:** changing page does not leave membership or stop time. One shared strip leads back to the room or personal saved record; Watching also needs a return-to-room affordance without pretending time is running.

## Explicit transitions

| Current situation | Main action and effect |
|---|---|
| Watching in Lobby | Host starts a four-round Run; everyone remains Watching until their own Join round |
| Focus phase, not participating | Join remaining time, with exact remaining duration; Wait for next round changes no time |
| Less than one minute remains | Recommend waiting, still allow explicit remaining-time join |
| Personally focusing or paused | Reuse Pause / Resume / Finish; only personal time changes; room keeps its boundary |
| Break | Show personal saved summary separately; encouragement is quiet and rate-limited; no focus time or pre-joined next round |
| New focus phase | New explicit Join this round; no automatic personal session |
| Finish then join same round | A new Session starts now under existing participation; never reopen the old Session |
| Active Solo then join room | Review Finish solo and join; atomic server switch creates Watching only |
| Move between rooms | Review Leave and join; server validates target capacity before changing old membership/time |
| Start Solo while in room | Explicit setup and atomic leave/finish/start; failure preserves prior state; Needs review must be resolved first |
| Membership expired | Hide private roster; explain seat release while own accepted time remains; explicit Rejoin with fresh capacity check |
| Room full | Keep existing membership/time untouched; choose another room or Solo; no invented queue or forced seat |
| Leave | Explicit membership/time end at server boundary; personal summary and return-to-task link remain |

No start, join, resume, switch or membership renewal is invented offline. HTTP can recover when Realtime alone fails; complete offline state labels clocks estimated and retains B4 stop intent. Pending stops must resolve before a conflicting new session. Rejoin does not duplicate an existing active session or reclaim a transferred host role.

## Roles and moderation

Server capabilities decide available actions. Owner edits public fields or the next-run preset and may close new admissions. Active-run settings remain unchanged. Host can offer transfer; the recipient must accept. Take host appears only when server-authorized, never from a guessed client absence timer. Leaving host does not stop the run.

Remove, room ban, report and bilateral block use explicit named dialogs with allowed reasons and clear effects. Blocking filters permitted identity/interaction data; it does not claim to remove someone from the room. Report confirmation promises recorded submission, not completed moderation. Closed rooms finish an existing run and admit nobody new; Suspended ends participation at the server boundary; Archived stays historical with alternative-room links. Existing valid personal time stays visible in Activity.

## Implemented integration boundaries

1. Exact public directory/detail, own membership and authorized room snapshots; phase timestamps, counts, roles/capabilities, consent version, control identity and lease expiry. Public and private caches remain separate.
2. Command types and receipts for create/join/rejoin/leave/run/round/switch/host/moderation; authoritative room and time revisions; transient retry identity and terminal conflict codes.
3. One coordinated room-presence/time-control renewal policy using B4's per-tab identity, including Watching across navigation and explicit transfer. No independent competing control loops. Both room takeover and the existing time takeover synchronize a live same-room controller; taking control of expired-seat personal time must never revive membership.
4. Private Realtime subscription/auth contract with version/phase/count-only invalidations. Root owns environment setup; UI coalesces snapshot refreshes, shows last synchronization, unsubscribes and clears owner state on account change, and immediately clears roster on expiry/removal/permission denial. Permission-generation checks must reject previously in-flight snapshots after that clearance; an old successful response cannot repopulate the roster.
5. Atomic switches must refresh the existing B4 TimeData; group clocks never create another personal ledger. Expired-seat users retain their own time surface without roster access.

## Acceptance evidence pending

`tests/e2e/rooms.spec.ts` contains 18 browser journeys, all with passing evidence in the current acceptance index. Historical initial/corrected failures are recorded below and remain preserved. Real local synthetic accounts and independent browser contexts cover public-to-auth return, explicit consent/Watching, late JoinRound, personally paused versus group clock, boundary/break/no-auto-next, private task separation, full/rejoin/switch, host transfer/claim/leave, removal/block/report visibility, expired roster with retained personal time, offline-stop continuity and account isolation. UI evidence at 320/375/768/1280 accompanies actual state assertions; root/backend own RF accounting, concurrency and load coverage. The guarded fixtures only alter isolated `b5-*` synthetic identities. Full-capacity UI coverage uses 19 additional real authenticated joins, not fabricated roster rows. These results establish the tested local UI behavior and rendering; they do not establish 100-client load performance or production acceptance.

## Component grounding

Current `DESIGN.md` and the latest light-only workspace decision govern styling. A 21st metadata search reviewed [Filterable Blog Index](https://21st.dev/@olewandowski1/components/blog-3) (28562), [ComboBox](https://21st.dev/@hero_ui/components/heroui-combo-box) (13913), and [Flexi Filter Table](https://21st.dev/@ruixen.ui/components/flexi-filter-table) (7466). Filtered cards and explicit labelled filters fit; featured marketing cards, a large filter framework and chat/avatar stacks do not serve the room's real capacity/permission state. Existing directory cards, native selects, disclosures and dialogs are sufficient. No component source was retrieved, generation called or dependency added.

## Source ownership

`rooms-provider.tsx` coordinates account-scoped state, snapshot permission epochs, keyed in-flight reads, transient operation retries, one presence heartbeat and Realtime grant renewal. `rooms.tsx` and `rooms.css` implement public and signed surfaces. The existing Focus provider remains the only personal time/outbox/strip owner; room commands feed its authoritative TimeData. Public room routes and course People use compact approved offering metadata. Backend, signer/adapter and operational environment are independently owned and verified in the B5 gate.

## Preliminary public visual review — 2026-11-01

Read-only inspection of the first B5 local build, during backend API verification; no browser sign-in, membership or synthetic fixture mutation was performed. These are preliminary captures, not the final B5 acceptance set.

- [320px directory](../../.impeccable/review/b5-directory-320.png), [375px directory](../../.impeccable/review/b5-directory-375.png), [768px directory](../../.impeccable/review/b5-directory-768.png), [1280px directory](../../.impeccable/review/b5-directory-1280.png): actual public synthetic room projection, no participant identities; document scroll width equals viewport width at all four sizes.
- **Pending bounded fix:** the inherited global `label { margin: 20px 0 8px }` inflates the filter panel to approximately 435px at 375px. The first room begins around 1006px down the page. Reset `.room-filters label` margins so useful room content is reached sooner.
- **Pending bounded fix:** public `Study rooms` repeats the directory hero heading. Reuse the existing visually hidden public-title treatment already used by the Library, retaining an accessible page heading while reducing duplicate visual hierarchy.

Root requested both fixes be batched after API/browser findings. App source remains frozen until that batch is approved.

### Responsive filter implementation awaiting rebuilt validation

Keep the labelled search field visible. At mobile widths, pair a compact Filters button with the submit button; language/course controls stay in a collapsible region with `aria-expanded` and `aria-controls`. The selected values remain mounted and retain drafts. Expanding places the submit action after the controls in keyboard and visual order. Show the count of applied language/course URL filters, without claiming unsubmitted changes are active. Desktop retains the inline four-column form. Reuse the existing inputs/buttons and CSS media queries; no dependency, auto-join action or new filtering API is needed.

The read-only public filter probe also passed: submitting search plus language updates the URL, renders the true empty state, retains the submitted query and clears filters back to `/rooms`. The probe uses the combobox's accessible name; an initial exact `getByLabel` selector included option text and was corrected after inspecting the accessibility tree. No app change was needed for that selector mismatch.

## Corrective source batch awaiting rebuilt validation

- A same-room private snapshot rejected because a newer equal-revision `/me` response has arrived had no bounded follow-up in the initial build. The held real snapshot/newer real `/me` browser case reproduced missing controls after five seconds with Realtime unavailable. The source now preserves freshness rejection and permits one owner/membership/control/permission-epoch-guarded retry after the old flight completes.
- The initial build disabled Report and Block during pending personal-stop reconciliation. The source now permits those two online actions with existing permission, target and confirmation checks; leave/switch/new-time guards remain. The offline-stop journey now exercises both actions before reconciling the stop.

## Initial browser results and corrective scope

[Initial browser report](../evidence/B5_BROWSER_INITIAL.json) preserves all 12 results: 6 passed and 6 failed. Passing journeys cover atomic room-to-solo switching, delayed old-room and pre-block snapshot rejection, host acceptance/departure/reporting, late-round/break/no-auto-next behavior and expired-seat rejoin without duplicate time or host-role reclamation.

Confirmed UI failures: the HTTP fallback race above; explicit Room Finish saved time but its child unmounted before its navigation callback; and the pending display advanced once while its one-second UI tick caught up to the precise stop instant. The source now owns explicit Finish navigation in the persistent account provider, checks the target session and unchanged originating route, and freezes the pending display directly at its reported instant. Offline/background settlement still does not redirect. Activity now labels room-mode records as Room focus.

Harness corrections retain all behavioral assertions: await the accepted Focusing state after Resume, scope validation alerts outside Next's route announcer, and retry one transient timeout while reading the same synthetic OTP without sending another email. The capacity journey's original run stopped at that local inbox timeout; capacity is not yet claimed verified by browser evidence.

The joined-room captures showed live controls below the first viewport. The corrective source uses a compact member header with expandable descriptive/next-preset details, personal participation before the group clock on mobile, and no repeated pre-join disclosure after membership. Only the own participant row can use newer accepted own TimeData; peers remain private-snapshot projections. The original mobile capture briefly showed Watching while its accepted personal panel showed Focusing; the later desktop capture showed Focusing without a 30-second wait. New captures must verify the corrected immediate consistency and geometry.

Root measured existing-build unique raw route-reference chunks: Auth 224,212 bytes and App 226,110 bytes, versus B4 Auth 166,164 / App 168,063 (about 58KB added). These measurements exclude framework chunks, CSS, compression and network behavior; they are not page-load measurements. B7 should split Auth from the entire AccountApp/learning/focus/rooms module. No route-splitting work is part of this corrective batch.

## Corrected-build verification (gate still open)

[Corrected browser report](../evidence/B5_BROWSER_CORRECTED.json): 19/21 passed (all eight affected B4 cases and 11 of13 Rooms journeys). This verifies the fixed pending display, same-round re-entry, real20-seat capacity handling, Report/Block during reconciliation, explicit Finish summary, and no redirect after navigating away during a held successful Finish response. The initial report remains unchanged.

The two remaining cases are preserved: Close checked public state while its dialog still said Saving; the test now awaits the actual dialog completion. The held-/me test exposed a signed-directory null dereference introduced by compact-header detection. [Reproduction](../evidence/B5_FALLBACK_REPRO.json) records `Cannot read properties of null (reading 'membership')`. The one-line source fix requires a detail route before testing membership. Its pending final checks cover both initial `me:null` and successful `membership:null`; the keyboard filter capture is also included in the targeted rerun. No further UI expansion is planned for this gate.

Rendered review: current `.impeccable/review/b5-focus-small.png`, `b5-focus-mobile.png`, `b5-focus-tablet.png`, `b5-focus-desktop.png`, `b5-offline-mobile.png` and `b5-directory-final-mobile.png` were visually inspected. At375px the first directory card is now around690px down, versus about1006px previously. Current controls fit320/375/768/1280 widths without horizontal overflow. Mobile personal participation precedes the group clock; the persistent strip remains above bottom navigation. Full-page screenshots include its fixed viewport overlay; tested main controls remain reachable by scrolling. The offline view distinguishes frozen local-stop display from the still-authoritative server record.

The root visual review then identified an initial-viewport issue: the fixed strip obscured the main personal clock despite scroll access. The final approved source adjustment replaces the generic workspace hero with the joined room's sole h1/focus target, tightens only joined-room spacing and puts personal controls first through the800px mobile-navigation breakpoint. The next build must pass explicit clock/action bounds above the strip at375×812,320×812 and 768×812. This rendered check remains open; the preceding captures do not establish that acceptance criterion.

## Earlier targeted browser verification, before the coalescing correction

[Final report](../evidence/B5_BROWSER_FINAL.json):4/4 passed on build48377, preview76927, in14.6 seconds. At that checkpoint,21 distinct cases had passing evidence:13 Rooms and 8 B4 Focus regressions. The current acceptance index below supersedes that checkpoint while retaining its historical reports.

The final run verified the no-membership directory after successful `/me`, the held initial `/me` state and bounded private-snapshot recovery without Realtime, settled Close, keyboard-operated responsive filters and the final joined-room composition. At320×812,375×812 and 768×812 the measured main clock and primary actions end at least8 CSS pixels above the persistent strip. Exactly one h1 is present and retains `workspace-title`. Viewport captures `b5-focus-fold-320.png`, `b5-focus-fold-375.png` and `b5-focus-fold-768.png` were visually inspected: the main time and controls are visible without scrolling. Earlier full-page overlay concerns are resolved for these tested normal-title states. Long titles, expanded details and notices intentionally add content and remain scrollable; no universal above-fold claim is made for arbitrary content.

Source check: TypeScript and scoped ESLint passed after the final source/test changes. This is local synthetic functional/rendered evidence, not a deployment or production-load claim. No further source edits are pending from the UI agent.

## Historical coalescing and combined-build verification

In the earlier combined build, the Realtime effect owned one awaited `/me`→private-snapshot refresh chain. Every hint immediately invalidates the permission epoch and marks the chain dirty. A 120ms coalescing timer starts a chain when idle; hints arriving during it schedule one trailing refresh after it settles. Connected and invalidation callbacks share this mechanism. The existing single bounded stale-snapshot retry is now awaited, with its old flight removed before recursion. Owner liveness, effect abort, online status, matching room/membership/control and live lease are checked before the next leg and trailing schedule. Explicit user/action/initial-view reads retain their existing independent behavior; this is not global serialization of every Rooms request.

A hint is not a permission verdict. It invalidates in-flight responses immediately; confirmed denial/removal or lease expiry clears the rendered roster. Late responses cannot repopulate a cleared or newer permission scope.

The [combined 23-case run](../evidence/B5_BROWSER_COMBINED.json) passed 21 cases and preserved two harness failures. One test held the initial Connected refresh while expecting another automatic refresh to finish; it now tracks actual startup reads and requires a bounded quiet interval before holding its intended independent request. Its original automatic Block→hidden-before-release assertion remains, with own-member visibility asserted before and after release. The other test omitted the existing room-presence sign-out confirmation; it now acknowledges that dialog before testing unmount. No app change was needed after this run.

[Six affected cases](../evidence/B5_BROWSER_COALESCER_FINAL.json) passed in 33.0 seconds. The [strengthened stale-policy case](../evidence/B5_BROWSER_POLICY_FINAL.json) passed in 7.4 seconds. The [preserved 23-case acceptance index](../evidence/B5_BROWSER_ACCEPTANCE_BEFORE_SNAPSHOT_FIRST.json) maps 23 distinct passes: 17 from the combined run, 5 from the affected rerun and 1 from the strengthened policy rerun. All historical failed reports remain linked and hashed.

Measured browser assertions:

- Four real SDK hints while a snapshot was held produced two `/me` reads and two snapshots total: one original chain and one trailing chain. Maximum concurrent tracked reads was 1. The latest roster hid the blocked identity and retained the current member.
- After authoritative revocation and account unmount/switch, old-owner read count stayed 2→2; no trailing old-owner request or private roster appeared under the new account.
- The strengthened stale-policy case recorded four startup reads, zero pending reads and 663ms of quiet before the deliberate hold. The newer filtered roster remained visible before and after releasing the older response.

TypeScript/scoped lint passed for the coalescer source; the combined browser run also repeated the responsive, timer, offline, capacity, takeover and recovery regressions. This aligns browser coalescing with the load harness's existing single-flight behavior. It does not itself resolve or explain measured SQL deadlocks or 100-client latency. Those remain separate root/backend acceptance work. No UI source or runtime changes followed this verification.


## Current snapshot-first refresh and verification

Known-live Realtime refreshes and normal secondary polls now read the authoritative private snapshot directly and apply its embedded RoomMe. Bootstrap, unknown/expired membership, foreground, personal-time and phase-boundary revalidation retain their existing paths. A changed controller or denied private read requires bounded own-membership reconciliation; the old request cannot follow a new account/room/generation. Only an accepted private snapshot establishes version coverage. Novel hints immediately fence older responses; duplicate/older versions cause no extra request. An uncovered failed version retains one delayed retry at its original deadline, checking the latest wanted version when it fires. No user action, accepted time or automatic round participation is added.

The [initial integrated run](../evidence/B5_BROWSER_SNAPSHOT_FIRST.json) passed 25/26: all 18 Rooms and 7 B4 cases. The remaining B4 case failed inside Playwright's datetime-local setter when Chromium canonically omitted optional zero seconds. A [standalone native-input proof](../evidence/B5_DATETIME_FORMATTER_PROOF.json) confirmed this without application requests; the test formatter now preserves that canonical representation, the same instant and nonzero seconds. The [affected rerun](../evidence/B5_BROWSER_SNAPSHOT_FIRST_FORMATTER_FINAL.json) passed. All 26 distinct cases are mapped by the current index, with the original failure and previous 23-case index preserved.

The separate [representative request trace](../evidence/B5_WORKLOAD_FIDELITY.md#v2-snapshot-first-profile--representative-browser-verification) passed on two real browser contexts. It confirms snapshot-only known hints/secondary polls and retained time/phase/learning reads, with all 109 request outcomes resolved. This is functional/request-fidelity evidence, not 100-client performance or production approval. No application source, runtime restart or load execution occurred in the UI verification window.

## Bounded room-flow refinement — 2026-11-01

Source changes preserve the existing Operate surface, paper/cobalt identity, server clocks and separate room-membership/personal-focus transitions. Findings came from current component behavior and the retained joined-room mobile capture; this entry does not claim a new browser or production pass.

- Directory cards now describe the active run's preset when a run is active. Previously an owner changing the next preset made the card describe the wrong rhythm beside the current phase. Labels explicitly distinguish focus and short-break minutes.
- The applied approved-course title stays visible beside Clear filters, including when mobile filter controls are collapsed. Create-room links keep the previously implemented validated-course context and existing draft precedence.
- The create form removes doubled inherited label spacing. Preview moves keyboard focus to a named public-details review region, followed by the existing create action. Visibility consent remains explicit and unchecked initially; creating the room does not repeat it on entry or start time.
- The host's Start action lives with the personal next-step explanation, once only. Start still starts the shared run alone; the subsequent Join this focus round remains the only action that starts personal time. A shared-course room defaults this private choice to Learning, while allowing Work and linking no task automatically.
- A full room offers Check for a seat and Find another room before asking for consent. The refresh reloads public availability and own access. Once capacity becomes available, visibility consent is still unchecked and Enter is disabled until the user grants it. Switching still retains the separate acknowledgement of ending existing focus/membership because that has a different consequence.

`tests/e2e/rooms-refinement.spec.ts` adds three bounded local journeys: course creation/preview/host Start with zero personal time, active-preset accuracy after editing the next preset, and full-capacity recovery without a membership write. Only the last test simulates the public capacity projection; it is a UI recovery test, not a replacement for the retained real twenty-seat capacity evidence. The tests capture desktop and mobile states for the integrated visual pass. Scoped ESLint passed; build, browser execution and integrated visual verification belong to the root delivery pass and were not run by this source owner.

## Member-started cycles — 2026-11-01

The user explicitly requested removing the dependence on a host. Any member with a live seat and correct controller may now Start shared cycle while the room is ready. Existing room locks, versions and the single-active-run constraint determine one winner. Starting never changes the moderator or starts personal time. Owner/moderator tools are separate from the clock; moderator recovery is a secondary disclosure. A four-round path shows actual focus/break/done states; it is shared-cycle progress, not earned personal time. Optional sound announces fresh accepted phase transitions. Text chat remains a scoped proposal in `docs/ROOMS_EVOLUTION_PROPOSAL_AR.md`, not a shipped capability.
