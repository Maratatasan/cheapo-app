# Mobile test starting point

The first increment is Android emulator photo preview, followed by physical
Android testing and later iPhone. It adds a development-only **Use test photo**
action on Scan. This opens the same preview with **Retake** and the existing
**Upload Photo** stub. Camera permission is not required to view the fixture.
An optional explicit **Analyse test photo** action now submits that selected photo
through the local Mac companion and displays the returned draft. Scan history is
not implemented.

## Run the local preview increment

Use Node 24.22.2 and pnpm 10.11.0. Install the normal app dependencies, then in
separate terminals from this checkout:

```sh
node tools/test-photo.mjs /absolute/path/to/PXL_20250817_155127355.jpg
```

```sh
EXPO_PUBLIC_CHEAPO_TEST_PHOTO_URL=http://10.0.2.2:8767/test-photo.jpg pnpm start --localhost --port 8082
```

The fixture server binds only to Mac loopback on port 8767 and serves only the
chosen JPEG. Nothing is copied into app assets or committed. `10.0.2.2` routes
from the Android emulator to the Mac; it is not a physical-phone address. Open
`exp://10.0.2.2:8082` in SDK58-compatible Expo Go, then **Scan price → Use test
photo**. This requires an explicit tap; opening Scan does not load the photo.
A missing URL or stopped fixture server produces a visible alert. **Retake**
returns to the ordinary permission/camera flow. The fixture action is absent in
release builds. Stop the two local servers with Ctrl-C after testing.

Use an otherwise unused Metro port; port 8082 avoids changing an existing server
on 8081. Do not place private photos under Expo's public directory: public files
can be copied into a web export. No test fixture is required to build this app.

## Run the emulator AI increment

Keep the fixture server and Expo running as above. Start a separate local
companion instance (the prior desktop instance can remain on port 8766):

```sh
MOBILE_TEST=1 PORT=8768 node tools/route1-demo/server.mjs
```

Open `http://127.0.0.1:8768` on the Mac, sign in with ChatGPT, and let the account
model catalog load. Click **Get emulator pairing code**, then enter the code into
the native preview's **Mac pairing code** field. Click **Analyse test photo** only
when ready to send this photo to OpenAI using the signed-in ChatGPT plan. The code
expires after 30 minutes; getting another code invalidates the previous code.
Pairing is held only in memory and never embedded in app configuration.

The phone reads the selected photo's actual JPEG bytes and sends them to the
loopback companion; the Mac does not choose a replacement image. The companion
uses only listed `gpt-5.6-luna` or `gpt-6-luna`, with no API-key fallback. The modal
shows progress, then a JSON draft requiring review, or a safe failure. There are
no automatic retries. **Back to preview** returns to the original preview controls.

The companion still binds only Mac loopback. Its native `/mobile/draft` route has
an independent expiring pairing-key guard, accepts only the loopback/emulator
Host names and rejects browser Origin requests. Browser OAuth routes retain their
cookie/CSRF/Host checks. Provider tokens stay in the Mac process; they are never
transferred to the phone. A legitimate completed SSE response is accepted even
when Content-Type is absent. Raw provider responses remain in the owner-only local
`.state/response-debug.jsonl`; raw bodies and session headers are not sent to the
phone result UI.

This connection is verified for the Android emulator only. `10.0.2.2` does not work
as a physical-phone address. A physical Android transport and later iPhone test
remain separate increments. Successful desktop sign-in does not verify native
phone authentication.

## Saved sign-in: next increment

The companion currently keeps tokens in memory; stopping it or expiry requires
sign-in again. The next requested increment is protected Mac Keychain storage
and serialized refresh-token rotation using the issued client and resource,
with explicit forget/revoke behavior. Do not write tokens into JSON, app public
configuration or logs. Phone pairing remains separate from the provider account;
normal Cheapo account sign-in is deferred. See the [official profiles and sessions
guide](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).
No saved-auth implementation is included in this checkpoint.

## Local diagnostics proposal

Use a small on-device SQLite history once the test route is chosen: attempt ID,
time, stage, success/failure, model, safe provider request ID/status and an optional
reviewable price draft. Include an explicit clear-history action. Do not store
tokens, passwords, cookies, provider session headers, input photos or raw provider
bodies in that history. Do not claim history exists before its storage and UI have
been implemented and checked.

