# Cheapo domain contracts

Import `shopSchema`, `productSchema` and the inferred types `Shop` and
`Product` from `@cheapo/domain`. Use the schemas' `parse` or
`safeParse` methods on incoming data. This private workspace package exports
TypeScript source for Expo's bundler and supports direct use on the repository's
Node version. Run `pnpm --filter @cheapo/domain test` for the plain Node contract
tests.

## Shop

- `id` identifies a particular branch and stays stable if the branch's name or
  nickname is edited.
- A shop needs at least one nonblank `nickname` or `name`. Validation trims
  each and treats blank text as absent.
- Import `shopDisplayName` from `@cheapo/domain/names` for display and form
  checks without loading Zod. It returns the trimmed nickname first, falls back
  to the trimmed name, and returns `undefined` when both are blank or absent.
- `address` is optional free text. `location` is optional and contains both
  latitude and longitude in decimal degrees within ±90 and ±180 respectively.
  A manually entered branch may have neither an address nor coordinates.

## Product

- `id` identifies the exact product. `name` is required. `brand` and
  `barcode` are optional. A barcode is a digit string and retains leading zeros.
- `pack` is optional. When known, it contains a positive finite `quantity` and a
  nonblank `unit`, such as `{ quantity: 500, unit: 'g' }`.
- `photoIds` optionally points to photo records by their IDs. Photo files,
  bytes, and storage details live at the photo boundary.
- `comparableGroupId` is an optional reference shared by comparable products.
  A 500 g pack from one brand and a 1 kg pack from another can share the
  dry-basmati-rice group while keeping their own IDs and pack sizes.

A future price observation can reference `shopId` and `productId`, and record
the observed price, currency, promotion and observation time. Those fields
belong to the observation. The package defines the Shop and Product contracts.

The Shop and Product schemas and the mobile manual-review check share
`normalizeName` from `@cheapo/domain/names`. It trims a name and returns
`undefined` for blank or missing input. The form applies its own length limits.
Saved drafts still store free-text review details and the existing original
and selected photo references. Drafts require no catalog IDs or migration.
