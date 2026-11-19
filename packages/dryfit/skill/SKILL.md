---
name: dryfit
description: Test unreleased changes to an npm library inside the apps that use it, installed the way a release would be, then put the apps back exactly as they were. Use when the user wants to try a library change in a consuming app, link or unlink a local library, replace npm link, yalc or file dependencies, or asks about dryfit, dev builds such as 1.4.1-dev.20261119143201, or a commit blocked by the dryfit guard.
---

# dryfit

dryfit publishes a library to a private registry on this machine and installs it into the apps that use it
(its consumers) with each app's own package manager. Every publish gets a new version, such as
`1.4.1-dev.20261119143201`, so no cache serves an old build. Before it first touches an app, dryfit saves
the app's `package.json` and lockfile, and restoring writes them back and reinstalls.

A background service (the daemon) does the work; the `dryfit` command talks to it and starts it when
needed. State lives in `~/.dryfit`.

## Running it

- Use `dryfit` if it is on the PATH, otherwise `npx @dryfit/cli`.
- Always pass `--json`. Results go to stdout as JSON, the exit code says whether everything succeeded,
  and errors go to stderr as `{"error": {"code", "message", "hint"}, "exitCode"}`.
- Exit codes: 0 done, 1 failed (read the error), 2 the command was used wrongly, 130 interrupted.
- dryfit never prompts. When it cannot tell which library you mean, it fails and lists them: pass
  `--library <name>`.
- `watch` without `--detach` and `events` run until interrupted. Use `watch --detach`, or run them in the
  background.

## First, look

```bash
dryfit status --json
```

Shows registered libraries, linked apps (`links`: consumer, library, status, installed version),
saved groups, and warnings. If it fails with `daemon-unavailable`, run `dryfit doctor --json`.
If no library is registered, dryfit has not been set up: see "Set up".

## The usual flow

Run these from the library's folder; elsewhere, add `--library <name>`.

1. `dryfit consumers --json` lists the projects under the user's roots that depend on the library. It
   changes nothing.
2. `dryfit link <path-to-app>... --json` installs a dev build into each app and adds a git pre-commit
   guard. This is the first command that changes an app.
3. After editing the library, `dryfit sync --json` builds, publishes and installs into every linked app
   once. `dryfit watch --detach --json` does that on every save until `dryfit unwatch`.
4. When done, `dryfit restore <path-to-app>... --json` (or `--all`) puts each app back and removes the
   guard. `unlink` is the same command.

The app's dev server may need a restart to pick up a new build. Each result names the version
installed.

## Set up

Only when `status` shows dryfit has never been set up, and after telling the user what it does:

```bash
dryfit init --root <folder-with-their-projects> --json
dryfit add <library-folder> --json
```

`init` defaults to the folder above the current one as the only root. `add` detects the build and
publish folder for Nx, Angular CLI and packages with a `build` script; otherwise pass
`--build "<command>"` and `--publish-dir <dir>`.

## Rules

- Linking changes the app's `package.json`, lockfile and `node_modules`. Say so before linking an app the
  user did not name.
- Never commit an app while it is linked, and do not bypass the guard with `--no-verify`. Restore first.
- Do not edit a linked app's `package.json` or lockfile by hand, or install the library into it some
  other way. dryfit restores the copy it saved.
- If `restore` fails with `manifest-drifted`, the app's `package.json` changed since it was linked. Ask
  the user before running `restore --force`, which drops those changes.
- Restore the apps you linked before finishing, unless the user wants to keep them linked.

## Other commands

- `dryfit restore --library <name>` restores one library and keeps an app's other links.
- `dryfit group save <name> <app>...`, then `link --group <name>` and `restore --group <name>`, for apps
  that run together.
- `dryfit remove <library>` forgets a library; restore its apps first.
- `dryfit daemon start|stop|restart|status` controls the service; `dryfit doctor --json` checks the setup.
- `dryfit help` lists every command and option.

Docs: https://mikheil-gigauri.github.io/dryfit/
