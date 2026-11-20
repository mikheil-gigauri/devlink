import AppKit
import DryfitAPI
import SwiftUI

/// "~/code/shop" for "/Users/me/code/shop".
func abbreviatedPath(_ path: String) -> String {
  (path as NSString).abbreviatingWithTildeInPath
}

func revealInFinder(_ path: String) {
  NSWorkspace.shared.activateFileViewerSelecting([URL(filePath: path)])
}

extension DryfitAPI.Link {
  var symbol: String {
    switch status {
    case .installed: "checkmark.circle.fill"
    case .pending: "clock"
    case .failed: "xmark.octagon.fill"
    }
  }

  var tint: Color {
    switch status {
    case .installed: .green
    case .pending: .secondary
    case .failed: .red
    }
  }

  func detail(timeZone: TimeZone) -> String {
    switch status {
    case .failed: "Install failed"
    case .pending: "Waiting for a sync"
    case .installed: installedVersion.map { DevVersion.describe($0, timeZone: timeZone) } ?? "Installed"
    }
  }
}

extension Library {
  func published(timeZone: TimeZone) -> String {
    guard let version = lastPublishedVersion else { return "Not published yet" }
    return DevVersion.describe(version, timeZone: timeZone)
  }
}

/// The contents of a "Link to App" menu: projects found that use the library, then any folder.
struct LinkMenuItems: View {
  let library: String
  let model: MenuModel

  var body: some View {
    let candidates = model.linkCandidates(for: library)
    if !candidates.isEmpty {
      Section("Apps that use \(library)") {
        ForEach(candidates) { consumer in
          Button(consumer.name ?? projectName(consumer.root)) {
            Task { await model.link(library, into: consumer.root) }
          }
        }
      }
    } else {
      Text(model.isBusy(.discover) ? "Looking for apps…" : "No other app in your project folders uses \(library)")
    }
    Divider()
    Button("Choose app…") { Task { await model.chooseAppAndLink(library) } }
    Button("Look again") { Task { await model.discoverConsumers() } }
  }
}

/// A failure to act on, with a way to dismiss it.
struct ErrorBanner: View {
  let message: String
  let dismiss: () -> Void

  var body: some View {
    HStack(alignment: .top, spacing: 7) {
      Image(systemName: "xmark.circle").foregroundStyle(.red)
      Text(message).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
      Button("Dismiss", action: dismiss).buttonStyle(.pill)
    }
    .font(DS.body)
    .card()
  }
}

extension Color {
  /// dryfit's brand colours, from the app icon: magenta marks a dev build, teal a release.
  static let devBuild = Color(red: 1, green: 0.373, blue: 0.659)
  static let release = Color(red: 0.184, green: 0.682, blue: 0.592)
}
