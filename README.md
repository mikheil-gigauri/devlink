# devlink

Test unreleased npm libraries inside real consumer apps, the way they will actually be installed.

devlink runs a private local registry, publishes every library change as a unique dev version, installs it
into the consumer apps you choose, clears the framework caches that would hide it, and puts every consumer
back exactly as it was when you are done. No symlinks, no `file:` paths, no duplicate framework copies.

> Status: early development. See the [build plan](docs/plan.md) and the
> [architecture decisions](docs/adr/README.md).

## Development

```bash
npm install
npm test
npm run typecheck
npm run lint
```

Requires Node 22.12 or newer.

## License

MIT
