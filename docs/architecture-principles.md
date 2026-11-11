# Architecture principles

These are intended boundaries for future work, not a claim that the current app
already implements them. Introduce them incrementally when a real feature needs
them; do not turn them into a broad refactor or a package for every concept.

## Keep responsibilities replaceable

- **Camera capture** produces a `PhotoAsset` through the platform camera adapter.
  Camera permissions and hardware details stay at that boundary.
- **Photos** represent originals, derived crops, and their local, gallery, or
  cloud references. Keep image bytes and storage-specific URIs out of UI logic
  where a stable photo reference can be used.
- **AI analysis** accepts a photo reference or image input and returns a common,
  validated `PriceDraft`. A provider adapter owns provider authentication,
  session/transport details, and response translation. Model-specific payloads
  do not become app or UI contracts.
- **Price records** are reviewed, validated data with an explicit persistence
  boundary. The app workflow decides when a draft becomes a saved record.
- **UI** renders workflow states, forms, and cards. It does not own provider
  tokens, provider endpoints, camera APIs, or storage SDK details.

Keep dependencies moving inward: UI and application workflow depend on domain
types and interfaces; camera, AI-provider, and storage adapters implement those
interfaces at the edges. The workflow composes the pieces. Replacing an AI
provider should not require rewriting camera capture or price cards. Keep the
domain independent of AWS, OpenAI, or any other vendor.

## Keep the seams small

- Reuse shared contracts and validation schemas; do not define duplicate
  `PriceDraft` shapes in each screen or adapter.
- Use intent-based interfaces and focused adapters. Avoid a generic provider
  framework or package extraction until another real consumer needs the module.
- Keep one fixed model choice for now. If model selection is later introduced,
  show model IDs confirmed by the configured provider; never substitute an
  internal coding-agent model name.
- Treat app/project authentication and AI-provider authentication as separate
  concerns, with separate ownership and configuration.
- Test contracts with representative inputs and outputs, and mock camera
  hardware in unit tests. Verify actual capture on a physical device when that
  behavior changes.
