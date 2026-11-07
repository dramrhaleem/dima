# Product — Dima / ديمة

<!-- impeccable:product-schema 1 -->

Status: agreed B0–B7 web beta implemented and deployed at https://dima.study, 1 November 2026. Essential hosted checks passed; no load certification or native APK. This independent learning product does not share Kanaf accounts, data, or credentials. Current scope is authoritative in [PRD](docs/PRD_AR.md); the static reference package is historical design evidence, not a production application.

## Platform

Responsive English/LTR web first; later Android via Capacitor on the same backend. Android feasibility checkpoints precede the full mobile release. See [Android decision](docs/ANDROID_DECISION_AR.md).

## Stack

Next.js, React and TypeScript with Cloudflare Workers and Supabase PostgreSQL/Auth/Realtime. Runtime adapter and standalone client bundling passed local verification. Hosted Auth, private Realtime, scheduled jobs and essential account flows were verified; capacity under load and actual Android behavior remain unverified. Domain logic and `/api/v1` contracts remain independent of React screens and Server Actions. Supabase migrations are versioned. Domain `dima.study` is registered at Spaceship; Cloudflare DNS/Workers serves HTTPS and Supabase supplies the backend. Support email has incoming forwarding, not an outbound mailbox.

## Users and purpose

- Independent learners turning one or several externally hosted courses into daily work within shared availability.
- People returning after missed days who need a feasible recovery plan without erased progress.
- Learners seeking quiet public course/topic rooms and optional competition.
- Work-only users who log focus sessions without course or project-management requirements.
- Contributors and reviewers for a shared course library.

Success is a meaningful completed activity or correctly recorded focus session, a truthful saved state, and a next step that fits the person's capacity. Time, course completion, scheduling effort and social visibility are separate concepts. No claim of proven learning gains or demand has been established.

## Confirmed scope

Open signup for an initially small audience, private detailed progress with default-on, individually hideable leaderboard name and score, public library plus private course creation, reviewed publication, multi-course plans and explicit recovery previews, solo and group Pomodoro, work sessions, optional global hours and comparable course boards, accepted follows with specific sharing grants. Google PM and CS50 Business are the initial source-reviewed offerings; the dated audit and public-source limitations are in docs/research/B2_COURSE_AUDIT_AR.md. Do not assume every new user has the founder's prior progress or deadlines.

Shared room cycles can be started explicitly by any member with valid membership and control; moderation stays separate. Phase changes follow the shared clock, while each person explicitly joins each focus round. Optional browser-local sound alerts require audio activation and can be muted; no guaranteed closed-tab notification delivery.

No video, microphone, unrestricted chat, work project management, provider-progress sync, course video hosting, paid subscriptions, or AI planner in the initial release. All P0 requirements, including rooms and recovery, are required for the complete web beta; a staged alpha must be named honestly.

## Operating context

People use phones and computers, may switch devices, open course resources externally, miss planned days, or lose connectivity. The server is authoritative for permissions and credited time. Only allowed offline operations enter a per-account queue and remain visibly pending until confirmed. Background suspension does not imply successful notification delivery, continued room presence, or automatic participation in another round.

## Brand and visual authority

The approved Arabic wordmark with orange dots and soft-step book icon is preserved as supplied vector artwork. Do not redraw or typeset it, add glow, or substitute a Latin logo. The user chose a lively, motivating identity and retained the name after an adjacent same-name service was disclosed. Trademark clearance and exclusive rights are not established by the asset package.

The visual authority is [DESIGN.md](DESIGN.md), the byte-identical [reference landing](assets/reference-ui/prototype/landing.html), [tokens](assets/reference-ui/foundations/tokens.json), and [asset provenance](docs/evidence/B0_ASSETS.md). Public landing pages can be expressive; learning and focus surfaces prioritize the next action and calm clarity. The parent task's internal technical proof screen is not a replacement landing design.

## Product principles

1. A shared curriculum never makes a personal plan public.
2. Completing a timer does not complete a lesson.
3. Recovery changes future allocation, preserving past work and declared limits.
4. Saved, pending sync, failed and conflict are distinct states.
5. Leaderboards show eligible positive scores by default, with a persistent hide choice per board. Existing explicit hiding is preserved; private details and other sharing choices stay separate. Competition uses explained, comparable measures.
6. One account has one active focus session across devices and modes.

## Accessibility and motion

Keyboard and touch access, visible focus, text alongside status colors, readable responsive layouts, reduced motion and WCAG 2.2 AA are implementation targets requiring verification. Avoid timer announcements every second. Keep primary actions usable above mobile navigation and keyboard. Do not claim conformance from tokens or a single automated scan.

## Sources and ownership

- [PRD](docs/PRD_AR.md): scope and product decisions.
- [Screens](docs/SCREEN_SPEC_AR.md) and [B0 first-journey states](docs/B0_UX_STATES_AR.md): navigation, states and interaction contracts.
- [Recovery](docs/RECOVERY_AND_PROGRESS_SPEC_AR.md) / [Rooms](docs/ROOMS_AND_FOCUS_SPEC_AR.md): behavioral invariants.
- [Architecture](docs/ARCHITECTURE_AND_DATA_AR.md): server contracts and data ownership.
- [Implementation plan](docs/IMPLEMENTATION_PLAN_AR.md): stage scope and acceptance dependencies.

This file summarizes established decisions; it does not authorize publishing, service purchases, or reuse of another project's secrets. Current implementation evidence belongs in [B7](docs/evidence/B7.md) and [B6](docs/evidence/B6.md); earlier stage records are retained.
