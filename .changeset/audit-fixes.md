---
'@dryfit/cli': patch
---

Fixes from a full audit. Dev publishes no longer run the library's own `prepublishOnly`, `prepack` or `prepare` scripts, and `workspace:` devDependencies no longer block them. `NPM_TOKEN` and your own `NPM_CONFIG_*` settings now reach installs, and quoted npmrc tokens work. Watching a library that builds into its own folder, or holds an example app, no longer syncs in a loop. The same app reached through a symlink or with different letter case is one app, and dryfit refuses to snapshot files that already hold a dev build. Linking a pending or failed link again retries it. Workspace packages without their own lockfile are refused instead of changing the root lockfile. One unreadable folder no longer stops the search for apps.

The commit guard leaves alone hooks that git tracks, symlinked hooks and hooks that are not shell scripts. It gives a hook back its original mode, stays while another linked app shares the hook, and a guard that cannot go in is reported as a warning instead of failing the link. `link --group` honours `--no-guard`, and `restore --group` refuses `--library`. `--build` refuses shell syntax, and `daemon status --json` prints JSON. The CLI no longer gives up on jobs longer than five minutes, and after a restart it no longer misses events. A second daemon cannot replace the running registry's password, and a bad npmrc registry no longer stops the daemon from starting. The login agent keeps proxy and CA settings.

In the menu bar app, a slow start no longer shows a false timeout, an event it cannot read no longer drops the connection, refused requests no longer post notifications, and progress clears after the daemon restarts.
