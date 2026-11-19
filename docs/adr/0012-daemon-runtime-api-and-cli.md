# 0012. Daemon runtime, API contract and CLI

**Status:** Accepted · 2026-11-18

## Context

ADR 0003 settled on one daemon with thin clients. Building it (M3) needs concrete answers: where things
live on disk, how clients find and trust the daemon, what the API looks like, how concurrent requests and
file watching interact, how child processes are bounded, and how the commit guard survives tools such as
Husky. The daemon also has to reach the user's private registries, since a library's own dependencies
usually live there.

## Decision

**Home folder.** Everything lives in `~/.dryfit` (or `$DRYFIT_HOME`): `config.json` (scan roots,
ports), `state.json`, `token` (0600), `daemon.json` (pid, port, version, written once listening),
`registry/` (0700), `snapshots/`, `staging/` and `logs/daemon.log`.

**Fixed ports.** The API listens on `127.0.0.1:4875` and the registry on `127.0.0.1:4874`, both
configurable. Fixed ports keep lockfile URLs and the launchd agent stable; 4873 is avoided because many
developers already run their own Verdaccio there. Binding the API port doubles as the single-instance
lock.

**API.** RPC over HTTP: `POST /v1/<operation>` with a JSON body, plus `GET /v1/health` and
`GET /v1/events` (server-sent events with ids; `Last-Event-ID` replays from a bounded buffer). Operations
rather than REST resources because library names contain slashes, and because a single typed operation
map is the simplest thing to mirror in Swift. The contract (operation names, input and output types,
input validators, error codes) is one module, `src/daemon/api.ts`; its JSON Schema export lands with the
menu bar app (M4). Errors are `{ "error": { code, message, details } }` with the `DryfitError` codes.
Every request except `GET /v1/health` needs `Authorization: Bearer <token>`; requests with an `Origin`
header are refused. Health only says who is listening (name, version, pid), so a client can confirm
that the process on the port is the daemon `daemon.json` describes before it sends the token.

**One job at a time.** Every operation that changes state or touches a repository runs on a serial
queue; reads do not wait. Sync requests coalesce: one already queued for the same library absorbs later
ones, and one that is running schedules a single follow-up. A burst of saves therefore costs at most two
cycles, and two operations can never interleave writes to the same lockfile or state file.

**Bounded child processes.** Builds, publishes and installs get a timeout (15 minutes by default) and
are cancelled when the daemon stops. Each runs in its own process group so the whole tree is killed,
not just `npm`.

**Watching.** `watch` sets a persisted flag on the library. The daemon watches the library root
recursively, ignoring `node_modules`, VCS and cache folders and the publish folder, debounces for 400 ms
and queues a sync. A watch that ends on its own (folder gone, out of file handles) turns the flag off
and emits `watch:failed`, so status never shows a library as watched when nothing will sync it. Running the library's one-shot build per cycle is slower than a long-lived
`ng build --watch`, but it has a definite end, which is what a publish needs to wait for.

**Groups and coherence.** State gains saved groups: named sets of consumers that run together (a
federation host and its remotes). Groups link and restore together, and `status` warns when consumers in
one group run different dev versions of the same library (ADR 0005). State moves to version 2; version 1
files are read and upgraded.

**Commit guard.** A POSIX `sh` block that greps staged manifests and lockfiles for dryfit's dev-version
pattern (`-dev.` plus a 14-digit stamp). It needs neither Node nor dryfit at commit time, so it works
from GUI git clients with a minimal `PATH`, and it cannot break when dryfit moves. It is inserted,
between marker lines, at the top of the effective hook file (`git rev-parse --git-path hooks`, which
follows `core.hooksPath` and therefore Husky), leaving any existing hook intact: restoring gives back the hook's exact bytes, an empty one included,
and deletes only a file dryfit created. Paths are read with `core.quotePath=false`, so non-ASCII
folder names are checked too. Linking installs it by
default (`--no-guard` to opt out); restoring removes it; every install re-applies it, because Husky
regenerates its hook stubs on `npm install`. `git commit --no-verify` remains the escape hatch.

**Uplinks.** The registry proxies the user's own npm registries, read from `npm config` at start:
the default registry plus every scoped registry. Their auth tokens are read from the user's npmrc files
into memory and handed to Verdaccio in-process; dryfit never writes them anywhere.

**Daemon lifecycle.** The CLI starts the daemon on demand, detached, logging to `logs/daemon.log`, and
waits for `/v1/health`. When the daemon's version differs from the CLI's, the CLI restarts it. A stale
`daemon.json` (dead pid) is ignored, and the CLI never signals a pid that health has not confirmed as
the daemon: after a crash or reboot the pid may belong to something else. `dryfit daemon install` writes a launchd agent that records the
current `node`, CLI path and `PATH` (launchd's default `PATH` cannot find npm under nvm or Homebrew),
with `KeepAlive` only on unsuccessful exit, so `dryfit daemon stop` stays stopped.

**CLI.** `node:util` `parseArgs`, no framework. Human output by default, `--json` on every command for
scripts and agents. Library registration detects Nx (`project.json` build target), Angular CLI
(`ng-package.json` inside an `angular.json` workspace) and plain `npm run build`; flags override
detection.

## Consequences

- A second terminal, the menu bar app and an AI agent all see the same queue and the same events.
- Fixed ports can collide; the error names the port and the config key that changes it.
- The guard can be bypassed or regenerated away. `doctor` reports linked consumers without it.
- Reading npmrc tokens means parsing npm's config format. Only `_authToken` and `_auth` lines keyed by
  registry URL are supported, with `${ENV}` expansion (plus `username` and `_password`); anything else, including a
  malformed password, falls back to an unauthenticated uplink and `doctor` says so.

## Amendment · 2026-11-19 (M5, Linux watcher)

`NodeLibraryWatcher` has two strategies. `recursive` is Node's recursive `fs.watch`, kept on macOS, where
FSEvents makes one watch cheap whatever the tree's size. `walk`, the default on Linux, opens one
non-recursive watch per folder and never enters ignored folders such as `node_modules` or `dist`, so
inotify watches scale with the source tree only. It adds watches for folders created while watching and
closes them for folders deleted. Both strategies run the same tests.
