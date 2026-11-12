# Cheapo component library

This is a small browser Storybook for the **same React Native components used by
the app**, rendered through React Native Web. It is local tooling, not another app
entry point, native Storybook, a published package or a hosted service.

## Run and build

Use Node 24.22.2 and pnpm 10.11.0, as for the app:

```sh
pnpm install --frozen-lockfile
pnpm ui:storybook
pnpm ui:storybook:build
```

Open <http://127.0.0.1:6006/?path=/story/cheapo-library--overview>. The development
server binds to loopback. The build is written to ignored `apps/mobile/storybook-static/`.
Telemetry is disabled. No Chromatic account, cloud publishing or deployment is
configured. CI builds Storybook alongside the existing app checks without changing
workflow triggers.

## Components and data

| Component | Purpose and important variants |
| --- | --- |
| `ObservationCard` | Dated product/brand/pack/shop observation, offers, uncertainty and optional shop action |
| `PriceDisplay` | Independent pack price and `unit_price: { amount, unit } | null`; GBP formatting and correct penny rounding |
| `ShopCard` | Default/selected shop row, long branch name, optional pin number and explicit selection callback |
| `OfferNotice` | Ordinary conditions, loyalty requirements, missing terms and uncertainty |
| `DisplayState` | Empty, loading and error states with an optional retry action |
| `ResultsBrowser` | The real search/sort composition; empty search, loading, error and independent price/distance sorting |

Source components live in `apps/mobile/component/results/`. `theme.ts` contains the existing
colors and a small spacing/radius/type scale, shared by app components and stories.
Within `apps/mobile/`, `data/observation.ts` owns data types and formatting.
`data/sample-observations.ts` and `stories/fixtures.ts` hold fictional data separately
from rendering. Component callbacks accept user actions; they do not access camera,
storage, navigation, authentication or a backend.

The catalog contains 30 stories across seven groups, including the overview.
Examples cover kg/litre/item units, unknown unit price, missing prices, loyalty
terms, long product/shop/branch names, review state and selected shops. Every story
is visibly marked sample data. Use Controls to adjust props and Actions to inspect
callbacks. Interaction stories check opening a shop, selecting a shop, retrying,
searching to an empty result, choosing Nearest, and displaying weight-based prices.

## Verification and boundaries

`pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm ui:storybook:build` are local checks.
Storybook play functions execute when their stories are opened in the browser;
the CI build verifies compilation, **not** automatic execution of every play
function or visual regression testing. App Jest tests cover search/sorting,
selection, price/unit formatting, review states, empty states and retry/loading
behavior.

The catalog deliberately excludes native camera and map modules. It renders the
actual shop card and selection behavior without map-provider calls. Street-map
rendering remains in the app's separate `/shops` preview, and native map/camera
runtime behavior requires its own device checks. Browser stories and bundle
exports do not verify native hardware or constitute native builds.

Versions checked against official docs and registry metadata on 10 November 2026:
Storybook, RN Web Vite framework and Docs addon **10.6.6**, Vite **8.3.7**. Framework
peers accept the app's React 19.3, React Native 0.88.1 and React Native Web 0.21.4;
Vite accepts Node 24.22.2. **Upstream compatibility limitation:** transitive
`vite-plugin-rnw@0.0.11` and `tsconfck@3.1.6` still advertise TypeScript 5 peer
ranges. Expo SDK 58's TypeScript 6.0.3 is retained; warnings are not suppressed.
Type checking, the production Storybook build and actual browser rendering were
verified with this combination. Vite also reports that the framework's tsconfig
path plugin overlaps Vite 8's native support; no framework internals are patched.

References:

- [Official Storybook React Native Web framework](https://storybook.js.org/docs/get-started/frameworks/react-native-web-vite)
- [Official Storybook Vite configuration](https://storybook.js.org/docs/builders/vite)
