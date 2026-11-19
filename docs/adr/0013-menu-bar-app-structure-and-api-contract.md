# 0013. Menu bar app structure and the cross-language API contract

**Status:** Accepted · 2026-11-18

## Context

ADR 0010 settled on a native `MenuBarExtra` app that is a pure client of the daemon, and ADR 0009 on
view-model tests plus light and dark snapshots. Building it (M4) needs answers to: how the Swift code is
laid out and built without an Xcode project in the repository, how the Swift types are kept in step with
the TypeScript API, how the app finds, trusts and starts the daemon, and what it shows.

## Decision

**A Swift package, no Xcode project.** `apps/menubar` is a SwiftPM package (Swift 6 language mode,
strict concurrency, macOS 14 and later as ADR 0010 says; macOS 26 since the amendment below) with three targets:

- `DryfitAPI`: the API models, the HTTP and server-sent-events client, and finding and starting the
  daemon. No SwiftUI.
- `DryfitMenu`: the `@MainActor` view model and the views, with main-actor default isolation.
- `Dryfit`: the executable, a few lines of `App` and `MenuBarExtra`.

`swift build` and `swift test` work from a clean clone, and a package diffs and reviews like code where
a `.pbxproj` does not. `scripts/bundle.sh` assembles `Dryfit.app` (an `LSUIElement` agent, ad-hoc
signed) from the release build; signing and notarization for distribution land with M5.

**One contract, checked from both sides.** `packages/dryfit/api/` holds two generated files:

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

**Finding and starting the daemon.** The app reads `daemon.json` and the token from `~/.dryfit` (or
`$DRYFIT_HOME`), and trusts the daemon only after `/v1/health` reports the pid the file names (the
CLI's rule, ADR 0012). It follows `/v1/events`, resumes with `Last-Event-ID`, and reconnects with
backoff, re-reading `daemon.json` each time since a restarted daemon may have moved. When nothing
answers it offers to start dryfit: through the launchd agent when installed, otherwise by running
`dryfit daemon start` from a login shell, because an app launched from Finder does not have the PATH
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
- Starting the daemon from the app depends on the user's shell profile finding `dryfit`. When it does
  not, the app says so and shows the command to run.

## Amendment · 2026-11-19 (an app that needs no terminal)

The menu could only operate what the CLI had set up: libraries were added and project folders chosen
in a terminal. The app now does all of it.

- **A window as well as the menu.** The menu stays the place for the everyday controls. A `Window` scene
  (a `NavigationSplitView` of libraries and groups) holds what needs room: adding a library, its build
  settings, linking into any folder, creating and editing groups, removing. A `Settings` scene holds the
  project folders, the service (start, stop, log) and Open at Login. While a window is open the app is
  a regular app, in the Dock and the app switcher; with none open it lives only in the menu bar. The
  window opens by itself on the first launch only, with a three-step start.
- **Three operations added to the API.** `inspect` previews what registering a folder would do (name,
  version, detected build and publish folder) without registering it, so the form can show and correct
  it first. `roots` and `setRoots` read and replace the project folders in `config.json`, which the CLI
  sets with `dryfit init`. API version stays 1: these are additions.
- **Restoring an app whose `package.json` changed asks first.** A `manifest-drifted` refusal becomes a
  question with Restore Anyway (`force`), instead of an error.
- **The CLI can be installed from the app.** When no shell finds `dryfit`, the app offers to run
  `npm install --global @dryfit/cli`. `$DRYFIT_CLI` names another command to start the daemon with, which
  is how a checkout's build is tested.
- **macOS 26 and later.** The window and its toolbar use the system's Liquid Glass chrome (sidebar,
  toolbar, `.glassProminent` for each page's primary action) with no custom glass. Supporting older
  systems would have meant gating each of those; the app's users are developers on current macOS.
- **Apps are first-class in the window.** The sidebar lists apps as well as libraries and groups: every
  app that is linked, or that the daemon's `discover` found using a registered library. To add an app
  from outside the project folders, the app reads that folder's `package.json` itself (read-only: its
  dependencies and lockfile) to see which registered libraries it uses; nothing is sent to the daemon
  until the user links one, and `link` still checks the dependency. Such an app is kept for the
  session; once linked it is part of the daemon's state like any other.
- **Words the user can act on.** "Watch" became **Auto-sync**, a labelled switch rather than an eye
  icon, because the icon did not say what it did. The API keeps `watch`, since it names the mechanism.
- **The brand.** The app icon (Icon Composer, `Resources/AppIcon.icon`) is a teal package with a
  magenta "dev" tag on a charcoal tile, like the system's developer tools. The same two colours mark
  a release and a dev build in the window, and the menu bar icon is the package outline, with the tag
  for idle, a dashed box while syncing and an exclamation mark when something failed.
