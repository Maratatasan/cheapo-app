# Local iPhone ChatGPT sign-in test

Set `CHEAPO_IOS_AUTH_TEST=1` during iOS prebuild, CocoaPods installation and
Release compilation. It creates **Cheapo iPhone Auth Test** with bundle ID
`com.maratatasan.cheapo.ios-auth-test`, version 1.0.0 (1). Use the signing and
local installation steps in [Local iOS build](ios-local-build.md), with the
generated `CheapoiPhoneAuthTest` workspace and scheme. The iPhone test has
its own app data and Keychain access group. Normal Cheapo and the Android
field app keep their existing identities.

## Device checks

1. Open **ChatGPT** from Home, then **Check this phone**. The check rejects
   an incorrect callback path and state, consumes a valid callback once,
   verifies valid and altered RS256 messages, and checks Keychain access.
   It uses a synthetic callback and makes no provider request.
2. Select **Check OpenAI connection** to verify HTTPS access to the public
   signing keys without account credentials.
3. Select **Sign in with ChatGPT on this phone**. Complete authentication
   and review consent in the system browser. When the page asks you to
   return, switch back to Cheapo and tap **Continue sign-in**. Continue is
   required in the foreground before the code exchange.
4. Check the identity, plan permission, and saved login results separately.
   Close and reopen the app, then check that saved login restores without
   another browser interaction. This test variant does not offer photo
   analysis.
5. If the browser fails, record the stage and error without copying the
   address bar, query values, or account details. **Cancel phone sign-in**
   closes the listener and prevents continuation. **Clear phone login /
   sign out** clears protected local credentials and attempts revocation.

The browser opens the provider HTTPS authorization page, then redirects to
`http://127.0.0.1:<port>/auth/callback` as required by
[OpenAI's documented open-source registration flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in).
The app binds only the local loopback endpoint. Apple may suspend apps in the
background. A successful synthetic or foreground test alone cannot establish
browser delivery on a physical iPhone after an authentication delay.

Run `sh apps/mobile/modules/cheapo-loopback/tests/apple/run.sh` on a Mac with
Xcode and local loopback access. This tests the shared Apple Network and
Security primitives, while the app self-check covers those primitives and the
app's Keychain access on the target phone.
