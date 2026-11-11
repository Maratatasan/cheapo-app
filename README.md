# Cheapo

Cheapo is a small Expo app for capturing a price photo. The home screen links to the scan screen, which requests camera permission, opens the camera, and lets you capture a photo, preview it, or retake it.

## Runtime

The project targets Expo SDK 58, React Native 0.88.1, React 19.3, and TypeScript 6.0.3. Use Node.js 24.22.2 (recorded in `.nvmrc`) and pnpm 10.11.0.

## Set up and run

```sh
nvm use
pnpm install --frozen-lockfile
pnpm start
```

Open the Expo development server and choose a platform, or run a platform command directly:

```sh
pnpm ios
pnpm android
pnpm web
```

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm test:watch
```

The camera tests mock the native camera and permission APIs; they cover app behavior, not device camera hardware. Real photo capture should be checked on a physical device. iOS Simulator does not provide a working camera for this flow.

## Camera behavior

The scan screen asks for camera permission when needed. Once granted, it shows the camera preview and capture control. A captured photo is shown with **Retake**, an explicit development **Analyse photo** action and disabled **Saving not connected** status. Analysis sends only the chosen photo through the paired local companion when explicitly pressed. Saving is not connected; the app does not claim a photo was saved or discard its preview.

## Expo upgrades

Upgrade one Expo SDK at a time. For each SDK, follow the Expo upgrade guide, install the matching package versions with `npx expo install --fix`, then run `npx expo-doctor` and the project checks above. Review the SDK release notes for breaking changes before moving to the next SDK. Rebuild native development clients after changes to native modules or app configuration.

## Project layout

- `app/index.tsx` — home screen and link to scanning
- `app/scan.tsx` — scan route
- `component/camera.tsx` — permissions, camera, photo preview, and upload stub
- `__tests__/` — mocked component tests

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
photo** action through a paired local Mac companion. The normal camera flow and
upload stub remain available.
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
