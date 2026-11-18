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

**Status:** built; the exit check is the author's working week, which has not happened yet. Decisions are in
ADR 0012. `src/e2e/cli-cycle.integration.test.ts` rehearses that week in about fifteen seconds through the
`devlink` binary alone: init, add, discover, save and link a group, sync, a real `git commit` refused by
the guard, watch picking up a saved file, and a byte-for-byte group restore with the guard removed.

- Daemon (`src/daemon`): the API contract with a small validator that can describe itself as JSON
  Schema for M4, a serial job queue where syncs coalesce, an event hub with `Last-Event-ID` replay, the
  HTTP server (token, browser refusal, error mapping, SSE), and `startDaemon`, which proxies the user's
  npm registries with their credentials held in memory.
- CLI (`src/cli`): every command above plus `consumers`, `sync`, `unwatch`, `events`, `group` and
  `remove`, all with `--json`. It starts the daemon on demand, restarts it on version skew, and is bundled
  by tsdown into one 130 kB file.
- Core additions: groups and the coherence warning, unregistering, library build detection (Nx, Angular
  CLI, npm script), the commit guard's hook text, and state version 2 (version 1 files are upgraded).
- `hook install` became part of `link`: the guard is installed by default and kept current on every sync,
  because Husky regenerates hook files on install (ADR 0012).
- From M2's deferred list: child processes now have a timeout and are cancelled on shutdown, killing the
  whole process tree. The Verdaccio shutdown question is settled by design: `daemon run` exits the process
  once stopped, so lingering timers cannot keep it alive. Symlinks in `publishDir` remain open.
- A review of the M3 diff (two reviewers, every finding checked against the code) led to fixes, each
  with a test that failed first:
  - Security:
    - a damaged token file could make the daemon accept `Bearer undefined`; the token is now linked
      into place whole, and a damaged one is replaced;
    - `daemon stop` could signal a reused pid named by a stale `daemon.json`; health is now public, and
      the CLI acts only on the pid that health confirms;
    - a losing second registry start rewrote the running registry's htpasswd; it is now written only
      once the port is claimed.
  - Commit guard: it missed non-ASCII paths, deleted a hook that had been empty before, and could cut
    off user lines when its end marker was edited away.
  - Robustness:
    - a command that leaves a background process holding its output no longer hangs until the
      15-minute timeout;
    - an SSE client that stops reading is cut off instead of buffered for;
    - watch failures are reported and turn watching off;
    - a failed daemon start releases both ports;
    - `stop` always resolves.
  - CLI:
    - `--json` exits 1 when something failed;
    - `restore` works from a subfolder and keeps going past one failing consumer;
    - `add` without flags keeps the stored build;
    - `doctor` checks that the launchd agent is loaded;
    - an Angular library without `dest` publishes ng-packagr's `dist`.
- Known limits:
  - On Linux, Node's recursive `fs.watch` also watches `node_modules` before devlink filters it, which
    can exhaust inotify on large repositories; Linux is an M5 platform, so a filtered walk lands then.
  - Two CLI versions used side by side restart the daemon on each switch, cancelling a running job.
  - Nx projects defined without `project.json`, or with inferred targets, fall back to an npm build
    script or to publishing the library root; `add --build/--publish-dir` covers them.
- Not covered by automated tests: restarting a daemon of another version (it needs two builds), and
  `daemon install`, whose plist is unit-tested but which was not loaded into launchd on the author's
  machine without asking.

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
