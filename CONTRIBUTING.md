# Contributing to dryfit

Thanks for helping. Bug reports with a way to reproduce them are as valuable as code.

## Reporting a problem

Open an issue with the bug report template. Include `dryfit doctor --json`, the package manager and
framework of the app you linked, and the end of `~/.dryfit/logs/daemon.log` if the service was involved.

## Making a change

dryfit is built test-first. A behaviour change starts with a test that fails, and a fix starts with a test
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
home folder, the way a first-time user would; set `DRYFIT_PORTS=api,registry` if dryfit already runs on
your machine.

Where things live:

- `packages/dryfit/src/core`: the logic, with no Node APIs, tested against fakes.
- `packages/dryfit/src/adapters`: Node, Verdaccio, git and the package managers, tested for real.
  A new package manager adapter must pass `describePackageManagerContract`.
- `packages/dryfit/src/daemon` and `src/cli`: the background service, its HTTP API, and the CLI.
- `apps/menubar`: the macOS menu bar app (Swift). Run its tests with `npm run menubar:test`.
- `apps/site`: the website. Guides are in `src/content/docs/guides`; the CLI reference and design pages
  are generated, so edit `USAGE` in `src/cli/main.ts` or `docs/adr` instead.
- `docs/adr`: one record per design decision. A change to a decision gets an amendment or a new record.

## Changesets

Every pull request that changes what users get adds a changeset:

```bash
npx changeset
```

Pick `@dryfit/cli`, the kind of change (patch for fixes, minor for features while dryfit is 0.x), and write
one or two sentences for the changelog, in the user's terms. Changes to tests, docs or CI need none.

## Releasing

Releases run from `.github/workflows/release.yml` on every push to `main`. While changesets are pending,
it keeps a "Version packages" pull request up to date. Merging that pull request publishes to npm with
provenance, tags `@dryfit/cli@<version>`, and builds the menu bar app.

Publishing needs no npm token: the `@dryfit/cli` package trusts this workflow through npm's trusted
publishing (on npmjs.com, the package's Settings → Trusted publishing: user `mikheil-gigauri`, repository
`dryfit`, workflow `release.yml`, with `npm publish` allowed). npm adds the provenance itself.

Every release attaches `Dryfit.dmg`, a universal build of the menu bar app. Signing and notarizing it
needs these secrets:

| Secret                                            | For                                                                                                                                     |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `MACOS_CERTIFICATE`, `MACOS_CERTIFICATE_PASSWORD` | A base64 "Developer ID Application" certificate (`.p12`) and its password, for signing `Dryfit.app`.                                    |
| `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD` | Notarizing the app. The password is an app-specific password for the Apple ID.                                                          |
| `HOMEBREW_TAP_TOKEN`                              | Pushing the updated cask to `mikheil-gigauri/homebrew-dryfit`. A fine-grained token with contents write access to that repository only. |

Without the Apple secrets the app is signed ad hoc and not notarized, so users confirm it once in System
Settings (the menu bar guide says how), and no cask is pushed; npm publishing does not depend on any of
it. To build the disk image locally: `DRYFIT_UNIVERSAL=1 npm run menubar:dmg`. A signed release adds
`DRYFIT_SIGN_IDENTITY="Developer ID Application"`, runs `apps/menubar/scripts/notarize.sh` between
`menubar:bundle` and `apps/menubar/scripts/dmg.sh`, then `apps/menubar/scripts/cask.sh <version> <sha256>`
for the cask.

## Conduct

Be kind and assume good intent. Maintainers may remove comments or contributors that are not.