Expo SDK 58 recommends `expo-sqlite` **~58.0.15**, includes it in Expo Go and
persists databases across restarts. Web SQLite requires additional WebAssembly
and server-header setup, so any native-only history needs an explicit web fallback.
No SQLite dependency was installed during this preparation. See the [SDK 58 SQLite
documentation](https://docs.expo.dev/versions/v58.0.0/sdk/sqlite/).

The existing desktop checkpoint writes owner-only local diagnostic JSONL under
its ignored `.state/` directory. That is desktop response debugging, not mobile
scan history. Its response-header capture now uses an explicit diagnostic allowlist,
excluding provider session headers such as `x-codex-turn-state`. Earlier log files
are not rewritten by the fix and may contain that header; treat them as private
session material and do not share them.

## Acceptance checks for the eventual phone test

1. Capture a real price label, preview it and retake it.
2. Explicitly submit one chosen photo; never submit automatically on capture.
3. Show a reviewable product/price/currency/uncertainty result, or a useful failure
   with stage and attempt ID. A stream with no Content-Type header must not be
   rejected solely for that missing header.
4. Confirm no duplicate submission while pending, then retry a failed request.
5. Reopen the app and inspect persisted attempt history; verify clear history.

Live sign-in and a single user-authorized photo submission through the ChatGPT
plan were verified for this increment. No remote database or cloud deployment
was provisioned. Mocked tests, browser UI, Android
emulator UI, iOS simulator UI, physical capture, bundle export and native binary
build must each be reported separately. A bundle export is not a native build.

## Verified checkpoint (2026-11-10)

- Pixel_9_API_36 / emulator-5554: opened Cheapo in the official SDK58 Expo Go
  58.0.5 APK (updated in place from incompatible 2.33.20), Home → Scan → Use test
  photo. The native preview displayed the selected potato label with £2.50;
  accessibility exposed Price photo preview, Upload Photo and Retake. Retake
  restored Take Picture of Price, Flip Camera and Use test photo. Camera permission
  was already granted on this emulator; the denied branch is covered by mocked
  tests, not a fresh native permission run.
- Screenshot: `/private/tmp/cheapo-test-photo-preview.png` (local artifact).
- The loopback fixture bytes matched the original JPEG's SHA-256 exactly;
  unrelated paths and non-GET requests returned 404.
- TypeScript, lint, nine mocked app tests and eleven desktop prototype tests passed.
- No browser/iOS/physical-device verification, hardware capture, AI call, bundle
  export or native binary build was performed for this increment.

## Verified AI checkpoint (2026-11-10)

- On the same Android emulator, entered an ephemeral pairing code without printing
  or saving it, then tapped **Analyse test photo** once. The native modal first
  showed Waiting for ChatGPT plan draft and disabled submission, then displayed
  `gpt-5.6-luna` with product **Albert Bartlett Rooster Potatoes 2kg**, price **2.5**,
  currency **GBP** and a visible uncertainty explanation.
- Native accessibility text and screenshot both verified that result:
  `/private/tmp/cheapo-emulator-ai-result.png`. This is emulator evidence, separate
  from any successful desktop-browser request. No automatic retry was sent.
- TypeScript, lint, eleven mocked app tests and fourteen Node prototype tests passed.
  The added boundary tests cover wrong/expired pairing, foreign Hosts/browser
  Origin, missing Content-Type with completed SSE, and failed/refused/incomplete
  output. App tests cover explicit submission and visible network failure.
- No physical-device, iPhone, browser-build, bundle-export or native-binary-build
  verification is implied by the emulator result.

## Unit-price field (offline verified, companion restart pending)

The requested JSON schema now adds one field:
`unit_price: { amount: number, unit: string } | null`, using the top-level currency.
The model is instructed to prefer a visible unit-price label, or derive it only
from unambiguous pack price and quantity and explain the calculation in uncertainty.
Missing quantities/units must remain null. The completed-draft validator rejects
missing or malformed unit prices, including negative/non-numeric amounts and empty
units. The native result presents **Pack price: £2.50** and **Price per unit:
£1.25/kg** for the potato example; null displays **Unavailable**.

This field is covered by offline schema/parser/UI tests. No further live inference
was sent. The signed-in companion on port 8768 was deliberately kept running, so
it still uses its previously loaded schema until restarted. Restarting currently
requires sign-in again; saved sign-in remains a separate next increment. The
previous native result screenshot predates this new field and does not prove a
live unit-price response.
