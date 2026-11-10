# Local Sign in with ChatGPT checkpoint

Independently written, dependency-free desktop feasibility demo. This is an undecided Cheapo product route, not a production integration or a statement that this repository is approved for any distribution program. No license is added or changed; no DevKit code is included. The mobile camera flow is untouched.

## Run only after review

Use Node **24.22.2** (the repository `.nvmrc`). From the repository root:

```sh
nvm use
node --test tools/route1-demo/core.test.mjs tools/route1-demo/response-debug.test.mjs
```

The demo creates and saves a random `urn:uuid:` host identifier under the ignored
`.state/` directory on first run. It contains no account or device details.
Start the server manually:

```sh
node tools/route1-demo/server.mjs
```

Open **http://127.0.0.1:8766**. The server binds only to loopback. Set `PORT` to another unprivileged port if needed; the callback uses the exact same port, host and `/auth/callback` path for authorization and exchange. Do not expose this server through a tunnel or shared host.

1. Click **Sign in with ChatGPT**, then complete OpenAI's browser flow. This is the first outbound action; merely starting the server makes no OpenAI request.
2. After sign-in the demo loads the model catalog and selects `gpt-5.6-luna` if listed, otherwise `gpt-6-luna` if listed. It does not select another model.
3. The local test photo is preloaded. You may replace it with a PNG/JPEG/WebP under 5.9 MB. Click **Send image and draft price** to trigger one request. This may consume eligible ChatGPT plan usage; no API-key fallback or paid API workflow exists here.
4. The response is shown raw with its HTTP status and safe response headers; this checkpoint does not parse it into a price draft. Each explicit request appends a JSONL record to `tools/route1-demo/.state/response-debug.jsonl`, including the raw response text up to 1 MB per response (with a truncation marker when needed). Credential/cookie headers are excluded; request headers, tokens and the input photo are never logged. The ignored `.state/` directory is owner-only. Nothing is written to a database or uploaded to a Cheapo backend.

Stop with Ctrl-C. **Forget local session** clears in-memory tokens; it does not revoke provider grants. Access and refresh tokens are never written to disk; expiry or restart requires a new sign-in. Only the host ID, issued client ID and verified account subject are stored under the ignored `.state/` directory so the same local registration and account can be reused. The files are owner-only.

The demo uses fresh state/nonce/PKCE, validates the issued ID token against OpenAI JWKS and required claims, checks the granted inference scopes, and uses the public model catalog and Responses endpoint (`store:false`, `stream:true`). This diagnostic checkpoint displays the provider response without interpreting it as a price draft. Host, Origin, local cookie and CSRF checks protect local POSTs. There are no tool calls or downstream actions.

## Evidence and limits

Focused offline tests cover authorization parameters/PKCE, signature and identity claims, request guards, image request constraints/schema, and stream completion/error/refusal handling. These do not verify live login, entitlement, quota accounting, model compatibility, or real image quality. No browser, simulator, physical-device, native-build or bundle verification is implied by those tests. This prototype is not run automatically by the app.

Official references used for the prototype: [local/open-source registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [OIDC validation](https://developers.openai.com/siwc/website). This local experiment does not itself establish eligibility for a distribution route.

## Optional Android emulator companion mode

The separate development increment is documented in
[mobile test readiness](../../docs/mobile-test-readiness.md). Start this isolated
checkout with `MOBILE_TEST=1 PORT=8768 node tools/route1-demo/server.mjs`, complete
Mac-browser sign-in, load the catalog, and obtain a runtime pairing code. The
emulator can then explicitly submit the selected local photo bytes and show a
validated JSON price draft. The mobile route is disabled unless `MOBILE_TEST=1`;
its pairing guard is separate from unchanged browser OAuth guards. The listener
remains loopback-only; do not expose it to a LAN or tunnel. No provider tokens are
sent to the phone. Session persistence/refresh remains a separate next increment.
