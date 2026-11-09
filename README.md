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

The scan screen asks for camera permission when needed. Once granted, it shows the camera preview and capture control. A captured photo is shown with **Retake** and **Upload Photo** actions. **Upload Photo** is currently a stub: it logs the local photo URI, shows a confirmation alert, and returns to the camera. It does not send a photo to a server.

## Expo upgrades

Upgrade one Expo SDK at a time. For each SDK, follow the Expo upgrade guide, install the matching package versions with `npx expo install --fix`, then run `npx expo-doctor` and the project checks above. Review the SDK release notes for breaking changes before moving to the next SDK. Rebuild native development clients after changes to native modules or app configuration.

## Project layout

- `app/index.tsx` — home screen and link to scanning
- `app/scan.tsx` — scan route
- `component/camera.tsx` — permissions, camera, photo preview, and upload stub
- `__tests__/` — mocked component tests

Repository: [Maratatasan/cheapo-app](https://github.com/Maratatasan/cheapo-app)
