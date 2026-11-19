# devlink

Test unreleased npm libraries inside real consumer apps, the way they will actually be installed.

devlink runs a private local registry, publishes every library change as a unique dev version, installs it
into the consumer apps you choose, clears the framework caches that would hide it, and puts every consumer
back exactly as it was when you are done. No symlinks, no `file:` paths, no duplicate framework copies.

Website and docs: **[mikheil-gigauri.github.io/devlink](https://mikheil-gigauri.github.io/devlink/)**

## Using it

You need Node 22.12 or newer, macOS or Linux, and apps that install with npm, pnpm, Yarn 2+ or Bun. In the
folder of the library you are working on:

```bash
npx devlink init                      # remembers where your projects live; starts devlink
npx devlink add                       # detects Nx, Angular CLI or a build script
npx devlink consumers                 # who uses it; nothing changes yet
npx devlink link ../shop ../admin     # opt in: snapshot, dev install, commit guard
npx devlink watch                     # every save: build, publish, install, clear caches
npx devlink restore ../shop ../admin  # back to exactly what you had
```

Once you use it daily, `npm install --global devlink` puts `devlink` on your PATH, and
`devlink daemon install` starts it at login. `devlink status` shows what is linked and running,
`devlink doctor` checks the setup, and every command takes `--json` for scripts and agents.

Consumers that run together, such as a federation host and its remotes, can be saved as a group
(`devlink group save checkout ../shell ../cart`), linked and restored together (`--group checkout`), and
devlink warns when they end up on different dev versions.

On macOS, the menu bar app shows all of this and drives it without a terminal:

```bash
brew install --cask mikheil-gigauri/devlink/devlink
```

The [getting started guide](https://mikheil-gigauri.github.io/devlink/guides/getting-started/) walks
through it, and the [design decisions](docs/adr/README.md) explain why it works the way it does.

## Development

```bash
npm install
npm test                  # unit tests, about two seconds
npm run test:integration  # real Verdaccio, npm, pnpm, Yarn, Bun and git
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

The website lives in `apps/site` (Astro and Starlight, Node 22.23.4 or newer):

```bash
npm run dev -w @devlink/site     # http://localhost:4321/devlink/
npm run build -w @devlink/site   # generates the CLI reference and design pages, then builds
```

After changing the daemon's API, run `npm run api:export -w devlink` so both sides share the new
contract. `SNAPSHOT_RECORD=1 npm run menubar:test` records the snapshots again after a deliberate UI change.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how changes and releases work.

## License

MIT
