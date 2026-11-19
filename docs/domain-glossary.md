# Cheapo domain glossary

Use these terms in specs, tickets, and code discussions. The
[app map](app-map.md) describes today's behavior. The
[decision log (D-04–D-06)](https://docs.google.com/document/d/1RiVeT6NU-aVZa9y-uvB5qSQ1OYPbxUB8tzFhrNS7Z84/edit)
records the rationale, and the
[domain model chart](https://www.mindomo.com/mindmap/cfab54ffb4884d5f8e458a03433f8aa0)
shows proposed relationships. Update this glossary when a term changes meaning
and record the decision in the log.

**Local** describes behavior in the app today. **Planned** describes the intended
model. **Open** marks a decision still to be made.

## Shops and visits

| Term | Meaning | Status |
| --- | --- | --- |
| Shop (CanonicalShop) | A specific branch with a stable `shopId`. Each branch has one identity in the intended shared catalog. | Local branch IDs. Global catalog planned. |
| SavedShop (HouseholdSavedShop) | A household's private link to a Shop by `shopId`, with an optional private nickname. | The local shop record currently stores its nickname and is part of the device's saved list. Separate household links are planned. |
| User, Household, Membership | A User is an individual Cheapo identity. A Household shares a private saved-shop list. Membership links a User to a Household and grants access to that list and its nicknames. | Planned. Cheapo identity and AI-provider sign-in are separate. |
| Current shop | The selected branch for one person's visit. New captures use this selection and retain its shop details. | Local selection. Per-user ownership is planned. |
| ShoppingSession (PersonalShoppingSession) | One person's visit context, including current shop, start, status, and draft references. A shop change can happen within the same session. | Planned as local context. Cross-device resume is later work. |

## Products and prices

| Term | Meaning | Status |
| --- | --- | --- |
| Product | One exact brand, variety, and pack variant with a stable `productId`. Each variant has its own ID. | Local product IDs and metadata. |
| Barcode (GTIN) | An optional identifier associated with a Product. Preserve leading zeros. Correcting the association preserves `productId`. | Local barcode lookup. Explicit correction is planned. |
| ProductGroup | A category for comparing products, such as dry basmati rice in several brands and pack sizes. | Local comparisons use reviewed product type. A named group model is planned. |
| PriceObservation (DatedPriceObservation) | A price seen at a given time for a product at a branch. The planned record carries `productId`, `shopId`, amount, currency, time, and optional offer details and label evidence. A fresh sighting adds a record. A correction edits the existing record. | Local manual or photo-linked prices. Older photo records may lack product and shop IDs. |
| Unit price | The price per comparable quantity, such as £/kg, £/litre, or £/item. Compare by unit price within the same currency and compatible unit basis. | Local. Unknown prices stay unranked and different unit bases are shown separately. |
| Offer | The terms behind an observed price, including a sale, membership requirement, or multibuy quantity. Compare a conditional price using its eligibility and quantity. | Planned. |

## Capture, review, and photos

| Term | Meaning | Status |
| --- | --- | --- |
| Draft | Captured or entered details awaiting completed review. Optional AI suggestions can be applied to the review. A completed price record requires explicit review and Save. | Local. An incomplete photo draft can also be saved for later review. |
| PrimaryProductPhoto | The one primary display photo for an exact product variant, shared across shops. | Planned. |
| LabelEvidence | An optional shelf-label image attached to a particular price observation. | Local photo records carry the selected image. The separate evidence reference is planned. |
| Raw original | The uncropped source image kept alongside the selected image or crop. | Local. Visibility of originals and unpublished drafts beyond their contributor is open. |

## Sharing and sync

| Term | Meaning | Status |
| --- | --- | --- |
| Community catalog | Shared shops and published product and price information, with published label photos. | Planned. Household saved-shop links and nicknames stay private. |
| PublishedContribution | A record or image available to Cheapo users. Browsing hides contributor names. Cheapo may keep private attribution for contribution and edit permissions. | Planned. |
| Sync state | Whether a locally saved change is pending, synced after acknowledgement, or in error and available to retry. ShoppingSession tracks the visit independently. | Planned. Local save works independently of sync. |
| Cheapo API | The intended shared service for iOS, Android, web, and the Cheapo MCP adapter. | Planned. The shopping flow saves locally today. |

See the [domain contracts](../packages/domain/README.md) and
[data repositories](data-repositories.md) for current data shapes. The
[architecture principles](architecture-principles.md) describe the boundaries
between camera capture, photos, AI, storage, and UI.
