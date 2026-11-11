# Android direct ChatGPT sign-in experiment

This is an **authentication-only experiment**, not the phone AI photo workflow.
It uses the system browser and a one-use callback listener bound to `127.0.0.1`
on the phone. It never uses the Mac companion, sends a photo, or requests inference.

## Opt-in test app

The normal app identity and home flow are unchanged. Set `CHEAPO_AUTH_TEST=1`
for **both** prebuild and build/export/Metro commands to enable the separate
**Cheapo Auth Test** app, version `1.0.2` / Android version code `3` (`com.maratatasan.cheapo.dev`, scheme `cheapo-auth-test`).
The test screen is disabled in the normal app, Expo Go, iOS and web builds without
the Android native module. Tokens and installation identity use Expo SecureStore;
no credential or callback URL is logged or bundled.

```sh
nvm use
pnpm install --frozen-lockfile
CHEAPO_AUTH_TEST=1 pnpm exec expo prebuild --platform android --no-install
```

Use JDK 17 and the installed Android SDK. From generated `android/`:

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
CHEAPO_AUTH_TEST=1 ./gradlew :app:assembleRelease --no-daemon --max-workers=1 -Dorg.gradle.parallel=false -Dorg.gradle.jvmargs='-Xmx2048m -XX:MaxMetaspaceSize=512m' -Pkotlin.compiler.execution.strategy=in-process -PreactNativeArchitectures=arm64-v8a -Pandroid.cmakeVersion=3.22.1 -Pandroid.enableMinifyInReleaseBuilds=false
```

This local test release variant uses the generated debug signing key; it is not
an app-store release. Install `android/app/build/outputs/apk/release/app-release.apk`
on the connected test device with `adb -s DEVICE_SERIAL install -r PATH_TO_APK`.
The APK bundles JavaScript and runs without Metro or the Mac companion. Generated
`android/` and local-module build outputs are ignored. Keep emulators off on the
low-memory Mac.

## Manual verification

1. Home → **Direct phone sign-in test** → **Check this phone**. This checks the
   real native loopback receiver, RSA primitive and protected storage using a
   local mock callback; it does not establish provider authentication.
2. **Sign in with ChatGPT on this phone**. The user completes browser consent,
   then selects **Return to Cheapo Auth Test** and taps **Continue sign-in** in
   Cheapo. Returning alone sends no token request. Continue requires the app to
   be active; pending confirmation expires after 60 seconds and cancellation
   prevents later continuation. The authorization code stays in memory only.
   Confirm identity verified,
   plan permission granted (if eligible), and saved login yes.
3. Close and reopen the app. Check saved phone sign-in; the connection should
   restore without opening the browser. Expired tokens are renewed when checked.
4. **Clear phone login / sign out** removes the local session even if it is
   malformed. If remote revocation fails, the screen says so. Valid client
   registration is retained for later sign-in; malformed registration is cleared.
5. Cancellation must not publish a login after its storage write completes.
   The prior session is restored, or a storage recovery error is shown.

The test screen identifies version **1.0.2 (3)** and **explicit Continue**;
the public connection check remains **probe v2**. It shows a fresh loading
message and distinguishes native bridge rejection from handled native request
failure. **Check OpenAI connection** requests only the public signing keys, without tokens
or a photo. A failed request may show a bounded transport category, request stage,
DNS retry result and app foreground/background snapshot taken after the failure.
That snapshot does not establish the cause of the original network failure.

Provider eligibility and usage authorization are distinct from verified identity.
One account is supported per test installation. Account switching and returning
sign-in hints are not implemented. Phone image processing is a separate increment.

## Repeatable checks

`pnpm typecheck`, `pnpm lint`, `pnpm test` cover the app and mocked authentication
protocol, identity validation, cancellation, restoration and token rotation.
Run `pnpm test:auth-native` with JDK 17 for the actual Java loopback/RSA helpers on
the Mac. Those helper tests do not prove Android lifecycle behavior. Dependency
checks and Expo exports also do not count as native builds or device evidence.

## Evidence for this reconciliation

Checks and device results are recorded in the PR. Earlier prototype native builds
and Pixel self-checks are historical only and do not verify this reconciled tree.

Official references: [ChatGPT registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
[account sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions),
[Expo local modules](https://docs.expo.dev/modules/get-started/),
[SDK 58 SecureStore](https://docs.expo.dev/versions/v58.0.0/sdk/securestore/).
