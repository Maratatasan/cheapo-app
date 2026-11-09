# Local Sign in with ChatGPT checkpoint

Independently written, dependency-free desktop feasibility demo. This is an undecided Cheapo product route, not a production integration or a statement that this repository is approved for any distribution program. No license is added or changed; no DevKit code is included. The mobile camera flow is untouched.

## Run only after review

Use Node **24.22.2** (the repository `.nvmrc`). From the repository root:

```sh
nvm use
node --test tools/route1-demo/core.test.mjs
```

The demo creates and saves a random `urn:uuid:` host identifier under the ignored
`.state/` directory on first run. It contains no account or device details.
Start the server manually:

```sh
node tools/route1-demo/server.mjs
```

Open **http://127.0.0.1:8766**. The server binds only to loopback. Set `PORT` to another unprivileged port if needed; the callback uses the exact same port, host and `/auth/callback` path for authorization and exchange. Do not expose this server through a tunnel or shared host.

1. Click **Sign in with ChatGPT**, then complete OpenAI's browser flow. This is the first outbound action; merely starting the server makes no OpenAI request.
2. Click **Load model catalog**. Only catalog entries with `visibility: "list"` appear. Visibility alone does not establish image/schema compatibility or account access.
3. Select a model and PNG/JPEG/WebP price-label image under 5.9 MB. Click **Send image and draft price** to trigger one request. This may consume eligible ChatGPT plan usage; no API-key fallback or paid API workflow exists here.
4. Review the completed JSON draft against the image. Unclear values should be null. Nothing is written to a database or uploaded to a Cheapo backend. The chosen image is sent to OpenAI only when drafting.

Stop with Ctrl-C. **Forget local session** clears in-memory tokens; it does not revoke provider grants. Access and refresh tokens are never written to disk; expiry or restart requires a new sign-in. Only the host ID, issued client ID and verified account subject are stored under the ignored `.state/` directory so the same local registration and account can be reused. The files are owner-only. No credentials or provider bodies are logged.

The demo uses fresh state/nonce/PKCE, validates the issued ID token against OpenAI JWKS and required claims, checks the granted inference scopes, uses the public model catalog and Responses endpoint (`store:false`, `stream:true`), and accepts output only after `response.completed`. Host, Origin, local cookie and CSRF checks protect local POSTs. Images and model output are untrusted; review before use. There are no tool calls or downstream actions.

## Evidence and limits

Focused offline tests cover authorization parameters/PKCE, signature and identity claims, request guards, image request constraints/schema, and stream completion/error/refusal handling. These do not verify live login, entitlement, quota accounting, model compatibility, or real image quality. No browser, simulator, physical-device, native-build or bundle verification is implied by those tests. This prototype is not run automatically by the app.

Official references used for the prototype: [local/open-source registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [OIDC validation](https://developers.openai.com/siwc/website). This local experiment does not itself establish eligibility for a distribution route.
