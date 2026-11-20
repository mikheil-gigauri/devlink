import Foundation
import UserNotifications

/// Posts failures as system notifications; clicking one opens its output. Notifications need an app
/// bundle, so outside `Dryfit.app` (under `swift run`) the app uses `SilentNotifier` instead.
public final class UserNotifier: NSObject, Notifier, UNUserNotificationCenterDelegate {
  private let center: UNUserNotificationCenter
  private let open: (Failure.ID?) -> Void
  private var authorized: Bool?

  public init?(open: @escaping (Failure.ID?) -> Void) {
    guard Bundle.main.bundleIdentifier != nil, Bundle.main.bundleURL.pathExtension == "app" else { return nil }
    self.center = .current()
    self.open = open
    super.init()
    center.delegate = self
  }

  public func post(_ failure: Failure, quietly: Bool) {
    Task {
      guard await isAuthorized() else { return }
      let content = UNMutableNotificationContent()
      content.title = failure.title
      content.body = Self.summary(of: failure.detail)
      content.sound = quietly ? nil : .default
      content.userInfo = [Self.failureKey: failure.id.uuidString]
      // One notification per subject: a newer failure of the same build or install replaces it.
      try? await center.add(UNNotificationRequest(identifier: Self.identifier(failure), content: content, trigger: nil))
    }
  }

  public func recovered(_ failure: Failure, message: String) {
    Task {
      guard await isAuthorized() else { return }
      let content = UNMutableNotificationContent()
      content.title = message
      try? await center.add(UNNotificationRequest(identifier: Self.identifier(failure), content: content, trigger: nil))
    }
  }

  private nonisolated static let failureKey = "failure"
  private static func identifier(_ failure: Failure) -> String { failure.subject ?? failure.id.uuidString }

  /// The first lines of the output, which usually name the error.
  static func summary(of detail: String) -> String {
    let lines = detail.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }
    return String(lines.filter { !$0.isEmpty }.prefix(3).joined(separator: "\n").prefix(240))
  }

  private func isAuthorized() async -> Bool {
    if let authorized { return authorized }
    let granted = (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
    authorized = granted
    return granted
  }

  public nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
  ) async {
    // A recovery has no failure left to show.
    guard let id = (response.notification.request.content.userInfo[Self.failureKey] as? String).flatMap(UUID.init)
    else { return }
    await MainActor.run { open(id) }
  }

  /// The menu bar app is never really "in front", but if it is, show the banner anyway.
  public nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    [.banner, .sound]
  }
}

/// Keeps failures in the menu only.
public final class SilentNotifier: Notifier {
  public init() {}
  public func post(_ failure: Failure, quietly: Bool) {}
  public func recovered(_ failure: Failure, message: String) {}
}
