# Sample results and shop map

Open **Explore sample prices** from Home, or `/results` directly. The existing
Home → Scan → permission → capture → preview/retake flow is unchanged. Results
are an independent sample browser, not the output of the camera/upload stub.
There is no saving, backend, authentication, stock lookup or live price feed.

## Data and behavior

`data/sample-observations.ts` contains fictional milk observations with explicitly
unverified shop branches. Coordinates and distances are illustrative. They are
not researched or geocoded locations. No user location or personal photographs
are read, copied, persisted or transmitted by these screens. Shop examples are
Lidl, Aldi and Sainsbury’s around Colliers Wood, and Morrisons around Wimbledon.

Cards include product, brand, pack size, GBP price, valid unit price, shop, date,
offer conditions and review status. Unit price uses the shared `unit_price: { amount: number, unit: string } | null`
contract, inheriting the observation currency. Units are preserved, rather than
assuming every pack is measured by volume. Unknown price/pack information is shown as a
review state. Cheapest sorts by pack price; Nearest independently sorts by sample
distance. Neither order promises like-for-like brands or membership eligibility.
Search and empty states are supported. `/shops?shop=aldi` selects an example shop;
map pins, selected observation and shop-list selection share state.

The sample data is intentionally separate from future reviewed observations.
`ResultsBrowser` and `ShopsBrowser` take observation arrays; a future integration
can supply reviewed data without changing the camera route or sample fixtures.
Do not mix draft recognition output into confirmed observations without the
product/price/pack/offer review and explicit shop confirmation stages.

## Maps and practical limits

- Native: Expo SDK 58 recommends `react-native-maps` **1.29.11**. It is included in
  Expo Go and needs no account/key setup for Expo Go testing. It uses the default
  native provider: Google Maps on Android, Apple Maps on iOS. The UI requests no
  location permission and disables location and directions controls. A production
  Android binary needs Google Maps configuration and a key; none is provisioned.
- Web: a fixed street-map viewport loads only its visible OpenStreetMap tiles
  using normal browser caching/referrer behavior, with visible linked attribution.
  Numbered pins are selectable and the shop list works even if tile loading fails.
  This is a preview, without pan, zoom, directions or GPS. Community tiles have
  no availability guarantee; select a suitable provider before public rollout.
- SDK compatibility checks and bundle exports passed. Exports are **not native
  builds**. Native map runtime, Android/iOS device behavior and physical-device
  camera capture have not been tested in this UI workstream. The concurrent
  mobile workstream owns separate camera/AI emulator verification.

Official references (checked 10 November 2026):

- [Expo SDK 58 react-native-maps](https://docs.expo.dev/versions/v58.0.0/sdk/map-view/)
- [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/)

## Validation

Run `pnpm typecheck`, `pnpm lint`, and `pnpm test`. Tests cover separate sorting,
search/empty states, uncertain prices, currency rounding and pin/list selection.
Native map APIs are mocked at the hardware boundary in tests. After dependency
changes run `pnpm expo install --check`, `pnpm expo:doctor`, and
`pnpm build` from the repository root.
