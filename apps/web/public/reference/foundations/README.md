# Digital foundations

`tokens.json` is the portable value map. `build_tokens.py` generates its CSS, TypeScript and Dart derivatives together. Edit the builder source, regenerate once, then review every affected usage. Do not copy a value into an unrelated theme file and treat both as canonical.

## Color roles

The approved logo retains cobalt, orange and ink. UI colors serve separate roles: cobalt for the next useful action, orange for a limited highlight or milestone, neutrals for reading, and labeled green/amber/red for status. Orange does not mean warning by default. Work and Learning labels must accompany any color coding.

The dark theme uses lighter semantic action colors for readability, while the supplied reverse logo is a separate artwork variant. Do not invert the logo with CSS or change its internal geometry.

`contrast-report.json` records 26 exact token-pair checks. Body text target is at least 4.5:1; the two tested non-text control/focus pairs per theme use 3:1. The report does not assert WCAG conformance for the whole app. White on the brand orange is 2.95:1, so use ink text on orange controls. Decorative logo colors have different obligations from control labels.

## Typography

- Manrope 200–800 variable: primary English UI, typically 400/500/650/750/800.
- Noto Sans Arabic 100–900 variable: Arabic editorial/supporting text. The approved logo lettering is outlined artwork, not this font.
- Caption 12/18; secondary 14/21; body 16/26; titles 24/32; headings 36/44; expressive desktop display 56/64. On compact screens use 32–40 px display headings and respect content wrapping.
- WOFF2 is bundled for web; full variable TTF is bundled for native/editor installation. Self-hosted subsets avoid runtime Google Fonts requests. Test additional scripts against the full TTF or add licensed subsets; never silently promise all scripts are in the Latin web subset.
- Keep Arabic letters untracked. Isolate mixed URLs/numbers with bidi semantics; do not mirror the logo in RTL. Native text scaling and browser zoom take precedence over rigid text boxes.

## Layout and interaction

Spacing uses a 4 px base with named gaps. Operational controls are preferably 48 logical pixels high, minimum 44 for this kit. These are product choices above the WCAG AA minimum; they are not a claim that WCAG mandates 44 for every target. Use real labels, visible focus, semantic controls, and an alternative to drag-only interactions.

Content-driven breakpoints: compact <600, medium 600–899, expanded >=900; large reference >=1200. They are design-kit defaults rather than platform law. Native implementations should also account for safe areas, keyboard, orientation, font scaling and available window width.

Motion: 120 ms feedback, 200 ms transitions, 320 ms deliberate rearrangement. Use one explanatory transition during recovery or step completion; no pulsing competitive pressure. Reduced motion removes nonessential movement and must not hide state changes.

## Implementing on web and mobile

Web imports `tokens.css`. React Native can consume `tokens.native.ts` values, mapping numeric units to platform layout and semantic colors to the app theme. Flutter can use `tokens.dart` as a color/spacing adapter. These files are framework adapters, not a completed native app or a substitute for platform accessibility behavior.

Component state and behavior examples live in `../prototype/components.html`. The complete flow prototype is `../prototype/index.html`. The prototype deliberately stores demo state locally; a later production app must implement server acknowledgement, cross-device conflict detection, authorization, offline queues and actual timer eligibility before displaying those guarantees.

## References checked 31 October 2026

- [W3C contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- [W3C target size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [Google Fonts Manrope source](https://github.com/google/fonts/tree/main/ofl/manrope)
- [Google Fonts Noto Sans Arabic source](https://github.com/google/fonts/tree/main/ofl/notosansarabic)

Font binaries and license texts were retrieved from official Google Fonts endpoints; exact URLs/hashes are in `../assets/fonts/manifest.json`.
