# 0007. Consumer integrations for cache invalidation

**Status:** Accepted · 2026-11-18

## Context

After a successful install, dev servers often keep serving the old library. Angular's builder pre-bundles
dependencies into `.angular/cache`; Vite does the same in `node_modules/.vite`; Native Federation caches
shared bundles under `node_modules/.cache/native-federation`. This, more than linking itself, is why
"my change didn't apply" is so common.

## Decision

Framework knowledge lives in small integrations, each detected from the consumer's manifest and files:

```ts
interface ConsumerIntegration {
  readonly id: string; // 'angular', 'native-federation', 'vite', ...
  detect(project: ProjectInfo): boolean;
  cachePaths(project: ProjectInfo): string[];
}
```

After install, dryfit removes the union of cache paths for the detected integrations and notifies the
user (or a managed dev server, later) that a restart is needed. Users can add paths in config for anything
we do not detect.

The first integrations are Angular, Native Federation, Vite and Webpack/Module Federation, because they
cover the author's own stack and a large share of real use.

## Consequences

- Adding a framework is a single file with a fixture-based test, which makes it a good first contribution.
- Deleting caches costs one slower dev-server start per cycle, which is the price of never seeing stale code.
