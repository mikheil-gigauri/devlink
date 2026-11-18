# 0002. Embedded Verdaccio as the local registry

**Status:** Accepted · 2026-11-18

## Context

Testing an unreleased library inside consumer apps has four common answers, and each fails differently:

- **Symlinks** (`npm link`, `pnpm link`) resolve the library's peer dependencies from its own
  `node_modules`, so Angular and React apps end up with two copies of the framework. Bundlers also need
  `preserveSymlinks`, and module-federation share maps get confused by the real path.
- **yalc** copies files and rewrites `package.json` to `file:.yalc/...`, which is not what production does
  and leaves artifacts that get committed.
- **Copying `dist` into `node_modules`** is fast but silently ignores changes to the library's own
  dependencies, and the next install erases it.
- **A local registry** (Verdaccio) exercises the real path: `npm publish`, the `files`/`exports` fields,
  dependency and peer resolution, lifecycle scripts. It is slow only because people drive it by hand.

## Decision

devlink is built on a local npm registry, and that registry is Verdaccio, started in-process by the devlink
daemon through Verdaccio's programmatic API. It listens on `127.0.0.1` only, stores packages under
`~/.devlink/registry`, and proxies everything it does not hold to the uplinks the user already uses
(read from their npm config), so only packages published by devlink are served locally.

devlink automates the parts that made Verdaccio painful: versioning (ADR 0004), installing and restoring
(ADR 0005), and cache invalidation (ADR 0007).

## Consequences

- Production fidelity is the product's main promise. Anything that breaks under devlink would have broken
  after a real release.
- A cycle costs one publish plus one install, roughly 5 to 15 seconds instead of sub-second. A future
  `--fast` mode may copy `dist` between full installs, but only when the library's manifest is unchanged.
- We depend on Verdaccio's programmatic API and its major-version churn. It is isolated behind a
  `Registry` port so it can be swapped or run as a child process if the API breaks.
- Private uplinks need auth. devlink reuses the user's existing `.npmrc` tokens and never stores its own.
