# Working on Cheapo

- This checkout belongs to `Maratatasan/cheapo-app`. The old `cheapo-ui` starter is unrelated; do not copy its screens over this app.
- Plan single-purpose PRs before implementation and aim for fewer than 700 handwritten lines changed. Follow the [Cheapo PR guidance](https://docs.google.com/document/d/1SJUGxANp46SqcsACD3Si8RQ1RbpBAAcxl9q8IAK7sQA/edit#heading=h.pnpk0hmujgnp).
- Read README.md for setup and platform limitations. Use the Node version in `.nvmrc` and pnpm version in `package.json`; maintain only `pnpm-lock.yaml`.
- Run install, development, and checks from the repository root. Expo lives in
  `apps/mobile`; keep its dependencies there and use the root pnpm workspace and lockfile.
- Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` after code changes. These commands
  and `pnpm build` use Turbo. For dependency changes, also run
  `pnpm expo install --check`, `pnpm expo:doctor`, and `pnpm build`.
- Follow the [CI and Turbo cache standard](docs/ci.md) for new packages and tasks.
  Keep cache inputs, outputs, and environment scoped to their consumers. Declare and
  verify workspace dependency edges so shared changes invalidate dependent tasks.
- Use `pnpm expo <command>` for app-specific Expo CLI calls from the root.
  Interactive platform commands, native generation/builds, device checks and live
  service tests run directly without Turbo caching. Run Gradle inside the generated
  `apps/mobile/android` project when following the Android build instructions.
- See the [app map](docs/app-map.md) for the current flow and responsibility boundaries. Preserve the scan-to-local-save flow and update the map when a flow or responsibility boundary changes.
- Follow the [UI verification standard](docs/ui-verification.md) for UI changes and their handoff evidence.
- Camera tests mock hardware. Report simulator, browser, physical-device, and bundle checks separately; a bundle export is not a native build.
- Follow official Expo release notes and upgrade one SDK at a time. Keep React, React Native, TypeScript, and Expo modules within the supported SDK versions.
- Preserve uncommitted work and avoid unrelated refactors.
- For new AI, photo, storage, or UI work, follow the incremental boundaries in
  [docs/architecture-principles.md](docs/architecture-principles.md). Do not
  refactor existing code solely to match the document.

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
