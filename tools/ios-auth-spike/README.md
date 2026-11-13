# iOS mock sign-in lifecycle

This Simulator-only harness for [#91](https://github.com/Maratatasan/cheapo-app/issues/91)
opens a local mock authorization page in the system browser. The app owns its
HTTP callback listener on `127.0.0.1` and accepts one synthetic code for the
current state. It records lifecycle events and requires an explicit foreground
Continue. All requests stay on loopback and use synthetic data.

## Run locally

In one terminal on macOS, use the repository's Node version and start the mock
page from the repository root:

```sh
node tools/ios-auth-spike/mock-page.mjs 18765
```

In a second terminal, choose one iOS 26+ Simulator from
`xcrun simctl list devices available`. Boot it, open the Simulator window,
then build, install, and launch the harness:

```sh
simulator_id='<selected simulator UDID>'
app_path="$(mktemp -d)/MockAuth.app"
sh tools/ios-auth-spike/build.sh "$app_path"
xcrun simctl boot "$simulator_id"
xcrun simctl bootstatus "$simulator_id" -b
xcrun simctl install "$simulator_id" "$app_path"
SIMCTL_CHILD_MOCK_PAGE_PORT=18765 xcrun simctl launch \
  "$simulator_id" com.maratatasan.cheapo.mock-auth
```

## Scenarios

1. Open Safari from the app and immediately send the valid callback. Return
   to the app and check that it waits for Continue before reporting completion.
2. Start again, wait at least 20 seconds in Safari, then send the callback.
   Note Safari's result, return to the app, and check for pending Continue
   or a retry. A socket may accept a connection before the app can process it.
3. Send the invalid callback. Return to the app and confirm that Continue
   stays disabled. Cancel, start a fresh attempt, and repeat with the valid
   callback. Also try returning without any callback and then cancelling.

Read the timestamped events from the harness's own container:

```sh
data_path="$(xcrun simctl get_app_container \
  "$simulator_id" com.maratatasan.cheapo.mock-auth data)"
cat "$data_path/Documents/events.log"
xcrun simctl shutdown "$simulator_id"
```

The log records lifecycle and pass/fail events without query values. Stop the
mock page with Ctrl-C in its terminal when finished.

## Observed on iPhone 17 Pro Simulator

Xcode 27.2, iOS 26.5, 2026-11-13. The first cold Safari launch timed out and a
second reported a browser-open failure. Opening the same local mock page
directly confirmed that Safari could load it. The following tests then used
the harness to open the warmed Safari.

| Scenario | Observation |
| --- | --- |
| Valid callback, then return | Safari showed its loading control after the link was tapped. The app entered the foreground at 13:02:25 UTC and recorded the accepted callback in the same second, before becoming active at 13:02:26. Completion was recorded only after tapping Continue at 13:02:29. |
| Delayed valid callback | Waited over 20 seconds in Safari before sending. Safari was still loading before the manual return. The app was in the background from 13:02:49 to 13:03:30, then processed the callback at 13:03:31 while active. Cancel cleared the enabled Continue control. |
| Invalid state | The callback was rejected on return and Continue remained disabled. Cancel cleared the attempt. |
| Return without a callback | Continue remained disabled. Cancel returned the app to a state that could open a fresh attempt. |

## Decision

Hold [#96](https://github.com/Maratatasan/cheapo-app/issues/96). The simulator
processed queued requests on return, and no callback was observed being
processed during the background interval. Safari showed a loading state until
the manual return. The flow needs reliable recovery on a physical iPhone
before production implementation. Exercise the same scenarios across a longer
delay, device lock, an expired attempt, and app termination. Confirm that the
user can return from the browser without losing a valid response or being
left with an unexplained loading page.

OpenAI's documented route uses the exact HTTP loopback callback and a system
browser. Apple's authentication session callback options cover custom schemes
and HTTPS, so a switch to either requires provider guidance for the applicable
route. Keep authorization state, nonce and PKCE verifier scoped to one attempt.
Keep Continue foreground-only, expire or cancel the listener and pending
attempt, and discard callbacks on replay or mismatch. Use the existing
RS256/JWKS and issuer, audience, subject, expiry and nonce checks with a
reviewed iOS verification implementation. Use protected device-only Keychain
storage for any validated session, with explicit sign-out and expiry handling.
Provider eligibility and user consent are separate from simulator results.

If those gates pass, estimate two small PRs over 2–4 engineering days: a native
listener and lifecycle adapter with synthetic tests, then integration and
device verification of the foreground exchange and session. The estimate
excludes provider approval and any change to the published redirect contract.

- [OpenAI registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Apple background execution sequence](https://developer.apple.com/documentation/uikit/about-the-background-execution-sequence)
- [Apple web authentication callback options](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession/callback)
- [Expo SDK 58 SecureStore](https://docs.expo.dev/versions/v58.0.0/sdk/securestore/)
