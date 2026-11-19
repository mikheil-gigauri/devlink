# 0008. Repository layout and tooling

**Status:** Accepted · 2026-11-18

## Context

One repository holds a Node package, a Swift app and a website. Contributors should be able to clone, run
one install, and have tests pass, without learning a monorepo framework.

## Decision

```
dryfit/
├── packages/dryfit/     the published npm package: CLI, daemon, core
│   └── src/
│       ├── core/         pure domain logic; no Node I/O imports
│       ├── adapters/     package managers, integrations, registry, fs, process
│       ├── daemon/       HTTP API, SSE, pipeline orchestration
│       └── cli/          argument parsing and rendering only
├── apps/menubar/         SwiftUI app (Swift Package Manager / Xcode)
├── apps/site/            project website
└── docs/adr/
```

- **npm workspaces**, no Nx or Turborepo. The JavaScript surface is one package plus a site, so a task
  runner would cost more than it saves.
- **TypeScript**, strict, ESM only, Node 22.12 or newer (Node 20 is end-of-life). Bundled with tsdown into a single CLI entry.
- **Vitest** for tests, **Biome** for linting and formatting (one fast tool, zero plugin config).
- **Changesets** for versioning and changelogs; releases publish to npm with provenance from GitHub Actions.
- The name `dryfit` is unscoped on npm and currently free.
- The `core` folder may not import `node:*` modules. A lint rule enforces it, which keeps the domain
  testable without mocks of the file system.
- License: MIT.

## Consequences

- One `npm install` at the root sets up the JS side; Swift builds independently with `swift build`.
- If the JS side grows into several published packages, adding Nx later is cheap because the boundaries
  already exist as folders.
