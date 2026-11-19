import AppKit
import DevlinkAPI
import Foundation
import SwiftUI
import Testing

@testable import DevlinkMenu

/// A model in a given state, without a daemon behind it.
@MainActor func model(_ configure: (MenuModel) -> Void) -> MenuModel {
  let model = MenuModel(connect: { .notRunning }, launch: {}, notifier: RecordingNotifier())
  configure(model)
  return model
}

let at = Date(timeIntervalSince1970: 1_795_000_000)

@MainActor @Suite(.serialized) struct ViewTests {
  @Test func everyIconStateHasASymbol() {
    for icon in [MenuModel.Icon.offline, .idle, .working, .attention] {
      #expect(NSImage(systemSymbolName: MenuBarIcon.symbolName(for: icon), accessibilityDescription: nil) != nil)
      #expect(MenuBarIcon.image(for: icon).isTemplate)
    }
  }

  @Test func describesDevVersionsInLocalTime() {
    let utc = TimeZone(identifier: "UTC")!
    #expect(DevVersion.describe("1.4.1-dev.20261118143201", timeZone: utc) == "1.4.1 · dev 14:32")
    #expect(DevVersion.describe("2.0.0-rc.1.dev.20261118090500", timeZone: utc) == "2.0.0-rc.1 · dev 09:05")
    #expect(DevVersion.describe("1.4.0") == "1.4.0")
  }

  @Test func notificationsCarryTheFirstLinesOfOutput() {
    let output = "\n> ng build ui\n\nTS2304: Cannot find name 'Butto'.\n  at button.ts:4\n  at more\n"
    #expect(UserNotifier.summary(of: output) == "> ng build ui\nTS2304: Cannot find name 'Butto'.\nat button.ts:4")
  }

  @Test func online() {
    let failed = "npm ERR! code ERESOLVE\nnpm ERR! ERESOLVE unable to resolve dependency tree"
    let busy = model { model in
      model.connection = .online
      model.status = Status(
        daemon: health,
        libraries: [ui, forms],
        links: [
          Link(library: "@acme/ui", consumer: shop, status: .installed, installedVersion: version, guarded: true),
          Link(library: "@acme/ui", consumer: admin, status: .failed),
        ],
        groups: [Group(name: "checkout", consumers: [shop, admin])],
        warnings: [
          CoherenceWarning(
            group: "checkout", library: "@acme/ui",
            versions: [.init(consumer: shop, version: version), .init(consumer: admin, version: "1.4.0")])
        ],
        jobs: Jobs(running: Job(id: 3, label: "sync @acme/ui", queuedAt: "")))
      model.consumers = [DiscoveredConsumer(root: "/r/blog", name: "blog", libraries: [], packageManager: .npm)]
      model.failures = [Failure(title: "Install of @acme/ui into admin failed", detail: failed, date: at)]
      model.activity = "Installing @acme/ui into admin…"
      model.inFlight = [.sync("@acme/ui")]
    }
    assertSnapshot(of: MenuContent(model: busy, actions: MenuActions()), named: "online")
  }

  @Test func emptyAndIdle() {
    let empty = model { model in
      model.connection = .online
      model.status = Status(daemon: health)
      model.consumers = [DiscoveredConsumer(root: "/r/blog", name: "blog", libraries: [], packageManager: .npm)]
    }
    assertSnapshot(of: MenuContent(model: empty, actions: MenuActions()), named: "empty")
  }

  @Test func offlineAfterAFailedStart() {
    let offline = model { model in
      model.connection = .offline
      model.startError = DaemonLauncher.Failure.cliNotFound.localizedDescription
    }
    assertSnapshot(of: MenuContent(model: offline, actions: MenuActions()), named: "offline")
  }

  @Test func incompatibleDaemon() {
    let incompatible = model { $0.connection = .incompatible(daemonVersion: "2.0.0") }
    assertSnapshot(of: MenuContent(model: incompatible, actions: MenuActions()), named: "incompatible")
  }

  @Test func failureWindow() {
    let output = """
      > ng build ui

      ✘ [ERROR] TS2304: Cannot find name 'Butto'. [plugin angular-compiler]

          projects/ui/src/button/button.ts:4:15:
            4 │   readonly kind: Butto = 'primary';
              ╵                  ~~~~~
      """
    let failures = [
      Failure(title: "Build of @acme/ui failed", detail: output, date: at),
      Failure(title: "Stopped watching @acme/forms", detail: "EMFILE: too many open files", date: at - 600),
    ]
    assertSnapshot(
      of: FailureView(failures: failures, selection: .constant(failures[0].id)), named: "failures",
      size: CGSize(width: 720, height: 360))
  }
}
