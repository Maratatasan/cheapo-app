# CI and Turbo cache standard

Run the same commands from the repository root locally and in CI:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm ui:storybook:build
pnpm build
```

The required `verify` job runs these commands on every pull request to main. It
also runs the Route 1 and JDK 17 auth helper tests, Expo dependency validation, and
Expo Doctor directly. Expo's Android, iOS, and web exports are bundle checks.
Device checks, native generation and binary builds, live services, and
interactive development run without Turbo caching.

## Tasks and inputs

- Define scripts in the package that owns the work. Use root `turbo.json` for
  shared task definitions and package-level `turbo.json` for package-specific
  inputs, outputs and environment. Keep the default package inputs unless there
  is a verified reason to narrow them. When customizing inputs, start with
  `$TURBO_DEFAULT$` and retain any imported source, fixtures, and config. Add
  necessary inputs outside the package to the consuming task only. Reserve global
  inputs for settings that affect the whole repo, such as `.nvmrc`.
- Use `env` for environment variables that change results. Include any relevant
  local environment files in `inputs` if the tool reads them. Turbo can infer
  framework environment variables across package tasks, as it does for Expo's
  public variables. Use `passThroughEnv` for uncached tasks or values that do not
  affect cache correctness. Keep credentials, private photos, live response logs, and other
  sensitive data out of cached outputs and task logs.
- Declare generated files as package-relative `outputs`. Mobile bundle exports
  restore `dist/` and Storybook restores `storybook-static/`. Checks that only
  report a result need no file outputs. Keep development servers persistent and
  uncached.

## Workspace dependencies

Declare internal imports with pnpm workspace dependencies in the consuming
package. Turbo uses the package's lockfile dependency resolutions when hashing
tasks. Root `^transit` edges also carry source changes through declared
dependencies, even through packages with no scripts. The scriptless `transit`
task allows checks to run independently of other packages' checks. If an
imported source-only package reads environment variables, declare them in the
consuming task.

Build and Storybook additionally use `^build` so prerequisite builds finish
first. If a new package's test, lint or typecheck consumes generated dependency
files, add the build edge to that consuming task too. Use `$TURBO_EXTENDS$` to
retain inherited dependency edges when extending the array in package config.
Declare the producing package's outputs so the files are present on cache hits.

## GitHub cache

CI starts the full task graph and lets Turbo reuse individual results. A cache
miss or outage runs the required checks. Keep path filters and affected-only
selection out of the required job unless its coverage is separately verified.

GitHub Actions restores `.turbo/cache` separately from the pnpm store. Archive
keys include runner OS and architecture, the Node, pnpm and Turbo versions, and
the revision. Compatible older revisions can provide reusable task results.
Successful main runs save archives. Pull requests can restore available main
archives and use Turbo's hashes to validate each task result. Turbo Remote Cache
is disabled.

A cold run executes all checks. GitHub transfers the archive as a unit and can
evict older entries under its cache limits. Monitor archive size and restore time
as packages and outputs grow.

## Verifying changes

When adding or changing a package or task, inspect the resolved inputs, outputs,
environment and dependency edges with `pnpm exec turbo run <task> --dry=json`.
Run twice to show a cache hit and move any declared outputs aside before replay
to check restoration. Check that an unrelated package edit preserves the result
and that a shared dependency, relevant config, or relevant environment change
invalidates it. Verify the required CI job also passes with a cold cache.

References: [Turborepo cache model](https://turborepo.com/docs/crafting-your-repository/caching),
[task dependencies](https://turborepo.com/docs/crafting-your-repository/configuring-tasks),
and [GitHub Actions caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching).
