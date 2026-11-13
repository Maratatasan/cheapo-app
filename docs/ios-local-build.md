# Local iOS build

Cheapo uses the `com.maratatasan.cheapo` iOS bundle identifier. The initial
iOS build is version `1.0.0` (build `1`). Keep the bundle identifier and signing
team consistent when installing an update over an existing Cheapo app. Use a
fresh checkout to generate the native files so local changes are easy to review.

## Prepare the Xcode workspace

Use the repository's Node and pnpm versions, Xcode supported by Expo SDK 58, and
CocoaPods. Xcode 27.2 (27B52) and CocoaPods 1.17.0 were used for the initial
workspace generation. [Expo SDK 58 requirements](https://docs.expo.dev/versions/v58.0.0/)

From the repository root, with `CHEAPO_AUTH_TEST` and `CHEAPO_FIELD_TEST` unset:

```sh
nvm use
pnpm install --frozen-lockfile
pnpm expo prebuild --platform ios --no-install
(cd apps/mobile/ios && pod install)
open apps/mobile/ios/cheapoapp.xcworkspace
```

Expo generates `apps/mobile/ios` locally and may rewrite the mobile package's
`ios` and `android` scripts during prebuild. Review and discard those script
changes if they came from prebuild. Keep the Node executable used by Xcode's
build scripts on the pinned version via the generated `.xcode.env.local` file.

## Compile for iPhone

To check native compilation before setting up signing, build a Release app
for the generic iOS device destination:

```sh
RCT_NO_LAUNCH_PACKAGER=1 xcodebuild \
  -workspace apps/mobile/ios/cheapoapp.xcworkspace \
  -scheme cheapoapp -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath apps/mobile/ios/build/local -jobs 2 CODE_SIGNING_ALLOWED=NO build
```

The build creates an unsigned `.app` under
`apps/mobile/ios/build/local/Build/Products/Release-iphoneos/`. To verify a
simulator build separately, select a simulator in Xcode and run the Release
scheme. Record the simulator model and installed iOS runtime.

## Install on an iPhone

1. Connect the unlocked iPhone. Confirm it is paired and has Developer Mode
   enabled. In Xcode's Apple Accounts settings, sign in with your Apple Account
   if a team is missing. A Personal Team can sign an app for local testing.
   [Apple Developer account overview](https://developer.apple.com/help/account/basics/about-your-developer-account/)
2. In Xcode, select the `cheapoapp` target, open Signing & Capabilities, and
   choose your team with automatic signing enabled. Keep team settings local to
   the generated project.
3. Set the Run action in the `cheapoapp` scheme to **Release**, select the
   connected iPhone, and run the app. Release embeds the JavaScript bundle for
   launch without Metro. [Expo local build guide](https://docs.expo.dev/guides/local-app-development/)
4. Quit the app and reopen it from the phone with Metro and the Mac companion
   stopped. For an update, install over the existing app so its local drafts
   are retained. If Xcode rejects the update, record its error before changing
   any signing or install settings.

For each check, record the source commit, Xcode and iOS versions, app version
and build number, signing/install outcome, and whether the app launched. Keep
simulator results, native device compilation, signed installation, and standalone
launch as separate results. For a binary you retain, record the SHA-256 of its
archive alongside its filename.
