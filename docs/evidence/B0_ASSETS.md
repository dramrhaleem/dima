# B0 — Asset and first-journey preparation evidence

Date: 31 October 2026. Scope: copying approved reference assets and specifying first-journey UI states. This record does not claim a production interface, backend, APK, new brand approval, or live-service verification.

## Source and destination

Source: `/media/amro/Data2/Kanaf/outputs/dima-ui-experience-20261031`.

Destination: `assets/reference-ui/` within the Dima project. The source package was read only and remains unchanged. The [manifest](../../assets/reference-ui/asset-manifest.json) contains source path, byte size and SHA-256 for each of **104 copied files**, totaling **1,689,905 bytes**. All copied files were compared byte-for-byte with the original.

The approved [landing](../../assets/reference-ui/prototype/landing.html) SHA-256 is:

```text
94b8988bf7a30356b7ba8b9a428505958d7c9b8481ea9a53507a27810460cd65
```

## What was copied

- Supplied SVG logo/wordmark/icon variants and app-icon assets.
- Manrope and Noto Sans Arabic web/editor fonts with OFL texts and retrieval manifest.
- Foundation tokens, native token references, reusable native UI sources.
- Landing, local workspace and component studio plus their runtime dependencies.
- Historical design/product/interaction handoff, asset license notes, catalog attribution/selection and available MIT notices.

Excluded: private raw/original 21st source archives, prior QA screenshots, node_modules, service credentials, Kanaf business data and obsolete package-wide checksum files. Existing linked static navigation was preserved so the landing's demo/studio links remain usable; these are clearly local demos, not account services.

## Rights and provenance boundaries

The copied [asset license record](../../assets/reference-ui/ASSET_LICENSES.md) and [catalog attribution](../../assets/reference-ui/catalog/ATTRIBUTION.md) remain verbatim. They report fonts under SIL OFL, available upstream MIT notices, and independent native implementations for catalog patterns whose source license was not established. No upstream raw code with unknown license was copied into the reference runtime. Paid 21st membership is not evidence of exclusive ownership or unrestricted redistribution.

The original license record mentions `assets/source/`; that directory is **absent from the supplied UI package** and was not fabricated. The vector reconstruction/approval history is therefore described by the supplied record, not independently proven by a source-image comparison in B0. No logo geometry was altered, and no trademark clearance is claimed. Recover that original fidelity/source material if later artwork edits or a rights audit require it.

The historical PRODUCT.md/DESIGN.md inside the reference tree retain older proposal terminology for provenance. Current root [PRODUCT.md](../../PRODUCT.md), [DESIGN.md](../../DESIGN.md), and docs/PRD_AR.md control new implementation. Do not use old demo navigation or fixed sample values as the current product contract.

## Verification performed

| Check | Observed result |
|---|---|
| Source/copy SHA-256 and byte equality | 104/104 files equal; source files unchanged |
| Local paths in copied HTML/CSS | 75 references checked; no missing local target |
| `node --check` on copied `.js` files | 7 files passed |
| `node assets/reference-ui/prototype/verify.mjs` | Passed original structural/local-demo behavior checks, including 12 view renders, completion/time separation, plan preference restoration and command destinations |

No new visual rendering pass was needed to establish byte-identical copying; these checks do not re-certify browser rendering, accessibility, curriculum accuracy or prototype business logic for production. The original verifier uses a synthetic DOM and local state; its pass is not evidence for the future API, database, timer or shared rooms.

## UI preparation output

[B0_UX_STATES_AR.md](../B0_UX_STATES_AR.md) specifies the first journey, responsive shell, loading/empty/saving/saved/pending/failed/conflict/offline states, textual wireframes and accessibility behavior. It preserves current navigation and milestone boundaries: no fake Start focus before B4, no room success claim before B5, and no local save labeled as server confirmation.

Root PRODUCT.md was rewritten from current canonical scope, while root DESIGN.md carries forward the approved visual authority with an explicit path/status note. No new component subscription, hosted generation, design publication or application implementation occurred in this subtask.
