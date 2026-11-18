# 0003. A daemon with thin clients

**Status:** Accepted · 2026-11-18

## Context

The registry must keep running between commands, library builds run in watch mode, and several surfaces
want to show the same live state: a terminal, a macOS menu bar app, possibly an editor extension later.
If each surface owned the logic, they would drift.

## Decision

One long-lived process, `devlinkd`, owns everything: the embedded registry, build watchers, the
publish → install → invalidate pipeline, and persisted state in `~/.devlink`. It is started on demand by the
CLI and can be installed as a launchd agent so it starts at login.

Clients are thin. The CLI and the menu bar app talk to the daemon over a local HTTP API:

- JSON request/response for commands (`POST /links`, `POST /libraries/:id/watch`, ...).
- Server-sent events on `GET /events` for live status. SSE is one-directional, plain HTTP, and trivial to
  consume from Swift's `URLSession` bytes API.
- The API schema lives in one TypeScript module and is exported as JSON Schema so the Swift client is
  generated from, or at least tested against, the same contract.

Security: the server binds to `127.0.0.1` only, requires a bearer token read from `~/.devlink/token`
(mode `0600`), and rejects any request carrying an `Origin` header. Together these stop a web page in the
user's browser from triggering a publish or install, which would amount to running arbitrary code.

## Consequences

- Every feature is usable from the terminal first, and from automation (including AI agents) for free.
- The menu bar app contains no business logic, so it stays small and native.
- A daemon adds lifecycle work: stale PID files, port conflicts, version skew between CLI and daemon. The
  CLI checks the daemon's version on connect and restarts it when they differ.
