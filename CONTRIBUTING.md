# Contributing to devlink

Thanks for helping. Bug reports with a way to reproduce them are as valuable as code.

## Reporting a problem

Open an issue with the bug report template. Include `devlink doctor --json`, the package manager and
framework of the app you linked, and the end of `~/.devlink/logs/daemon.log` if the service was involved.

## Making a change

devlink is built test-first. A behaviour change starts with a test that fails, and a fix starts with a test
that reproduces the bug.

```bash
npm install
npm test                  # unit tests, seconds
npm run test:integration  # real Verdaccio, npm, pnpm, Yarn, Bun and git; about a minute
npm run typecheck
npm run lint              # Biome; `npx biome check --write .` fixes formatting
```

pnpm, Yarn and Bun are dev dependencies of the repository, so the integration tests use pinned versions
and need nothing installed globally. `scripts/newcomer.sh` packs the CLI and runs it with `npx` in an empty
home folder, the way a first-time user would; set `DEVLINK_PORTS=api,registry` if devlink already runs on
your machine.

Where things live:

- `packages/devlink/src/core`: the logic, with no Node APIs, tested against fakes.
- `packages/devlink/src/adapters`: Node, Verdaccio, git and the package managers, tested for real.
  A new package manager adapter must pass `describePackageManagerContract`.
- `packages/devlink/src/daemon` and `src/cli`: the background service, its HTTP API, and the CLI.
- `apps/menubar`: the macOS menu bar app (Swift). Run its tests with `npm run menubar:test`.
- `apps/site`: the website. Guides are in `src/content/docs/guides`; the CLI reference and design pages
  are generated, so edit `USAGE` in `src/cli/main.ts` or `docs/adr` instead.
- `docs/adr`: one record per design decision. A change to a decision gets an amendment or a new record.

## Changesets

Every pull request that changes what users get adds a changeset:

```bash
npx changeset
```

Pick `devlink`, the kind of change (patch for fixes, minor for features while devlink is 0.x), and write
one or two sentences for the changelog, in the user's terms. Changes to tests, docs or CI need none.

## Releasing

Releases run from `.github/workflows/release.yml` on every push to `main`. While changesets are pending,
it keeps a "Version packages" pull request up to date. Merging that pull request publishes to npm with
provenance, tags `devlink@<version>`, and builds the menu bar app.

The repository needs these secrets:

| Secret                                            | For                                                                                                                                                                     |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NPM_TOKEN`                                       | Publishing to npm. A granular token with publish rights to `devlink`; once the package exists, switch to npm trusted publishing for this workflow and remove the token. |
| `MACOS_CERTIFICATE`, `MACOS_CERTIFICATE_PASSWORD` | A base64 "Developer ID Application" certificate (`.p12`) and its password, for signing `Devlink.app`.                                                                   |
| `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD` | Notarizing the app. The password is an app-specific password for the Apple ID.                                                                                          |
| `HOMEBREW_TAP_TOKEN`                              | Pushing the updated cask to `mikheil-gigauri/homebrew-devlink`. A fine-grained token with contents write access to that repository only.                                |

Without the Apple secrets the menu bar job is skipped with a warning; npm publishing does not depend on
it. To build a release locally: `DEVLINK_UNIVERSAL=1 DEVLINK_SIGN_IDENTITY="Developer ID Application"
npm run menubar:bundle`, then `apps/menubar/scripts/notarize.sh`, then
`apps/menubar/scripts/cask.sh <version> <sha256>` for the cask.

## Conduct

Be kind and assume good intent. Maintainers may remove comments or contributors that are not.
