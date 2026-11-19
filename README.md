# dryfit

Test unreleased npm libraries inside real consumer apps, the way they will actually be installed.

dryfit runs a private local registry, publishes every library change as a unique dev version, installs it
into the consumer apps you choose, clears the framework caches that would hide it, and puts every consumer
back exactly as it was when you are done. No symlinks, no `file:` paths, no duplicate framework copies.

Website and docs: **[mikheil-gigauri.github.io/dryfit](https://mikheil-gigauri.github.io/dryfit/)**

## Using it

You need Node 22.12 or newer, macOS or Linux, and apps that install with npm, pnpm, Yarn 2+ or Bun. In the
folder of the library you are working on:

```bash
npx @dryfit/cli init                      # remembers where your projects live; starts dryfit
npx @dryfit/cli add                       # detects Nx, Angular CLI or a build script
npx @dryfit/cli consumers                 # who uses it; nothing changes yet
npx @dryfit/cli link ../shop ../admin     # opt in: snapshot, dev install, commit guard
npx @dryfit/cli watch                     # every save: build, publish, install, clear caches
npx @dryfit/cli restore ../shop ../admin  # back to exactly what you had
```

Once you use it daily, `npm install --global @dryfit/cli` puts `dryfit` on your PATH, and
`dryfit daemon install` starts it at login. `dryfit status` shows what is linked and running,
`dryfit doctor` checks the setup, and every command takes `--json` for scripts and agents.
`dryfit agent install` teaches Claude Code to use dryfit, so you can ask it to try your library in an app.

Consumers that run together, such as a federation host and its remotes, can be saved as a group
(`dryfit group save checkout ../shell ../cart`), linked and restored together (`--group checkout`), and
dryfit warns when they end up on different dev versions.

On macOS 26 or later, the menu bar app shows all of this and drives it without a terminal:
**[download Dryfit.dmg](https://github.com/mikheil-gigauri/dryfit/releases/latest/download/Dryfit.dmg)** and
drag the app to Applications. It is not notarized yet, so the first time, macOS refuses to open it: open it
once, then choose **Open Anyway** in System Settings → Privacy & Security.

The [getting started guide](https://mikheil-gigauri.github.io/dryfit/guides/getting-started/) walks
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
npm run menubar:bundle   # builds apps/menubar/build/Dryfit.app
```

The website lives in `apps/site` (Astro and Starlight, Node 22.23.4 or newer):

```bash
npm run dev -w @dryfit/site     # http://localhost:4321/dryfit/
npm run build -w @dryfit/site   # generates the CLI reference and design pages, then builds
```

After changing the daemon's API, run `npm run api:export -w @dryfit/cli` so both sides share the new
contract. `SNAPSHOT_RECORD=1 npm run menubar:test` records the snapshots again after a deliberate UI change.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how changes and releases work.

## License

MIT
