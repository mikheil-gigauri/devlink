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

**Status:** done. `src/e2e/link-cycle.integration.test.ts` runs the exit check with nothing faked: a public
registry holding the release, devlink's registry proxying it, real npm, two consumers (one without a
lockfile), two edit cycles, and a byte-for-byte restore. Mutating restore makes it fail.

- Real adapters: `NodeFileSystem` (passes the shared contract), `NodeProcessRunner` (no shell, strips
  inherited `npm_*` config), `JsonStateStore` (atomic, versioned), `VerdaccioRegistry`.
- The registry refuses browser requests (`Origin` header or a foreign `Host`), because Verdaccio's
  permissive CORS would otherwise let any web page read private dev builds. Publishing uses Basic auth for
  one user seeded before the port opens, with registration disabled and a password that changes on every
  start; it reaches npm through a private staged `.npmrc`, never the process list. Storage is `0700`.
  Details in the ADR 0002 amendment.
- Peer-range overrides were not needed: real npm installs a dev prerelease against a peer range. ADR 0004
  is amended, and a contract test pins the behaviour for future adapters.
- Tests are split: `npm test` (unit, about a second) and `npm run test:integration` (real registries).
- A review after the exit check led to: the auth redesign above; `copyDir` and the in-memory fake now
  agree on empty folders and a missing source (new contract cases); state entries are validated on load
  and the state file is flushed before its atomic rename; integration tests ignore the machine's global
  npmrc; the e2e compares the installed dependency tree, not only manifests and lockfiles.
- Deferred to M3, where the daemon's process lifecycle is designed: timeouts and cancellation for child
  processes (a hung `npm install` currently waits forever), and whether Verdaccio leaves timers or handles
  behind after `stop()` (harmless in a one-shot test run, relevant to a long-lived daemon that restarts
  its registry). Also open: how `npm publish` treats symlinks inside `publishDir`; staging copies them
  verbatim and npm decides.
- Verdaccio is pinned to 6.x because 7 requires Node 24. `npm audit --omit=dev` reports two root
  advisories inside Verdaccio's tree (ReDoS in `picomatch` and `minimatch`); both need attacker-controlled
  glob patterns, which devlink's fixed config and loopback-only registry do not expose. Revisit when the
  Node 22 floor is raised (Node 22 leaves maintenance in April 2027) or if an advisory becomes reachable.

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
