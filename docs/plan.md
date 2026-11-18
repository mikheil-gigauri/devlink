# Build plan

Each milestone ends in something usable and is done only when its exit check passes. Design decisions are
in [`docs/adr`](adr/README.md).

## M0 · Foundations

Workspace, TypeScript, Vitest, Biome, ADRs, first TDD slice of the core: dev version scheme (ADR 0004) and
package manager detection (ADR 0006).

**Exit:** `npm test`, `npm run typecheck` and `npm run lint` pass from a clean clone.

## M1 · Core pipeline, in-process

The use cases with fake ports: register library, discover consumers, link (with snapshot), publish, install,
invalidate caches, restore. npm adapter. Angular, Native Federation and Vite integrations.

**Exit:** unit tests cover every use case, including restore after a failed install.

**Status:** done. Use cases live in `core/use-cases`, the npm adapter in `adapters/package-managers`, the
integrations in `adapters/integrations`. Tests run against an in-memory file system that shares a contract
suite with the real adapter (M2) and a simulated npm that really rewrites manifests and lockfiles, so the
restore tests prove byte-for-byte equality rather than "the right commands ran". Key behaviours were
mutation-checked: removing them makes tests fail.

Deferred on purpose: link groups and the version-coherence warning (M3, they are client features over
existing state), the commit guard hook (M3), peer-range overrides (M2, needs a real registry to verify).
Paths in core are POSIX; Windows support is not planned before M5.

## M2 · Real registry and the npm contract

Embedded Verdaccio behind the `Registry` port. npm adapter contract suite against it. Peer-range overrides
(ADR 0004).

**Exit:** the e2e test links a fixture library into two fixture consumers, sees the new code, restores, and
both consumers are byte-identical to before.

## M3 · Daemon and CLI

`devlinkd` with the HTTP API, token auth and SSE. CLI commands: `init`, `add`, `link`, `unlink`/`restore`,
`watch`, `status`, `doctor`, `daemon start|stop|status`, `hook install`. launchd agent.

**Exit:** the author uses devlink on `shared-fe-library` and its MFEs for a full working week.

## M4 · Menu bar app

SwiftUI `MenuBarExtra` client: library and consumer status, link and restore, watch toggle, groups,
notifications on failure.

**Exit:** a full cycle can be driven from the menu bar alone; view-model tests and light/dark snapshots
pass.

## M5 · Open-source launch

pnpm, Yarn and Bun adapters passing the contract suite. Website with landing page and docs (ADR 0011).
GitHub Actions for tests on macOS and Linux, Changesets releases with npm provenance. README, contributing
guide, issue templates. Signed and notarized menu bar build, Homebrew cask.

**Exit:** `npx devlink init` works for someone who has never seen the project.

## Later

`--fast` mode (copy `dist` between full installs), managed dev-server restarts, editor extension,
Webpack/Module Federation and Next.js integrations.
