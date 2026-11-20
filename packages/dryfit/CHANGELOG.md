# @dryfit/cli

## 0.5.0

### Minor Changes

- ff4f9ec: Hide the apps you don't work on: `dryfit hide <app>` (or Hide App in the menu bar app) stops listing an app, even though it uses your libraries, and `dryfit unhide` (or Show in Settings) lists it again. Nothing in the app changes, and a linked app has to be restored first.
- 649ed40: Libraries from one workspace that pin each other exactly, such as an Nx workspace with independent releases, now work together. `dryfit link <app> --library a --library b` links several libraries in one step, each dev build pins the other registered libraries' dev builds, a sync also republishes the libraries that depend on the one that changed, and every install into an app puts all of its linked libraries in with one package manager run. Restoring one library also restores the linked libraries tied to it. A failed install names the libraries to link along.

### Patch Changes

- d5af514: `dryfit link` now exits 1 when the install into a consumer fails, with `--json` too, and `link --group`
  reports that member as failed instead of done. A failed link keeps the end of the package manager's
  output as `message`, so `link --json`, `status --json` and `dryfit status` show why (such as npm's
  `ERESOLVE`) without rerunning the install, and the daemon log records it.
- b30b0aa: In the menu bar app's window, a long sidebar no longer shows through the Add button at its bottom: the rows now stop at the bar's edge.

## 0.4.2

### Patch Changes

- 3db3667: `dryfit add --publish-dir` now keeps the detected build command, and `dryfit add --build` keeps the
  detected publish folder. Before, passing one flag left the library with no build step or publishing its
  sources.

## 0.4.1

### Patch Changes

- 0933325: Dev builds of a scoped library now always publish to dryfit's local registry. Before, an `@scope:registry` line in your `.npmrc`, or a `registry` in the library's `publishConfig`, sent them to that registry instead, often the public npm registry.

## 0.4.0

### Minor Changes

- 188ccb8: The menu bar app now notices when the dryfit it runs is older than the app, and offers to update it: one click runs `npm install --global @dryfit/cli@latest` and restarts dryfit on the new version, keeping your links and watches. When the app is the older side of a mismatch, it offers Check for Updates instead.

## 0.3.0

### Minor Changes

- a78632f: The menu bar app now keeps itself up to date: it checks for a new version once a day, downloads it in the background and installs it while you are not using it. Settings has a switch to be asked first, and the menu has Check for Updates…. Install the app from this release once more; later versions arrive on their own.

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
