# @dryfit/cli

## 0.2.0

### Minor Changes

- 00e1d46: `dryfit agent install` teaches Claude Code to use dryfit: it installs a skill, shipped in the package, into `~/.claude/skills` (`--project` for this project's `.claude/skills`, `--dir` for another agent's skills folder), and `dryfit agent show` prints it. Under `--json`, errors now come as JSON on stderr too, `{ "error": { "code", "message", "hint" }, "exitCode" }`, so scripts and agents can tell what failed and what to do.

## 0.1.0

### Minor Changes

- 863f0e9: First release. dryfit publishes a library to a local registry and installs it into the projects that
  use it, with npm, pnpm, Yarn (2 and later) or Bun, and restores each project byte for byte afterwards.
  It comes with a daemon that rebuilds and reinstalls on every change, a CLI, a pre-commit guard that
  keeps dev builds out of commits, and a macOS menu bar app.
- 863f0e9: The daemon's API can preview a library folder before it is added (`inspect`) and read and change the project folders (`roots`, `setRoots`), so the menu bar app can set everything up without a terminal. The app has its own icon, lists the apps that use your libraries, and calls watching Auto-sync.
- 863f0e9: `dryfit restore --library <name>` (and `restore` in the daemon's API with `library`) puts one library in an app back on its release and keeps the app's other links. Restoring an app from a library's page in the menu bar app now does this, instead of restoring every library in that app.
