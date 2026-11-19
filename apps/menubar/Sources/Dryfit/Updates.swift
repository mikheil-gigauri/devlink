import AppKit
import Sparkle
import SwiftUI

/// Keeps the app up to date with Sparkle: it checks the appcast each release publishes once a day,
/// downloads a new version in the background, and replaces and relaunches the app the next time the
/// user is not using it. Off outside a built Dryfit.app that names a feed and its public key, such as
/// `swift run` or a bundle built without a key.
final class Updates: NSObject {
  private var controller: SPUStandardUpdaterController?
  private var pendingInstall: (() -> Void)?
  private var resignObserver: NSObjectProtocol?

  override init() {
    super.init()
    let info = Bundle.main.infoDictionary ?? [:]
    guard Bundle.main.bundleURL.pathExtension == "app", info["SUFeedURL"] != nil, info["SUPublicEDKey"] != nil
    else { return }
    controller = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: self, userDriverDelegate: nil)
  }

  /// Nil when updates are off.
  var checkForUpdates: (() -> Void)? {
    guard let controller else { return nil }
    return {
      NSApp.activate()
      controller.checkForUpdates(nil)
    }
  }

  /// Whether updates download and install by themselves. Nil when updates are off.
  var installAutomatically: Binding<Bool>? {
    guard let updater = controller?.updater else { return nil }
    return Binding(
      get: { updater.automaticallyDownloadsUpdates },
      set: { updater.automaticallyDownloadsUpdates = $0 })
  }

  /// A menu bar app is rarely quit, so an update waiting for the app to quit could wait for weeks.
  /// Install it now if the user is not using the app, or as soon as they stop.
  private func installWhenIdle(_ install: @escaping () -> Void) {
    guard NSApp.isActive else { return install() }
    pendingInstall = install
    guard resignObserver == nil else { return }
    resignObserver = NotificationCenter.default.addObserver(
      forName: NSApplication.didResignActiveNotification, object: nil, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated {
        guard let self, let install = self.pendingInstall else { return }
        self.pendingInstall = nil
        install()
      }
    }
  }
}

extension Updates: SPUUpdaterDelegate {
  func updater(
    _ updater: SPUUpdater, willInstallUpdateOnQuit item: SUAppcastItem,
    immediateInstallationBlock immediateInstallHandler: @escaping () -> Void
  ) -> Bool {
    installWhenIdle(immediateInstallHandler)
    return true
  }
}
