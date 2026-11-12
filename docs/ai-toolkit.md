# AI development toolkit

This project uses Expo SDK 58, React Native 0.88.1, React 19.3, Expo Router 58,
TypeScript 6.0.3, Node 24.22.2, and pnpm 10.11.0. Targets: Android, iOS and web.
There are three Jest/RNTL camera tests; these mock native camera APIs.

## Installed skills and plugins

| Tool | Installed version / source | Scope |
| --- | --- | --- |
| Official Expo plugin | `expo@expo-plugins` 1.14.3, official `expo/skills` repository | User's Codex installation |
| Callstack building React Native apps | `building-react-native-apps@openai-curated-remote` 0.2.0 | User's Codex installation |
| Callstack testing React Native apps | `testing-react-native-apps@openai-curated-remote` 0.1.0 | User's Codex installation |
| Matt Pocock TDD and bug diagnosis | `mattpocock/skills` revision `4ae2317ddb22b046e26455e4f9c9b3aaaf62212d` | User’s `~/.codex/skills` |
| Codebase design reference | Same revision; referenced by TDD | User’s `~/.codex/skills` |

The official Expo source was audited at revision
`a9e5bd3fa00b4e61f632e43f85da73aee1942582`. Callstack sources were audited at
`59e9d17446a248b21d86f078fcd0bd2d36db1ca4`; the testing guide also comes from
`callstack/react-native-testing-library`. Plugin bundles include other task-specific
skills; use only those relevant to the requested work. Expo Router guidance takes
precedence over recipes for standalone React Navigation. Check installed library
versions before following older performance or testing examples.

Use TDD for behavior changes and bug diagnosis for reproducible failures. These
skills are guidance within the user's authorized scope: don't add repetitive
permission requests, mandatory interviews, refactors, or extra infrastructure.
The broader Matt Pocock requirements/review bundles were deferred because they
bring issue-tracker/spec workflows. Existing task clarification and code review
remain in use.

## Expo connection

Expo CLI and the plugin's `expo` MCP connection were authenticated during setup.
Credentials stay in the tools' local credential storage, never in this repository.
The MCP endpoint is `https://mcp.expo.dev/mcp`.

The Codex discovery check returned authenticated Expo tools, including
`read_documentation`, `search_documentation`, and automation tools. This is tool
inventory verification, not proof that every operation is available on the account.
Expo documents some features, including documentation search, as requiring a paid
Expo Services plan. No cloud builds, deployments, paid simulators, or feedback
submissions were run as part of setup.

During initial setup, a fresh Codex discovery process found the Expo plugin
skills and all three engineering skills in their former project location with no
discovery errors. The three engineering skills have since been moved unchanged
to the user’s `~/.codex/skills`; discovery after relocation has not been verified.
Both curated Callstack bundles are reported installed and enabled by the plugin catalog, but their skills did not
appear in the standalone discovery process. Start a new Codex desktop chat in
this checkout to refresh the managed plugin skill list. Their availability inside
this already-running chat has not been verified; do not equate installation with
active tools. The personal engineering skills should be available on the next
turn. Newly added MCP tools likewise require the chat/session tool list to refresh.

We have not added `expo-mcp` to app dependencies. Native local verification uses
the dedicated device tools below, avoiding overlapping local automation setups.
Context7 was deferred: official version-specific documentation plus Expo MCP
already cover the current documentation needs.

## Updating

- Curated Callstack bundles: manage updates through Codex Plugins; check the
  displayed version and inspect changed skill instructions before using updates.
- Official Expo repository plugin: `codex plugin marketplace upgrade expo-plugins`,
  inspect changed instructions, then `codex plugin add expo@expo-plugins` and verify
  the installed version with `codex plugin list --json`. Don't also install the
  same Expo skills through another source.
- Personal engineering skills in `~/.codex/skills`: intentionally pinned. Use
  Codex's skill-installer with the new reviewed commit and paths `skills/engineering/tdd`,
  `skills/engineering/diagnosing-bugs`, and `skills/engineering/codebase-design`.
  Install into a temporary staging directory, review the diff, then replace the
  corresponding personal directories and update the revision above. Preserve
  `~/.codex/skills/MATT-POCOCK-LICENSE` and keep a backup of the previous copies
  so updates are reviewable and reversible. These personal skills are not
  distributed with this repository; other contributors must install their own
  copies from the pinned source if they want to use them.

