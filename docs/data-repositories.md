# Local shopping data and future repository adapters

## Shop repository

The [root layout](../apps/mobile/app/_layout.tsx) provides the
[shop repository](../apps/mobile/data/shop-repository.ts). The Home and Scan
routes load the saved list through the focus hook and pass mutations to the shop
chooser. ZIP export receives the same repository for its shop read. The chooser
already accepts operations as props, so its forms and confirmation flow are
independent of storage.

The [local adapter](../apps/mobile/data/local-shops.ts) owns validation,
serialization, stable IDs, and the commit-before-success rule. Its native and
web snapshot implementations remain in place. A mutation returns the current
app view of the saved list and selection after success. This view combines
distinct concerns that a future adapter can obtain separately. A canonical
shop describes a branch. Saving or removing that shop concerns the shopper's
saved list. Selecting it concerns the shopper's current visit. Local removal
clears a matching selection while prior observations retain their shop
snapshots. A shared adapter must define the scope of a saved link separately
from global shop deletion.

## Current call sites and follow-up slices

| Data | Current reads and writes | Follow-up seam |
| --- | --- | --- |
| Shops and saved links | Home and Scan load and select saved shops. The chooser creates shops and Home enables edit and remove. ZIP export reads the saved list. The shop adapter persists the list and current selection. | A future adapter composes the saved list, branch details and personal selection behind the app contract. |
| Products | [Barcode scan](../apps/mobile/component/barcode-scan.tsx) calls the [local catalog](../apps/mobile/data/local-products.ts) to find an exact product, create it with a stable ID and canonical GTIN, or correct a barcode. The shopping ZIP includes the catalog and committed barcode corrections. | Introduce a product repository at the scanner seam for exact lookup and creation. Define broader identity-changing edits when those workflows need them. |
| Price observations | [Camera](../apps/mobile/component/camera.tsx) saves and reopens photo drafts. Barcode scan appends a reviewed manual price and reads comparison records. [Saved products](../apps/mobile/app/saved-products.tsx), [Compare](../apps/mobile/app/compare/%5Bid%5D.tsx) and [Edit](../apps/mobile/app/edit-price/%5Bid%5D.tsx) read or correct records. [ZIP export](../apps/mobile/lib/shopping-export.ts) reads every required record. The [local store](../apps/mobile/data/local-photo.ts) owns manifests, recovery and JPEG persistence. There is no observation-delete workflow. | Separate reading, appending and correcting observations from files. Preserve the existing distinction between a new observation and a correction of an existing record. |
| Photo references | Camera and the system picker produce temporary JPEG assets. [Crop](../apps/mobile/component/photo-crop.tsx) creates a derivative. The local store copies and references both files. Saved products, review and compare render those references. [Analysis](../apps/mobile/component/direct-photo-analysis.tsx), [gallery copy](../apps/mobile/lib/photo-gallery.ts) and ZIP export resolve actual bytes or local paths. There is no standalone photo CRUD workflow. | Define photo reference resolution and ownership when those consumers need a second storage adapter. Keep capture and crop, gallery copies, AI input and export distinct from observation mutations. |

The shop adapter remains local and supports the existing offline flows. The
test adapter verifies that callers can use a replacement at composition.
Household ownership, remote operations and offline synchronization require
their own design and tests under [#107](https://github.com/Maratatasan/cheapo-app/issues/107).

## Offline shopping backup

Before enrollment, **Saved products and photos** exports a version 3 ZIP
with the original bytes of every referenced JPEG. The manifest preserves draft and price
IDs, stored review values, observation shop snapshots, saved shops and their
nicknames, the current shop ID, and the catalog's legacy products, original
barcode mappings, and ordered corrections. `source` records runtime app metadata
when available. Build revision can be recorded separately from the verified APK.

The backup reads the current committed local state, including the local shop
selection. Hosted read snapshots are outside this export. If a price record's
primary file is interrupted, the last valid recovery copy supplies that record. Old recovery
copies and temporary files do not become additional observations. Credentials,
provider sessions, and unrelated files are outside the backup. Comparison-basis
preferences currently have PostgreSQL storage and no local mobile store.

Keep the ZIP private and verify its CRCs, record references, and SHA-256 hashes
of the transferred ZIP and its entries before using it for migration. Keep
version 1 and 2 archives as earlier snapshots. They lack the full catalog and
current selection.

An enrolled phone writes a version 4 recovery ZIP. It retains the local
catalog, branch list, selection and price files from the version 3 snapshot.
It also includes the current verified owner's queued records and their
original and crop bytes, with separate paths for enrolled evidence. The raw
price, evidence and shopping queue files preserve the exact reviewed request,
acknowledgement, conflict, resolution and interrupted data. Exports check
queue dependencies and confirm the owner again before sharing.

Keep the recovery ZIP private. Version 4 is a device recovery format. The
operator shopping importer accepts versions 1 through 3. Recovery retains
pending work for review and cannot replay it by importing a price snapshot.

## Replaceable Cheapo read snapshots

The [configured device reader](../apps/mobile/data/cheapo-shopping-read-device.ts)
uses an origin-bound enrollment for saved shops and exact catalog reads. It
validates responses and stores the time of a successful read. A transient
connection problem can reopen a saved snapshot with that time. A denied
request fails without showing a fallback. An unavailable lookup stays
distinct from a checked barcode miss.

The [snapshot cache](../apps/mobile/data/cheapo-shopping-read-cache.ts) owns the
`cheapo-shopping-snapshots` directory under app cache. It measures actual
snapshot bytes and clears only that directory. Protected documents, photo
evidence, shopping exports and the SecureStore credential use separate
locations. The reader does not prefetch or poll. Home, Scan, saved shopping
writes and export continue through the local provider until the durable write
and reconciliation path in [#192](https://github.com/Maratatasan/cheapo-app/issues/192)
is available.
