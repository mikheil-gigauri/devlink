# 0009. Testing strategy

**Status:** Accepted · 2026-11-18

## Context

dryfit edits other people's repositories. A bug does not crash dryfit; it corrupts someone's lockfile.
That calls for strong tests, and the hexagonal split (ADR 0008) makes most of the logic testable without
I/O.

## Decision

Test-driven development for the core: write the failing test, make it pass, refactor. Four layers:

1. **Unit (core).** Pure functions and use cases with in-memory fakes for the ports (`FileSystem`,
   `ProcessRunner`, `Clock`, `Registry`). Fast, run on every save. Most tests live here.
2. **Contract (adapters).** One shared suite per port, run against every adapter with real tools in temp
   directories: each package-manager adapter publishes to and installs from a real Verdaccio on a random
   port. This is where "supports pnpm" gets proven.
3. **Integration (daemon).** The HTTP API and SSE stream exercised in-process, with fake adapters.
4. **End to end.** A fixture library and two fixture consumers; the CLI links, publishes, verifies the
   consumer resolves the new code, restores, and asserts the consumer is byte-identical to before.

Tests sit next to the code as `*.test.ts`. Contract and e2e suites are tagged so `npm test` stays fast and
CI runs everything.

## Consequences

- The restore guarantee in ADR 0005 is an executable test, not a promise.
- Contract tests need network-free fixtures and a Verdaccio per run; they are slower and run in CI on
  macOS and Linux.
- The Swift app is tested through its view models against a fake API client, plus snapshot tests of the
  menu in light and dark mode.
