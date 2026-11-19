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
    Button("Choose App…") { Task { await model.chooseAppAndLink(library) } }
    Button("Look Again") { Task { await model.discoverConsumers() } }
  }
}

/// A failure to act on, with a way to dismiss it.
struct ErrorBanner: View {
  let message: String
  let dismiss: () -> Void

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.red)
      Text(message).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
      Button("Dismiss", action: dismiss).buttonStyle(.borderless).controlSize(.small)
    }
    .font(.callout)
    .padding(10)
    .background(.red.opacity(0.1), in: .rect(cornerRadius: 10))
  }
}

/// A borderless symbol button that shows a spinner while its action runs.
struct IconButton: View {
  let symbol: String
  let label: String
  let busy: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      ZStack {
        Image(systemName: symbol).opacity(busy ? 0 : 1)
        if busy { ProgressView().controlSize(.mini) }
      }
      .frame(width: 22, height: 22)
      .contentShape(.rect)
    }
    .buttonStyle(.borderless)
    .disabled(busy)
    .help(label)
    .accessibilityLabel(label)
  }
}

/// The square tile that stands for a library or a group.
struct Tile: View {
  let symbol: String
  let tint: Color
  var size: CGFloat = 40

  var body: some View {
    Image(systemName: symbol)
      .font(.system(size: size * 0.45, weight: .medium))
      .foregroundStyle(.white)
      .frame(width: size, height: size)
      .background(tint.gradient, in: .rect(cornerRadius: size * 0.26))
      .accessibilityHidden(true)
  }
}

extension Color {
  /// dryfit's brand colours, from the app icon: magenta marks a dev build, teal a release.
  static let devBuild = Color(red: 1, green: 0.373, blue: 0.659)
  static let release = Color(red: 0.184, green: 0.682, blue: 0.592)
}

/// Says whether an app runs a library's dev build or its released version.
struct BuildChip: View {
  let dev: Bool

  var body: some View {
    Text(dev ? "Dev build" : "Release")
      .font(.caption.weight(.semibold))
      .foregroundStyle(dev ? Color.devBuild : Color.release)
      .padding(.horizontal, 7)
      .padding(.vertical, 2)
      .background((dev ? Color.devBuild : Color.release).opacity(0.14), in: .capsule)
  }
}

/// A small grey capsule for a fact such as the package manager.
struct Badge: View {
  let text: String

  var body: some View {
    Text(text)
      .font(.caption2.weight(.medium))
      .padding(.horizontal, 5)
      .padding(.vertical, 1)
      .background(.quaternary, in: .capsule)
  }
}
