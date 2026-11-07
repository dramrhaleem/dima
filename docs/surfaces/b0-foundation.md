# B0 foundation proof

Mode: **Operate**. Status: implemented internal development surface, 31 October 2026.

## Job and scope

A developer uses a disposable test account to check that the shared React interface can authenticate, call the API, save a short label and reload the account's saved checks. The proof is used by the Next web build and standalone Vite client. It does not provide the learning platform, production registration/onboarding, or an Android APK.

Implementation: `packages/ui/src/foundation-panel.tsx` and `packages/ui/src/styles.css`. The approved landing remains separately preserved in `assets/reference-ui/prototype/landing.html`; this proof does not replace or redesign it.

## Visual and interaction contract

- Reuse the existing local foundation tokens, fonts and approved SVG logo. Warm paper, ink text, white form surface and cobalt primary action are the incumbent visual authority.
- Header states “Local development · B0”; introductory copy and footer distinguish the tool from production data and the learning platform.
- Desktop splits context and form into two columns. At the mobile breakpoint they stack in reading order; the narrow action group fills the available width. The mobile header permits the environment label to wrap.
- Show one available task at a time: sign in/create disposable account, then save/reload checks and sign out. Do not show production course, room or ranking actions.
- Labels, a skip link and visible `:focus-visible` outlines support keyboard use. `aria-busy` and polite status feedback explain progress without repeated alerts. Reduced motion removes transitions and animations.

## Implemented states

| State | Visible response |
|---|---|
| Configuration unavailable | Explicit disabled-development-tool notice; no credential form |
| Signed out | Test email/password, sign-in and create-test-account actions |
| Busy | Controls disabled and “Checking…” feedback |
| Signed in | Label form, save/reload actions, saved-check list and sign out |
| No checks loaded | Plain explanation to save one or reload existing checks |
| Saved/reloaded | Confirmation identifying database save or retrieval |
| Recoverable error | Input retained, local-service/retry guidance; no success claim |
| Signed out after use | Form restored and local-account-cleared feedback |

This surface is intentionally a narrow proof. Persistent login UX, production OAuth, onboarding and broader offline/conflict handling belong to their later stage contracts; their existence cannot be inferred from this screen.

## Evidence boundary

Inspected the actual source and both `.impeccable/review/desktop.png` and `.impeccable/review/mobile.png` during this pass. The captures show the signed-out state, the desktop split and mobile stacked layout, existing artwork, and clear development labeling. They do not prove every interactive state or accessibility compliance.

Functional browser/API/database results, dependency versions, test counts and runtime constraints are owned by `docs/evidence/B0.md`. This brief intentionally does not duplicate mutable verification totals or claim deployment. No third-party generation, new asset changes or UI implementation changes were made in this documentation pass.
