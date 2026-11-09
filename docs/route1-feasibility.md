# Route 1: Sign in with ChatGPT feasibility

Status: **not cleared for a live integration; product route undecided**
(reviewed 2026-11-09).

This is a feasibility record for the proposed flow: sign in to ChatGPT, ask for
permission to use eligible plan usage, extract fields from a captured price
photo, show those fields for user review, then let Cheapo validate its own data.
No credentials, authorization requests, API calls, account registrations, or
production writes were used in this review.

## Findings

### Access and eligibility

Sign in with ChatGPT distinguishes identity sign-in from optional ChatGPT plan
usage. The plan scopes are separately requested and the user must consent to
them. Plus and Pro users are eligible where plan usage is supported, and the
user manages app access in ChatGPT settings.

OpenAI's current documentation describes plan usage for open-source and locally
hosted apps. For a paid or remotely hosted app, it directs the developer to an
interest form, and the Quickstart says commercial plan usage is currently
limited to selected partners. The user has not chosen whether Cheapo will be
open source or closed source/commercial. Keep both routes open; no licence or
public status was changed as part of this spike.

| Product route | Plan-use eligibility implication | Callback implication |
| --- | --- | --- |
| Open-source, locally run app | SIWC documentation says plan usage is available to open-source partners. Cheapo has no `LICENSE` file, so its public repository alone does not establish eligibility. The product would need a deliberate open-source decision and whatever licence/status that entails. | The SIWC open-source client guide specifies the loopback callback described below. A native implementation still needs device verification. |
| Closed-source or commercial app | For a paid or remotely hosted app, OpenAI directs developers to its interest form; plan use is limited to selected commercial partners. Submission is not approval. Until selected/approved, user-funded plan inference is unavailable through this path. | The open-source client callback guide does not establish the commercial partner's native mobile callback contract. Obtain the applicable partner guidance before choosing a redirect or implementing auth. |

These routes concern **ChatGPT plan usage**. Identity sign-in by itself does not
grant plan usage. Neither route is selected or approved by this feasibility
spike.

### Native mobile callback

The documented open-source client flow uses the system browser and an HTTP
loopback callback at `127.0.0.1`. It requires a listener to be running before
the browser opens, and the callback URI's scheme, host, and path must stay the
same through the authorization and token exchange (only the port may vary).
The guide does not describe an app-scheme/deep-link callback as an alternative.
This requirement is specific to the documented open-source client route; the
commercial partner route needs its own confirmation from OpenAI.

Cheapo is an Expo / React Native app. Its current app flow has no local HTTP
callback server. Expo browser-based OAuth/deep-link handling by itself does not
meet this loopback contract. A native development build with a loopback HTTP
listener may be a viable implementation, but I found no official OpenAI or
Expo guidance establishing that combination, and it has not been verified on
iOS or Android. Expo Go and web support are also unverified. Treat native
callback support as an unresolved technical gate, not as a confirmed dead end.

### Photo input and structured result

The SIWC preview contract allows text, images, and files when the selected
account model supports them. It requires `store: false`, `stream: true`, and
completion to be confirmed from the terminal stream event. The model catalog is
account-specific; use it rather than hard-coding a model name. The documented
flow does not support the Files upload API, so a captured image would need to be
sent as an accepted image input (for example, a data URL) to a listed
vision-capable model.

The general Responses API documentation separately supports image inputs and
Structured Outputs. The SIWC material does not demonstrate this exact
image-plus-schema combination for its eligible model catalog. Therefore the
combination is plausible but unverified for plan usage until an eligible test
account can make an authorized request. No inference call was made.

## Smallest useful next experiment

Once product eligibility is clear, first prove the required callback on a
native development build without contacting OpenAI:

1. Start a loopback listener on `127.0.0.1` and launch a local test page in the
   system browser.
2. Return a synthetic callback containing a matching `state`; verify the app
   receives it and rejects mismatched state, missing code, and OAuth errors.
3. Repeat on physical iOS and Android devices. Record Expo Go and web behavior
   separately; neither is assumed to work.
4. Only after the callback works and eligibility is confirmed, add the official
   SIWC flow and an explicitly consented image request. Use a test image, a
   listed account model that accepts images, strict schema output, and no DB
   write. Keep the captured fields in a review step; Cheapo validation happens
   only after the user confirms them.

Do not substitute API keys, saved Codex credentials, ChatGPT backend endpoints,
or a deep-link redirect for the published SIWC flow.

## Evidence reviewed

- [SIWC Quickstart](https://developers.openai.com/siwc/quickstart) — eligible
  users and plans, partner/open-source distinction, separate scopes and consent.
- [Open-source plan-usage overview](https://developers.openai.com/siwc/token-sharing-open-source)
  — open-source/local scope; paid or remotely hosted apps should submit an
  interest form.
- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
  — loopback callback, PKCE/state/nonce, permission validation and credential
  handling.
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
  — account model catalog and public Responses endpoint requirements.
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
  — stream/store requirements and accepted inputs.
- [Images and vision](https://developers.openai.com/api/docs/guides/images-vision)
  and [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
  — general API support for image analysis and schema-constrained responses;
  these do not prove the pairing is available for every SIWC-eligible model.

## Validation

This change records documentation findings only. No application code or tests
were changed or run, and there was no simulator, browser, physical-device, or
bundle-export check.
