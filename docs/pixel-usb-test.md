# Pixel USB test

This local development flow keeps Metro, the selected JPEG and the ChatGPT
companion on Mac loopback. It does not expose a LAN server or transfer provider
tokens to the phone. Use Node 24.22.2 and pnpm 10.11.0.

1. Connect Pixel by USB, enable USB debugging and approve the Mac on the phone.
   List devices with `adb devices`. Choose its actual serial, not emulator-5554.
2. Forward the three local ports, substituting that serial:

   ```sh
   adb -s PIXEL_SERIAL reverse tcp:8085 tcp:8085
   adb -s PIXEL_SERIAL reverse tcp:8767 tcp:8767
   adb -s PIXEL_SERIAL reverse tcp:8768 tcp:8768
   ```

3. Run the fixture and companion as described in
   [mobile setup](mobile-test-readiness.md). Keep an already signed-in companion
   running; don't start another process on its port.
4. Start this checkout's Metro for the physical phone (stop only an earlier Metro
   process on this checkout's port if it must change target configuration):

   ```sh
   EXPO_PUBLIC_CHEAPO_TEST_PHOTO_URL=http://127.0.0.1:8767/test-photo.jpg EXPO_PUBLIC_CHEAPO_COMPANION_URL=http://127.0.0.1:8768 pnpm start --localhost --port 8085
   ```

5. Open `exp://127.0.0.1:8085` in SDK58 Expo Go. First verify Home → Scan →
   permission/camera and test-photo preview/Retake. The offline card route
   `exp://127.0.0.1:8085/--/dev-draft` checks the shared result card without AI.
6. An explicit Analyse action sends the selected photo to OpenAI using the signed-in
   ChatGPT plan. Do this only when the user chooses that submission. Pairing is an
   expiring code entered for the current session, never a build-time credential.

The emulator uses `10.0.2.2` instead of the physical phone's forwarded `127.0.0.1`.
Set the two nonsecret URLs per Metro session; pairing credentials never belong in
these variables. Disconnecting USB stops forwarded transport. You can remove a
forward with `adb -s PIXEL_SERIAL reverse --remove tcp:8085` (and the other ports).

Current integration verification: Android emulator native offline card displayed
£2.50, £1.25/kg, review uncertainty and explicit unknown shop/location/date. The
live draft boundary is covered by mocked completed-response tests. No additional
AI request was made for card integration. Physical Pixel capture/submission and
iPhone remain separately verified tasks. Bundle export is not a native build.
