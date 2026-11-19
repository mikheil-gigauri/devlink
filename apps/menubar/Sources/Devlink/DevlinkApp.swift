import AppKit
import DevlinkAPI
import DevlinkMenu
import ServiceManagement
import SwiftUI

@main
struct DevlinkApp: App {
  @NSApplicationDelegateAdaptor private var delegate: AppDelegate

  var body: some Scene {
    MenuBarExtra {
      MenuContent(model: delegate.model, actions: delegate.actions)
    } label: {
      Image(nsImage: MenuBarIcon.image(for: delegate.model.icon))
    }
    .menuBarExtraStyle(.window)
  }
}

/// Owns the model for the app's lifetime and follows the daemon from launch, not from the first time
/// the menu opens, so failures are noticed (and notified) while the menu is closed.
final class AppDelegate: NSObject, NSApplicationDelegate {
  let model: MenuModel
  private let home = DevlinkHome.locate()
  private var failureWindow: FailureWindow?
  private var connection: Task<Void, Never>?

  override init() {
    let home = home
    let launcher = DaemonLauncher()
    // The notifier opens the failure window, which needs the model: tied together after init.
    let relay = NotifierRelay()
    model = MenuModel(
      connect: {
        switch await DaemonLocator(home: home).locate() {
        case .running(let client, let health): .running(client, health)
        case .notRunning: .notRunning
        case .incompatible(let health): .incompatible(health)
        }
      },
      launch: { try await launcher.start() },
      notifier: relay)
    super.init()
    failureWindow = FailureWindow(model: model)
    relay.target = UserNotifier { [weak self] id in self?.failureWindow?.show(selecting: id) } ?? SilentNotifier()
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    connection = Task { [model] in await model.run() }
  }

  var actions: MenuActions {
    MenuActions(
      openLog: { [home] in NSWorkspace.shared.open(home.log) },
      showFailures: { [weak self] id in self?.failureWindow?.show(selecting: id) },
      quit: { NSApp.terminate(nil) },
      openAtLogin: Bundle.main.bundleURL.pathExtension == "app" ? Self.openAtLogin : nil)
  }

  /// Registers the app itself as a login item, only when the user turns it on.
  private static var openAtLogin: Binding<Bool> {
    Binding(
      get: { SMAppService.mainApp.status == .enabled },
      set: { enabled in
        try? enabled ? SMAppService.mainApp.register() : SMAppService.mainApp.unregister()
      })
  }
}

private final class NotifierRelay: Notifier {
  var target: (any Notifier)?
  func post(_ failure: Failure) { target?.post(failure) }
}
