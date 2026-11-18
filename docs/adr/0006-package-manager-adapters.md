# 0006. Package manager adapters

**Status:** Accepted · 2026-11-18

## Context

The first users run npm, but an open-source tool that only supports npm loses most of its audience.
Package managers differ in exactly the operations devlink needs: installing one package from another
registry, clean installs, lockfile formats, and how they record tarball URLs.

## Decision

The core depends on a `PackageManager` port; each manager is an adapter behind it:

```ts
interface PackageManagerAdapter {
  readonly name: 'npm' | 'pnpm' | 'yarn' | 'bun';
  readonly lockfile: string;
  install(spec: InstallSpec): Command; // one package, exact version, scoped registry
  cleanInstall(): Command; // npm ci, pnpm install --frozen-lockfile, ...
  findRegistryLeaks(lockfile: string, registryUrl: string): Leak[];
}
```

Adapters return command descriptions rather than running processes, so they are pure and unit-testable;
a `ProcessRunner` port executes them.

The registry is passed per invocation and per scope (`--@scope:registry=...` for npm and pnpm, environment
config for Yarn Berry), never written into the consumer's `.npmrc`.

Detection order for a consumer: the `packageManager` field in `package.json`, then the single lockfile
present, then npm. More than one lockfile is an error the user must resolve.

## Consequences

- npm ships first; pnpm, Yarn and Bun follow without touching the core.
- Every adapter runs the same contract test suite against a real registry (ADR 0009), so "supported" means
  tested.
