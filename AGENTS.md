# Working on Cheapo

- This checkout belongs to `Maratatasan/cheapo-app`. The old `cheapo-ui` starter is unrelated; do not copy its screens over this app.
- Read README.md for setup and platform limitations. Use the Node version in `.nvmrc` and pnpm version in `package.json`; maintain only `pnpm-lock.yaml`.
- Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` after code changes. For dependency upgrades, also run `pnpm exec expo install --check`, `pnpm dlx expo-doctor`, and `pnpm exec expo export --platform all`.
- Preserve the home → scan → permission → capture → preview/retake flow. Upload is a stub, not a working backend integration.
- Camera tests mock hardware. Report simulator, browser, physical-device, and bundle checks separately; a bundle export is not a native build.
- Follow official Expo release notes and upgrade one SDK at a time. Keep React, React Native, TypeScript, and Expo modules within the supported SDK versions.
- Preserve uncommitted work and avoid unrelated refactors.

## AI toolkit

- Read `docs/ai-toolkit.md` for installed skills, device tools, update procedures,
  authentication requirements, and verified versus unverified capabilities.
- Prefer Expo's SDK-specific guidance for Expo Router and native configuration;
  Callstack's performance/testing guidance supplements it. Detect RNTL's installed
  major version before selecting synchronous or asynchronous test APIs.
- Use the personal TDD/bug-diagnosis skills in `~/.codex/skills` when available and relevant. Preserve the user's
  authorization and scope; skill workflow preferences do not require repeated
  approval for already-authorized routine work.
- Installing a plugin does not authorize cloud spending, deployment, feedback
  submissions, or external messages. Use local device verification by default.
