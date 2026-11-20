# Cheapo domain glossary

Use these terms in specs, tickets, and code discussions. The
[app map](app-map.md) describes today's behavior. The
[decision log](https://docs.google.com/document/d/1RiVeT6NU-aVZa9y-uvB5qSQ1OYPbxUB8tzFhrNS7Z84/edit)
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
| Barcode | An optional encoded identifier for a Product, such as a GTIN or a store-specific code. Preserve leading zeros. Correcting the association preserves `productId`. | Local product lookup uses validated GTINs. Store-specific codes and explicit correction are future work. |
| ProductGroup | A category for comparing products, such as dry rice. Compare prices across varieties or use the optional same-variety filter. | Local comparisons use reviewed product type, with variety (such as basmati or long-grain) recorded separately. A named group model is planned. |
| PriceObservation (DatedPriceObservation) | A price seen at a given time for a product at a branch. The planned record carries `productId`, `shopId`, amount, currency, and time. It can also include offer details and a product price photo. A fresh sighting adds a record. A correction edits the existing record. | Local manual or photo-linked prices. Older photo records may lack product and shop IDs. |
| Unit price | The price per standard quantity, such as £/kg, £/litre, or £/item. Rank prices in the same currency after normalizing compatible units, such as grams and kilograms. | Local. Entries with missing unit prices, unknown basis quantities, or unrecognized units stay unranked. Incompatible dimensions appear separately. |
| Offer | The terms behind an observed price, including a sale, membership requirement, or multibuy quantity. Compare a conditional price using its eligibility and quantity. | Planned. |

## Capture, review, and photos

| Term | Meaning | Status |
| --- | --- | --- |
| Draft | Captured or entered details awaiting completed review. Optional AI suggestions can be applied to the review. A completed price record requires explicit review and Save. | Local. An incomplete photo draft can also be saved for later review. |
| Product price photo | An optional image that evidences the price observed during a shop visit. It belongs to the dated price observation. | Local. Saved observations retain the original and selected image. |
| Product presentation photo | A recognizable display image for one exact product and pack. It belongs to the product and follows its ID across shop results. | Planned. Shared publication follows the community catalog. |
| Raw original | The uncropped source image kept alongside the selected image or crop. | Local. Visibility of originals and unpublished drafts beyond their contributor is open. |

### OCR terms

| Term | Meaning |
| --- | --- |
| OCR-assisted AI | AI review of a product or price photo with locally extracted text as supporting evidence. The shopper reviews the suggested details and explicitly confirms before saving. |
| OCR fuzzy search | Approximate catalog lookup that uses text read from a photo to suggest possible products. The shopper confirms the matched Product before linking it or saving a price. |

## Sharing and sync

| Term | Meaning | Status |
| --- | --- | --- |
| Community catalog | Shared shops and published product and price information, including published product presentation photos and product price photos. | Planned. Household saved-shop links and nicknames stay private. |
| PublishedContribution | A record or image available to Cheapo users. Browsing hides contributor names. Cheapo may keep private attribution for contribution and edit permissions. | Planned. |
| Sync state | Whether a locally saved change is pending, synced after acknowledgement, or in error and available to retry. ShoppingSession tracks the visit independently. | Planned. Local save works independently of sync. |
| Cheapo API | The shared service for iOS, Android, web, and the Cheapo MCP adapter. | Preference operations are available in local service development. Hosting and app integration are planned. |
| Comparison preference | One shopper’s choice of price basis for a ProductGroup. The group default applies when there is no personal choice. | The Cheapo API can store the choice per shopper and group. The app selector is planned. |

See the [domain contracts](../packages/domain/README.md) and
[data repositories](data-repositories.md) for current data shapes. The
[architecture principles](architecture-principles.md) describe the boundaries
between camera capture, photos, AI, storage, and UI.