## Routine verification

```sh
nvm use
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
```

After dependency changes also run `pnpm expo install --check`,
`pnpm expo:doctor`, and `pnpm build` from the repository root.
Bundle exports are not native binary builds. A camera smoke test must distinguish
mocked tests, emulator UI, browser UI, and actual physical-device capture.

## Official sources

- https://docs.expo.dev/agents/
- https://docs.expo.dev/mcp/
- https://github.com/expo/skills
- https://github.com/callstackincubator/agent-skills
- https://github.com/callstack/agent-device
- https://github.com/mattpocock/skills
- https://docs.maestro.dev/
- https://github.com/upstash/context7

## Local native tools

The tools are kept outside app dependencies in `~/.local/share/cheapo-tools`:
agent-device **0.21.36** and Maestro **2.12.1**. They use the existing Android SDK
and JDK 17; no SDK licences, device resets, or paid cloud runs are part of this setup.

On this Mac, prepare a terminal with:

```sh
nvm use
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$HOME/.local/share/cheapo-tools/node_modules/.bin:$HOME/.local/share/cheapo-tools/maestro/maestro/bin:$PATH"
agent-device --version
maestro --version
```

The smoke flow targets the existing Android Expo Go installation (`host.exp.exponent`)
and Metro on port 8081. Boot `Pixel_9_API_36`, run `pnpm start --localhost --port 8081`,
and run:

```sh
maestro --udid emulator-5554 test .maestro/scan-permission.yaml
```

`10.0.2.2` in the flow is the Android emulator's route to the host Mac. It is not a
physical-phone address. The flow opens the real app, navigates to Scan, and checks
permission UI or already-authorized camera controls. It does not capture/upload
photos, grant new permissions, clear Expo Go data, or verify camera hardware.

To update agent-device, inspect its release notes and install an explicitly chosen
version with `npm install --prefix "$HOME/.local/share/cheapo-tools" agent-device@VERSION`.
To update Maestro, review the official installation guide and replace its standalone
installation with a chosen release. Verify versions and rerun the smoke flow after
either update; record the new versions in `ai-toolkit-sources.json`.

## Setup validation (2026-11-09)

- TypeScript, lint and all three camera unit tests passed after toolkit setup.
- Application dependencies and source screens were not changed by this setup.
- Expo CLI login and Expo MCP OAuth login completed successfully. A fresh Codex
  process returned Expo tool names and OAuth authentication status.
- Engineering skills (`tdd`, `diagnosing-bugs`, `codebase-design`) were discovered
  and enabled with no errors in their original project location. They were later
  relocated to `~/.codex/skills` with SHA-256 verification of all 12 skill/licence
  files; post-relocation discovery has not been verified. Expo plugin skills were
  discovered. Curated Callstack plugins were confirmed installed/enabled; refresh the desktop chat to check
  their managed skill availability.
- iOS simulator interaction and physical camera capture remain unverified. The
  earlier iOS simulator startup problem has not been resolved by this toolkit.
- Android Maestro smoke: passed on `emulator-5554` / Pixel_9_API_36 with Expo Go.
  The mandatory permission-or-capture assertion and granted-state Flip Camera
  assertion completed; this emulator already had camera permission. The fresh
  permission branch is included but was not exercised in this run. The flow
  returns from an existing scan screen so it can be rerun without clearing data.

- agent-device independently verified native UI access: opening Expo Go with
  `agent-device open host.exp.exponent --platform android --foreground --no-record`,
  selecting Cheapo from its recent-app picker using a fresh snapshot, returning
  Home, then clicking Scan price displayed the capture and flip controls. A
  screenshot was captured at `/private/tmp/cheapo-agent-device-camera.png`.
  Snapshot element references are ephemeral; always take a fresh snapshot before
  choosing an element. Opening the release Expo Go package directly with a URL
  hit a `run-as: package not debuggable` limitation; the foreground package/picker
  path worked without changing device security or app permissions.
