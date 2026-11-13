# Cheapo

Cheapo is a small Expo app for capturing price photos. Choose your current
shop once, then scan multiple items with that shop already filled in.

## Runtime

The project targets Expo SDK 58, React Native 0.88.1, React 19.3, and TypeScript 6.0.3. Use Node.js 24.22.2 (recorded in `.nvmrc`) and pnpm 10.11.0.

## Set up and run

```sh
nvm use
pnpm install --frozen-lockfile
pnpm dev
```

Run these commands from the repository root. `pnpm dev` starts Expo through
Turbo. Use `pnpm start` for Expo's direct interactive terminal or to pass Expo
options, such as `pnpm start --localhost --port 8082`. To open a platform directly:

```sh
pnpm ios
pnpm android
pnpm web
```

For a standalone build on a physical iPhone, see the
[local iOS build guide](docs/ios-local-build.md).

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm test:watch
pnpm test:route1
pnpm test:auth-native
pnpm build
```

`pnpm test:auth-native` requires JDK 17. `pnpm build` exports Android, iOS, and
web bundles to `apps/mobile/dist/`. Turbo caches deterministic checks and build
outputs locally. Use `pnpm expo <command>` to run Expo CLI in the mobile package
for direct operations such as prebuild.

The camera tests mock the native camera and permission APIs; they cover app behavior, not device camera hardware. Real photo capture should be checked on a physical device. iOS Simulator does not provide a working camera for this flow.

## Camera behavior

Scan → choose a shop if needed → camera permission → capture → adjustable crop →
review. The guide suggests where to fit the label, and Cheapo keeps the full
original. Review shows the selected shop alongside product, price, currency and
unit-price fields. **Save on this phone** stores a local photo draft.
**Copy to phone gallery** is a separate action after saving.
Saved drafts reopen from Scan. This path requires no account or cloud backend.

The Android field build can connect a ChatGPT account on the phone. In that
build, **Analyse photo** sends the selected photo directly to OpenAI when the
account has granted eligible plan usage. Apply suggestions and review them before
saving. Manual review and local saving also work without a ChatGPT connection.
The paired Mac companion remains available in the separate development flow.
See [local photo review](docs/local-photo-review.md) for behavior and verification.

## Expo upgrades

Upgrade one Expo SDK at a time. For each SDK, follow the Expo upgrade guide, install the matching package versions with `pnpm expo install --fix`, then run `pnpm expo:doctor` and the project checks above. Review the SDK release notes for breaking changes before moving to the next SDK. Rebuild native development clients after changes to native modules or app configuration.

## Project layout

- `apps/mobile/app/` — Expo Router screens, including Home and Scan
- `apps/mobile/component/camera.tsx` — permissions, camera, crop, review and local saving
- `apps/mobile/__tests__/` — mocked component and app tests
- `apps/mobile/modules/` — local Expo native modules
- `tools/` — local Route 1 companion and test-photo server

Repository: [Maratatasan/cheapo-app](https://github.com/Maratatasan/cheapo-app)

Route 1 Sign in with ChatGPT plan-usage feasibility is tracked in
[docs/route1-feasibility.md](docs/route1-feasibility.md).

## AI development tools

See [AI toolkit setup and verification](docs/ai-toolkit.md) for the installed Codex
plugins, personal skills in `~/.codex/skills`, native-device checks, and update instructions.

## Development test photo

For the optional Android emulator **Use test photo** preview, see
[mobile test setup](docs/mobile-test-readiness.md). It uses a private local JPEG,
requires no extra dependencies, and offers a separate explicit **Analyse test
photo** action through a paired local Mac companion. The normal camera capture, review and local saving flow remains available.
## Sample prices and shops

Use **Explore sample prices** on Home to open the sample comparison cards and
shop map. Prices, dates, distances and pin positions are fictional; exact shop
branches are unverified. This sample browser is independent of photo capture and
does not save observations. See [sample UI behavior and map limits](docs/sample-results-map.md).

## Component library

Run `pnpm ui:storybook` to browse the app’s shared cards and feedback states at
[localhost:6006](http://127.0.0.1:6006/?path=/story/cheapo-library--overview).
`pnpm ui:storybook:build` creates a local static build. See
[component library usage and verification limits](docs/component-library.md).

## Android authentication experiment

The opt-in [direct ChatGPT sign-in test](docs/android-direct-auth-preparation.md)
checks phone authentication and protected session storage. It does not process
photos and does not change the normal app configuration.
