# Working on Cheapo

- This checkout belongs to `Maratatasan/cheapo-app`. The old `cheapo-ui` starter is unrelated; do not copy its screens over this app.
- Read README.md for setup and platform limitations. Use the Node version in `.nvmrc` and pnpm version in `package.json`; maintain only `pnpm-lock.yaml`.
- Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` after code changes. For dependency upgrades, also run `pnpm exec expo install --check`, `pnpm dlx expo-doctor`, and `pnpm exec expo export --platform all`.
- Preserve the home → scan → permission → capture → preview/retake flow. Upload is a stub, not a working backend integration.
- Camera tests mock hardware. Report simulator, browser, physical-device, and bundle checks separately; a bundle export is not a native build.
- Follow official Expo release notes and upgrade one SDK at a time. Keep React, React Native, TypeScript, and Expo modules within the supported SDK versions.
- Preserve uncommitted work and avoid unrelated refactors.
