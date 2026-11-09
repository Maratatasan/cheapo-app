# Cheapo UI

Expo SDK 58 / React Native 0.88 / React 19.3 starter app with Home and Explore tabs.

## Local development

Use the existing nvm installation and pnpm. Do not mix npm and pnpm lockfiles.

```sh
nvm use
pnpm install --frozen-lockfile
pnpm web
```

Node 24.22.2 (LTS) is pinned in `.nvmrc`; pnpm 10.11.0 is pinned in `package.json`. The supported Node ranges are 24.3 and newer within Node 24, or Node 26 and newer.
If nvm is not loaded in your shell, run `source ~/.nvm/nvm.sh` first.

## Checks

```sh
pnpm check
pnpm dlx expo-doctor@latest
pnpm exec expo export --platform all
```

`pnpm check` runs TypeScript and lint. Exporting builds the JavaScript bundles; it does not compile or run a native app. There are no automated product-flow tests yet.

## Native development

`pnpm ios` / `pnpm android` start Expo for an installed simulator or emulator with a compatible client. Simulator tooling and native runtime verification are a separate pending setup step. A native development build may be needed; do not assume an older Expo Go supports SDK 58.

## Upgrade notes

Upgraded incrementally from SDK 53 through 54, 55, 56, 57 and 58. Matching React, React Native, Router and Expo packages were selected by Expo CLI. Navigation imports now use Expo Router's exports. Theme hydration and icon types were adapted to the newer APIs; existing screens were retained.

The existing dependency installation used pnpm, so `pnpm-lock.yaml` is authoritative. The obsolete npm lockfile was backed up outside the repository. Do not run the reset-project script unless you intend to replace the starter screens.

For future upgrades, follow https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/ and check each SDK's migration notes. Run Expo dependency alignment and the checks above after each upgrade.

## Verification on 9 November 2026

- Clean `pnpm install --frozen-lockfile` succeeded.
- TypeScript and lint passed. Expo Doctor passed 20/20 checks.
- Clean exports succeeded for web, iOS and Android.
- Browser check passed: Home → Explore → expand File-based routing.
- Native compilation and simulator/device execution have not yet been verified.

## Local tooling update — 9 November 2026

- Node 24.22.2 LTS installed through existing nvm; pnpm 10.11.0 retained. Frozen installation and `pnpm check` passed under this Node version.
- Xcode 26.6 retained: it meets Expo SDK 58's Xcode 26.4 minimum. macOS was not changed.
- iOS 26.5 runtime (23F73) installed; dedicated device `Cheapo iPhone 17 Pro` UUID `F97EECCE-C188-4045-AEA9-3E07D8236B28` created. Expo Go 58.0.7 installed. First startup was delayed by Xcode simulator cache generation. After one non-destructive device restart, a bounded boot check failed with NSPOSIXErrorDomain code 60: launchd_sim failed to respond / could not bind to session. App UI verification is pending. Restart the Mac after saving work, then retry this simulator; no host restart or device erasure was performed.
- OpenJDK 17.0.21.0.3 installed via Homebrew. Google Android command-line tools revision 22.0 installed with verified archive checksum.
- Existing `Pixel_9_API_36` AVD booted successfully once and Expo Go 58.0.5 installed. It was then shut down to avoid simultaneous cold boots. No AVD data was erased.
- Android platform-tools 35.0.2 and emulator 35.5.10 remain unchanged. Updates to these and Android Studio are still pending. Automatic approval review blocked the grouped SDK licence prompt because it included agreements beyond the single agreement approved by the user. Complete the relevant licence review manually in Android Studio SDK Manager before further SDK package updates.

For Android native builds in the current terminal (no global shell files were changed):

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

Run one simulator at a time on this 16 GB Mac while cold starts/cache generation are in progress. Native app compilation has not yet been verified.
