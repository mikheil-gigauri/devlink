# devlink

Test unreleased npm libraries inside real consumer apps, the way they will actually be installed.

devlink runs a private local registry, publishes every library change as a unique dev version, installs it
into the consumer apps you choose, clears the framework caches that would hide it, and puts every consumer
back exactly as it was when you are done. No symlinks, no `file:` paths, no duplicate framework copies.

> Status: early development. See the [build plan](docs/plan.md) and the
> [architecture decisions](docs/adr/README.md).

## Using it

devlink is not on npm yet. From a clone, build it and put `devlink` on your PATH:

```bash
npm install && npm run build
cd packages/devlink && npm link
```

Then, once:

```bash
devlink init --root ~/Repositories    # where your projects live; starts the daemon
```

And per library:

```bash
cd ~/Repositories/shared-ui
devlink add                           # detects Nx, Angular CLI or a build script
devlink consumers                     # who uses it; nothing changes yet
devlink link ../shop ../admin         # opt in: snapshot, dev install, commit guard
devlink watch                         # every save: build, publish, install, clear caches
devlink restore ../shop ../admin      # back to exactly what you had
```

`devlink status` shows what is linked and running, `devlink doctor` checks the setup, and
`devlink daemon install` starts devlink at login. Every command takes `--json` for scripts and agents.

Consumers that run together, such as a federation host and its remotes, can be saved as a group
(`devlink group save checkout ../shell ../cart`), linked and restored together (`--group checkout`), and
devlink warns when they end up on different dev versions.

## Development

```bash
npm install
npm test                  # unit tests, about two seconds
npm run test:integration  # real Verdaccio, npm and git
npm run typecheck
npm run lint
```

Requires Node 22.12 or newer.

The menu bar app in `apps/menubar` needs Xcode 26 or newer. Run it through `xcrun` so the Xcode toolchain is
used, not another `swift` on your PATH:

```bash
npm run menubar:test     # view-model, API-contract and light/dark snapshot tests
npm run menubar:e2e      # the menu's full cycle against a real daemon, in a throwaway sandbox
npm run menubar:bundle   # builds apps/menubar/build/Devlink.app
```

After changing the daemon's API, run `npm run api:export -w devlink` so both sides share the new
contract. `SNAPSHOT_RECORD=1 npm run menubar:test` records the snapshots again after a deliberate UI change.

## License

MIT
