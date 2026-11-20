import AppKit
import DryfitAPI
import Observation
import SwiftUI

/// What the dryfit window shows and which sheet is open. The menu uses it to open the window at a
/// library, or straight into adding one.
@Observable public final class AppNavigation {
  public var selection: SidebarItem?
  /// The library folder being added or edited.
  public var libraryEditor: LibraryEditorRequest?
  /// The group being created or edited.
  public var groupEditor: GroupEditorRequest?
  /// Set by the menu: once the window is open, it asks for a library folder.
  public var wantsNewLibrary = false

  public init() {}
}

public enum SidebarItem: Hashable, Sendable {
  case library(String)
  case app(String)
  case group(String)
  /// Where to look for apps, hidden apps, the service, login and updates.
  case settings
}

public struct LibraryEditorRequest: Identifiable, Equatable {
  public let root: String
  public var id: String { root }
}

public enum GroupEditorRequest: Identifiable, Equatable {
  case new
  case edit(DryfitAPI.Group)

  public var id: String {
    switch self {
    case .new: "new"
    case .edit(let group): "edit \(group.name)"
    }
  }
}

/// The identifier of the dryfit window scene.
public let mainWindowID = "main"

extension AppNavigation {
  /// Shows Settings in the dryfit window; `openWindow` brings the window up.
  public func showSettings(_ openWindow: () -> Void) {
    selection = .settings
    openWindow()
    NSApp.activate()
  }
}

/// Asks for folders with the standard Open panel, attached to the key window when there is one.
public enum FolderPanel {
  public static func choose(
    prompt: String, message: String, multiple: Bool = false, startingAt directory: String? = nil
  ) async -> [String] {
    let panel = NSOpenPanel()
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.allowsMultipleSelection = multiple
    panel.canCreateDirectories = false
    panel.prompt = prompt
    panel.message = message
    if let directory { panel.directoryURL = URL(filePath: directory, directoryHint: .isDirectory) }
    NSApp.activate()
    let response = await withCheckedContinuation { continuation in
      if let window = NSApp.keyWindow, window.isVisible, !(window is NSPanel) {
        panel.beginSheetModal(for: window) { continuation.resume(returning: $0) }
      } else {
        panel.begin { continuation.resume(returning: $0) }
      }
    }
    return response == .OK ? panel.urls.map(folderPath) : []
  }
}

/// A folder's path spelled the way the daemon stores it: no trailing slash. A folder URL's path ends in
/// one, and `/repos/shop/` next to the daemon's `/repos/shop` listed one app twice and never matched
/// its link.
func folderPath(_ url: URL) -> String {
  normalizedPath(url.path(percentEncoded: false))
}

func normalizedPath(_ path: String) -> String {
  var path = path
  while path.count > 1, path.hasSuffix("/") { path.removeLast() }
  return path
}

extension MenuModel {
  /// Asks for a library's folder, then opens the form that adds it.
  public func chooseLibraryFolder(navigation: AppNavigation) async {
    let chosen = await FolderPanel.choose(
      prompt: "Choose Library", message: "Choose the folder with your library's package.json.",
      startingAt: roots?.first)
    if let root = chosen.first { navigation.libraryEditor = LibraryEditorRequest(root: root) }
  }

  /// Asks for an app's folder and links `library` into it.
  public func chooseAppAndLink(_ library: String) async {
    let chosen = await FolderPanel.choose(
      prompt: "Link", message: "Choose the app to install the dev build of \(library) into.",
      startingAt: roots?.first)
    if let consumer = chosen.first { await link(library, into: consumer) }
  }

  /// Adds folders to search for projects.
  public func chooseProjectFolders() async {
    let chosen = await FolderPanel.choose(
      prompt: "Add", message: "Choose the folders where your apps live. dryfit also looks in the folders inside them.",
      multiple: true)
    guard !chosen.isEmpty else { return }
    do {
      try await setRoots((roots ?? []) + chosen)
    } catch {
      actionError = error.localizedDescription
    }
  }
}

/// While any dryfit window is open, the app shows in the Dock and the app switcher like any other;
/// with them all closed it goes back to living only in the menu bar.
struct DockPresence: ViewModifier {
  @MainActor static var openWindows = 0

  func body(content: Content) -> some View {
    content
      .onAppear {
        Self.openWindows += 1
        NSApp.setActivationPolicy(.regular)
      }
      .onDisappear {
        Self.openWindows -= 1
        if Self.openWindows == 0 { NSApp.setActivationPolicy(.accessory) }
      }
  }
}

extension View {
  func showsInDock() -> some View { modifier(DockPresence()) }
}
