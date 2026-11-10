# Saved ChatGPT login on the development Mac

This optional companion mode saves renewable ChatGPT credentials in macOS Keychain.
The Pixel still uses its separate expiring pairing code; no provider token is sent
to the app. Normal Cheapo account sign-in is not part of this increment.

Use Node 24.22.2 and pnpm 10.11.0. From this checkout:

```sh
SAVE_LOGIN=1 MOBILE_TEST=1 PORT=8768 CHEAPO_STATE_DIRECTORY=/absolute/path/to/existing/tools/route1-demo/.state node tools/route1-demo/server.mjs
```

The explicit state directory reuses this host's existing host ID, issued client ID
and verified account mapping. It contains no plaintext tokens. Keep using the same
state directory on later starts. Without that option the checkout's own `.state/`
is used, which may register a different local host.

Open `http://127.0.0.1:8768`, sign in once, and check the **Sign-in saved in Mac
Keychain** status. The old memory-only prototype discarded its refresh token, so
this one new sign-in is needed to acquire a renewable session. Restarting the saved
companion should restore it without another OAuth flow. No photo submission is
needed to verify saved sign-in.

The helper is compiled locally with Apple's installed Swift compiler. It calls
Apple Security.framework with default Keychain access controls; it does not grant
access to all applications or change Keychain permissions. macOS may request access
or an unlock. Credentials pass only through private process pipes, never command
arguments, browser storage, source files or diagnostic logs. A stable compiled
helper is reused until its source changes. Builds and nonsecret local metadata
remain under the ignored owner-only `.state/` directory.

A kernel advisory lock prevents multiple saved companions from rotating one
registration concurrently, including across checkouts. Rotation is single-flight
inside the process; replacements must save successfully before new access tokens
can be used. If Keychain saving fails, the replacement is retained in memory and
saving is retried rather than reusing the consumed refresh token. Expiry comes
from the token response. Temporary network errors retain credentials; terminal
refresh errors require sign-in again. A temporary identity-key lookup failure
retains the rotated refresh token without accepting the new access token.

**Sign out of ChatGPT** stops local use, attempts revocation of the renewable
session, then clears Keychain credentials. Temporary revocation failures get one
bounded retry. If remote revocation is not confirmed, the UI says so and points
to ChatGPT Settings. Registration metadata remains for returning sign-in.

No API-key billing fallback exists. Refreshing saved authentication does not send
photos or automatically retry inference. Physical-phone routing and pairing are
unchanged until explicitly configured to use this companion.

Official references: [accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions),
[token fields and lifetimes](https://developers.openai.com/siwc/token-sharing-open-source/token-reference),
[refresh recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery),
[Apple Keychain Services](https://developer.apple.com/documentation/security/keychain-services).

## Verification status

- Real temporary dummy Keychain save/read/delete passed without provider credentials.
- Exclusive-lock verification rejected a second process for the same account.
- Offline tests cover restart restoration, rotation/concurrency, failed saves,
  registration mismatch, temporary/terminal failures, logout racing refresh,
  refresh request parameters, identity validation, and revocation endpoint guards.
- User completed live sign-in with saved mode on port 8768. A backend-only restart
  restored signedIn=true, savedLogin=true and inferenceAllowed=true without another
  OAuth flow or inference request. Expiry-driven provider refresh and live remote
  revocation remain unverified; their behavior is covered by offline tests.
