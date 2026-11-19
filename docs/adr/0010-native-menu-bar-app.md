# 0010. Native menu bar app

**Status:** Accepted · 2026-11-18

## Context

The CLI is complete on its own, but the state devlink manages (which consumers are on which dev version,
whether a build failed) is ambient. It should be glanceable without a terminal.

## Decision

A native SwiftUI app using `MenuBarExtra` with the window style, targeting macOS 14 and later (raised to macOS 26 by ADR 0013's amendment). It is a pure
client of the daemon API (ADR 0003): it renders state from the SSE stream and sends commands; it never
touches the registry, package managers or repositories.

- The menu bar icon reflects aggregate state: idle, working, error.
- Failures raise a user notification; clicking it opens the relevant log.
- If the daemon is not running, the app offers to start it through the installed CLI.
- Distributed as a signed, notarized download and a Homebrew cask, separate from the npm package.

We choose native over Electron or Tauri because a menu bar utility should cost almost no memory and should
feel like part of macOS, and the logic it would share with the CLI already lives in the daemon.

## Consequences

- macOS only. Linux and Windows users get the CLI, which is a complete product.
- Code signing and notarization need an Apple Developer account before the first public release.
