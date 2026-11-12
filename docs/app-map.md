# Cheapo app map

## Current user flow

The [Home route](../apps/mobile/app/index.tsx) opens Scan or the sample price browser.

```mermaid
flowchart TD
    Home --> Scan
    Scan --> Permission["Camera permission"]
    Permission -->|Granted| Capture
    Capture --> Crop["Adjust crop or keep original"]
    Crop --> Review["Review photo and edit details"]
    Review -->|Retake| Capture
    Review --> Save["Save on this phone"]
    Save --> Gallery["Optional gallery copy"]
    Scan -->|Reopen saved draft| Review
    Home --> Results["Explore sample prices"]
    Results --> Shops["Sample shops and map"]
    Results --> Scan
```

## Where to make changes

| Responsibility | Current implementation |
| --- | --- |
| Camera | The [Scan route](../apps/mobile/app/scan.tsx) mounts the [camera component](../apps/mobile/component/camera.tsx), which owns permissions, preview, capture, retake, and the photo workflow. |
| Photos | The [crop editor](../apps/mobile/component/photo-crop.tsx) uses [crop geometry](../apps/mobile/data/crop-geometry.ts) and [image manipulation](../apps/mobile/lib/photo-crop.ts). It derives a JPEG from the original and keeps both available in the draft. |
| Review | The [review form](../apps/mobile/component/photo-review.tsx) edits product, price, currency, shop, and optional unit-price details. [Manual review validation](../apps/mobile/data/local-photo.ts) checks completeness using the name rules from [shared domain contracts](../packages/domain/README.md). Incomplete details can still be saved as a draft. |
| Storage | The [local photo store](../apps/mobile/data/local-photo.ts) writes JPEGs and a JSON manifest in the app’s private directory. Scan reopens saved drafts. The [gallery helper](../apps/mobile/lib/photo-gallery.ts) copies the selected image only on request after saving. |
| Sample browsing | [Results](../apps/mobile/app/results.tsx) and [Shops](../apps/mobile/app/shops.tsx) use [fictional sample data](../apps/mobile/data/sample-observations.ts). This browse flow is independent of local drafts. |

## Experiments and planned boundaries

- **Development AI.** [Analyse photo](../apps/mobile/component/mobile-draft.tsx) sends the selected image to a paired [Mac companion](../tools/route1-demo/server.mjs) and shows a [separate AI draft card](../apps/mobile/component/results/ai-draft-card.tsx). The manual form and local save use the shopper’s edits.
- **Android sign-in.** In the opt-in auth test build, Home links to [Developer tools](../apps/mobile/app/developer-tools.tsx). The [direct auth screen](../apps/mobile/app/direct-auth.tsx) exercises sign-in and protected session storage. Direct phone photo analysis is unintegrated.
- **Planned.** See the [architecture principles](architecture-principles.md) for intended camera, photo, AI-provider, and persistence boundaries. AI field assignment and cloud storage remain future work.
