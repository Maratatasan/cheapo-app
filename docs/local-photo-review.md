# Local photo review

Capture opens an adjustable crop seeded from the camera guide when Android image
geometry matches the preview; otherwise it starts with the full photo. Cropping
creates a separate JPEG. **Use original** restores the retained full image.

The review form keeps persistent labels and adjusts for the keyboard. Product,
pack price, currency, shop and optional unit price/unit are editable. Incomplete
records can be saved as drafts; a completed manual review requires valid fields.
The most recent shop is reused on the next capture and remains editable.

**Save on this phone** copies the original and selected image into the app's
private document directory, then writes a JSON manifest. Success is shown only
after the native copies and manifest write complete. Failed saves keep the
preview and corrections. Scan lists saved drafts; malformed manifests or missing
images are skipped so other records remain available.

**Copy to phone gallery** is a separate explicit action after local save. It copies
the selected JPEG; originals and private drafts stay in Cheapo. It requests add
permission only when required and does not request photo-library read access.
Google Photos backup/synchronisation is controlled by the phone, not Cheapo.

## Limits

- This is local mobile storage, not cloud backup. Uninstalling the app can remove
  its private drafts. Local saving/gallery are not verified for web.
- Before updating a valid saved manifest, Cheapo writes a last-good backup.
  Loading falls back to it if the primary is missing or malformed; failed edits
  can therefore reopen the previous saved details. This is not a transactional
  database or protection against losing the whole app storage directory.
- No location inference, AI field assignment, Cheapo account or AWS backend is
  introduced by this reconciliation. Existing development companion analysis
  remains separate.

## Verification

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`. Tests mock camera, filesystem,
image manipulation and gallery APIs; they verify flow and failure handling but
not device hardware. Current native/device evidence belongs in the PR.

Physical-device acceptance: capture a harmless label, adjust/cancel/apply crop,
edit values with the keyboard open, save, restart and reopen it, then explicitly
copy the selected crop to the gallery. Confirm the original remains available.

## Standalone field-test build

Set `CHEAPO_FIELD_TEST=1` for prebuild, build and export commands. This uses the
existing field-test package `com.maratatasan.cheapo.field`, scheme `cheapofield`,
version `0.1.7` / Android version code `9`. Keep the existing local debug signing
key and use install-update (`adb install -r`), never uninstall/reset, to retain
private drafts from the previous field test. Normal app identity is unchanged.
Do not set `CHEAPO_AUTH_TEST` at the same time.

Use the [local Android build procedure](android-direct-auth-preparation.md) with
`CHEAPO_FIELD_TEST=1` in place of `CHEAPO_AUTH_TEST=1`. The release APK bundles
JavaScript and launches without Metro. Use **Choose photo** to import an image
from the system picker without granting camera permission. Use **ChatGPT** on
Home to connect the optional plan usage in this field app. Android keeps the
separate auth-test app’s login in its own protected storage.
