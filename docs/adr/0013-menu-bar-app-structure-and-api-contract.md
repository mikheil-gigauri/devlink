# 0013. Menu bar app structure and the cross-language API contract

**Status:** Accepted · 2026-11-18

## Context

ADR 0010 settled on a native `MenuBarExtra` app that is a pure client of the daemon, and ADR 0009 on
view-model tests plus light and dark snapshots. Building it (M4) needs answers to: how the Swift code is
laid out and built without an Xcode project in the repository, how the Swift types are kept in step with
the TypeScript API, how the app finds, trusts and starts the daemon, and what it shows.

## Decision

**A Swift package, no Xcode project.** `apps/menubar` is a SwiftPM package (Swift 6 language mode,
strict concurrency, macOS 14 and later as ADR 0010 says) with three targets:

- `DevlinkAPI`: the API models, the HTTP and server-sent-events client, and finding and starting the
  daemon. No SwiftUI.
- `DevlinkMenu`: the `@MainActor` view model and the views, with main-actor default isolation.
- `Devlink`: the executable, a few lines of `App` and `MenuBarExtra`.

`swift build` and `swift test` work from a clean clone, and a package diffs and reviews like code where
a `.pbxproj` does not. `scripts/bundle.sh` assembles `Devlink.app` (an `LSUIElement` agent, ad-hoc
signed) from the release build; signing and notarization for distribution land with M5.

**One contract, checked from both sides.** `packages/devlink/api/` holds two generated files:

- `schema.json`: the API version, every operation with its input as JSON Schema (the validators
  already describe themselves), the error codes and the event types.
- `fixtures.json`: one sample of every operation's output and every event, written in TypeScript with
  `satisfies`, so a change to an API type fails the typecheck until the samples follow.

`npm run api:export` regenerates them; a TypeScript test fails while they are stale. The Swift tests
decode every fixture and check that the operations, error codes and event types they know match the
schema. A field renamed on one side therefore breaks a test on the other, without code generation:
hand-written `Codable` types read better and the API is small. The Swift decoder tolerates what it does
not know (new event types, new fields), so an older app keeps working against a newer daemon, and it
refuses an `apiVersion` it was not built for.

**Finding and starting the daemon.** The app reads `daemon.json` and the token from `~/.devlink` (or
`$DEVLINK_HOME`), and trusts the daemon only after `/v1/health` reports the pid the file names (the
CLI's rule, ADR 0012). It follows `/v1/events`, resumes with `Last-Event-ID`, and reconnects with
backoff, re-reading `daemon.json` each time since a restarted daemon may have moved. When nothing
answers it offers to start devlink: through the launchd agent when installed, otherwise by running
`devlink daemon start` from a login shell, because an app launched from Finder does not have the PATH
that finds `node` under nvm or Homebrew. It never starts the daemon on its own.

**What the menu shows.** The menu bar icon is the aggregate state: offline, idle, working, or
attention (a failed job or link). The window lists libraries with their linked consumers and versions,
a sync button, a watch toggle and a menu to link a discovered consumer; saved groups with link and
restore; coherence warnings; and the running job. State comes from `status` and is refreshed when an
event says it changed; events also drive progress text. A failed build, publish or install posts a
notification, and clicking it opens a window with the captured output. Controls are system components
(buttons, toggles, menus), so on macOS 26 and later they take on Liquid Glass without custom glass.

**Testing.** The view model is tested against a fake client. The client is tested against
`URLProtocol` stubs, and the event-stream parser as a pure function. Snapshots render the menu in light
and dark through `NSHostingView` (which, unlike `ImageRenderer`, draws AppKit-backed controls) and
compare against committed PNGs with a small tolerance; `SNAPSHOT_RECORD=1` rewrites them.

## Consequences

- Swift and TypeScript stay independent builds; the contract files are the only coupling, and they are
  checked in, so the Swift tests run without Node.
- Snapshots are tied to the macOS version that recorded them; a new major release may need a
  re-record, which is a reviewed diff of images.
- Starting the daemon from the app depends on the user's shell profile finding `devlink`. When it does
  not, the app says so and shows the command to run.
