# Oxlint evaluation

**Recommendation (12 November 2026).** Defer adoption and keep using root
`pnpm lint`, which runs the mobile package’s `expo lint` through Turbo. The
stable Oxlint candidate still needs ESLint for 32 of the preset’s 72 active
TypeScript rules. With both tools running, cold lint takes the same time as
running the existing ESLint preset directly. [Issue #33](https://github.com/Maratatasan/cheapo-app/issues/33)

## Current coverage

The baseline is main at `c1d3e98` with Expo CLI 58.1.20, ESLint 9.39.5 and
`eslint-config-expo` 58.0.4. Expo CLI looks for existing `src`, `app` and
`components` directories. Cheapo has `app` and a singular `component`, so the
root lint command checks the seven route files in `apps/mobile/app`. For a
targeted check outside that directory, use
`pnpm --filter cheapo-app exec eslint component/results/shop-map.web.tsx`.
Root `pnpm typecheck` separately runs TypeScript 6.0.3.

ESLint’s `--print-config` showed 72 active rules for TS, TSX and declaration
files, including the web map, and 66 for JS, JSX, MJS and CJS. The preset’s
import resolver tries the `.android`, `.ios`, `.web` and `.native` suffixes
alongside unsuffixed JS and TS extensions. Its browser globals include Expo
and React Native additions such as `__DEV__`, `ErrorUtils` and `process`. It
adds Node globals for `metro.config.js` and disables `no-undef` in TypeScript.
The config ignores `dist`, `storybook-static` and `android/app/build`.
The default directory scope also keeps generated `.expo` files out of root
lint. Explicitly targeting a JS file inside `.expo` runs ESLint on it.
[Expo lint guide](https://docs.expo.dev/guides/using-eslint/)

## Candidate and gaps

The temporary candidate used Oxlint 1.93.0 with default rule categories
disabled and the preset’s severities and options carried over where supported.
The fallback extended the existing Expo config and disabled the 43 rule IDs
assigned to Oxlint across both languages. That moved 40 active rules for TS
and 37 for JS. Both configurations still needed maintenance when the Expo
preset changed. [Oxlint 1.93.0](https://github.com/oxc-project/oxc/releases/tag/oxlint_v1.93.0) · [Migration guide](https://oxc.rs/docs/guide/usage/linter/migrate-from-eslint)

| Area | Candidate Oxlint mapping | ESLint fallback |
| --- | --- | --- |
| Core and TypeScript | Core checks including `eqeqeq`, `no-var` and JS `no-undef`. The `typescript/` equivalents for `array-type`, `no-empty-object-type`, `no-wrapper-object-types`, `consistent-type-assertions`, `no-extra-non-null-assertion` and `no-require-imports` with the Expo asset allowlist. | `no-dupe-args`, unused variables, and the TypeScript variants of `no-dupe-class-members`, `no-redeclare` and `no-useless-constructor`. Oxlint’s unified unused-variable rule skips declaration files, and the other TS replacements would need additional parity checks. |
| React and hooks | 16 React rules including `display-name`, `jsx-key`, `jsx-no-undef` and `no-unknown-property`, plus native `react/rules-of-hooks` and `react/exhaustive-deps`. | `react/no-deprecated`, the two JSX usage rules needed by ESLint’s unused-variable check, and all 14 recommended React Compiler checks, including `refs`, `config` and `gating`. Native compiler coverage would need its own validation. |
| Imports | | All seven import rules, including `import/no-unresolved`, which has no native rule in the pinned release’s schema. Keeping the family together preserves Expo’s resolver and platform extensions. |
| Expo | | `expo/use-dom-exports`, `expo/no-env-var-destructuring` and `expo/no-dynamic-env-var`. Oxlint has no built-in Expo plugin and its JavaScript bridge is alpha. |

[Oxlint built-in plugins](https://oxc.rs/docs/guide/usage/linter/plugins) · [Unused-variable rule](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-unused-vars) · [JavaScript plugin support](https://oxc.rs/docs/guide/usage/linter/js-plugins.html)

Temporary fixtures checked both parts of the candidate independently. Oxlint
reported conditional hooks, missing effect dependencies, `var`, TypeScript
array style and an undeclared JS global. The fallback reported a missing
import, a ref mutation during render, dynamic and destructured Expo env
access, and invalid `use dom` exports. Together they reproduced the
baseline fixture diagnostics and preserved exit status 1 for errors and 0
for warnings alone. Valid fixtures passed with Expo and browser globals,
the Metro config’s Node globals, a `@/` alias, an extensionless import of a
`.web.ts` module, an asset `require` and valid `use dom` exports. Generated
fixtures in `dist`, `storybook-static`, `.expo` and `android/app/build`
were excluded by the Oxlint prototype. These probes cover representative
behaviors. Full rule equivalence was outside the evaluation.

Running the current Expo preset directly across `app`, `component`, `data`,
`lib`, `stories`, `__tests__` and `app.config.ts` exposed seven
`react-hooks/refs` errors in `component/photo-crop.tsx`, one
`react/display-name` error in `__tests__/camera.test.tsx`, and seven
TypeScript `no-require-imports` warnings. Expanding routine lint coverage
would require addressing those existing findings.

## Cold lint timing

Five interleaved runs per command on macOS arm64, Node 24.22.2 and pnpm
10.11.0. Commands ran from `apps/mobile` over the same seven route files,
outside Turbo. Expo ran with `--no-cache`; direct ESLint and its fallback
ran without `--cache`. Times are process wall-clock seconds, including
launch overhead and excluding dependency installation.

| Workflow | Median | Five runs |
| --- | ---: | --- |
| Existing `pnpm exec expo lint --no-cache` | 1.801 | 2.637, 1.801, 1.785, 2.043, 1.743 |
| Existing preset via `pnpm exec eslint app` | 1.264 | 1.345, 1.239, 1.264, 1.258, 1.273 |
| Oxlint + ESLint fallback | 1.264 | 1.261, 1.309, 1.264, 1.291, 1.251 |
| Oxlint alone (partial coverage) | 0.053 | 0.073, 0.053, 0.058, 0.052, 0.050 |
