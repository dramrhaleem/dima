# Product — دِيمة

<!-- impeccable:product-schema 1 -->

Status: identity-system and local UI-prototype baseline, 31 October 2026. This isolated package belongs to the learning planner, not the Kanaf healthcare platform or partnership application. Product rules remain planned; the accompanying interactive prototype uses local demo data, not production accounts or a database.

## Platform

web

## Stack

Recommendation pending implementation selection: a responsive web client with a dedicated Supabase identity/database project. Public courses and opted-in rankings have separate read policies from private learning records. Do not create infrastructure or reuse Kanaf credentials as a consequence of this document.

## Users

- Independent learners managing one or more externally hosted courses alongside work.
- An initially small audience with open account registration.
- Course contributors requesting that their private course outlines become shared public catalog entries.
- A catalog reviewer administering publication and reports.
- Work-only users can record Work sessions and participate in the hours board without enrolling in a course.

## Product Purpose

Turn course objectives into manageable daily tasks, save progress across devices, recover coherently from missed days, and support learning alongside others. Log work and learning sessions for a separate hours ranking.

The primary daily success is completing the next appropriate piece of work with a trustworthy saved state. The primary long-term success is finishing the chosen course scope while retaining a realistic plan after interruptions.

## Positioning

The proposed mechanism combines course-aware ordering, personal multi-course capacity, reviewable recovery, shared catalog participation, and separately defined hours/progress boards. This is the design intent, not an established market advantage or validated demand claim.

## Operating Context

- English interface; courses open at their external providers.
- Personal progress is user-reported. No authorized provider progress integration exists.
- The user requested Google PM completion within at most three months and CS50 within a month; exact enrollment start/deadline dates are not yet supplied.
- Reported prior Google progress is through module two; interpreting that as module two of the first course must be confirmed during initial data entry.
- Daily planning is task/section based; logged hours are a separate record.
- People may study on a phone, change devices, read outside the app, miss a day, or work offline.

## Capabilities and Constraints

Confirmed by the user:

- Public signup, individual accounts, and persistent progress.
- Any user may create any course and plan from v1.
- Private course creation, public-library browsing/joining, and a request/review path to publish a course.
- Two seed public offerings: Google Project Management (a seven-course program) and CS50 Business (a standalone course).
- A global Work/Learning hours leaderboard and a leaderboard for each shared course.
- Recovery after delay; English UX; planning before coding.

Delegated design decision: eligible timer hours determine the default global ranking. Manual duration entries remain available separately. Private data is not made public merely by registration or course enrollment.

Planning recommendations: optional public participation, a canonical versioned curriculum, a deterministic scheduling engine, fixed course scoring rules, and a task-first home screen. Detailed rules and adjustable pilot defaults live in SYSTEM_SPEC.md.

## Brand Commitments

After disclosure of an existing same-name Islamic tracking/community app, the user explicitly chose to continue with ديمة and develop clear differentiation. The user selected a lively, motivating, competitive personality and a restrained explanation of the name inspiration in the brand story. On 31 October 2026 the user approved the original Arabic wordmark with orange dots together with the soft-step book icon, then commissioned the full visual identity and digital design system. Protect that artwork. The source palette relationship is approved; normalized HEX values and supporting UI rules are designer implementation decisions. The Latin transliteration Dima is a package/reference label, not a separately approved Latin wordmark or domain. The current branding record is [BRAND_BRIEF.md](../learning-brand-brief-20261031/BRAND_BRIEF.md).

Pace is the historical working name used in the planning documents. A former separate Arabic concept used SEKKA; the current English-interface/public/multi-course scope takes precedence and does not authorize merging that old project.

## Evidence on Hand

- PRODUCT_BLUEPRINT.md: the initial discussion blueprint and requirements provenance.
- Existing Google/CS50 public catalog snapshot in the adjacent output folder; its order and required/optional classification need a cleanup gate before seed publication.
- Public official product research and three selected public-site visual inspections, documented under research/.
- No observed account signups, retention, validated ranking fairness, deployed app, live database, or production user measurements for Pace.

## Product Principles

1. Shared curriculum, private plan and progress.
2. Completion, scheduling, and elapsed time are distinct records.
3. Recovery changes the future without rewriting the past.
4. State precisely what was saved, synchronized, or eligible for ranking.
5. Keep participation useful without requiring public ranking, a timer, or a written reflection.

## Accessibility & Inclusion

Proposed implementation baseline: keyboard and touch access, visible focus, text labels alongside status colors, reduced-motion support, readable mobile layouts, and WCAG 2.2 AA verification before public release. This is a target, not a conformance claim.

## Document ownership

- This file: product scope and confirmed facts.
- USER_JOURNEYS_AND_UX.md: user journeys, screen behavior, proposed composition, and UI copy.
- SYSTEM_SPEC.md: authoritative proposed rules, schema, and invariants.
- DELIVERY_AND_ACCEPTANCE.md: implementation sequence and release evidence.
- research/: external observations, limitations, and their implications.

This package delivers brand assets, a guide, reusable foundations, and a local UI design prototype. Local demo persistence is distinct from cross-device saving. Live authentication, database authorization, provider integrations and production operation require a later implementation and verification phase.
