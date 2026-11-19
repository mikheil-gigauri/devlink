import AppKit

/// The menu bar glyph for each state. A template image, so the menu bar tints it.
public enum MenuBarIcon {
  static func symbolName(for icon: MenuModel.Icon) -> String {
    switch icon {
    case .offline, .idle: "link"
    case .working: "arrow.triangle.2.circlepath"
    case .attention: "exclamationmark.triangle"
    }
  }

  static func accessibilityLabel(for icon: MenuModel.Icon) -> String {
    switch icon {
    case .offline: "devlink, not running"
    case .idle: "devlink"
    case .working: "devlink, working"
    case .attention: "devlink, needs attention"
    }
  }

  /// Offline is the idle glyph, dimmed, as macOS shows things that are not active.
  public static func image(for icon: MenuModel.Icon) -> NSImage {
    let configuration = NSImage.SymbolConfiguration(pointSize: 14, weight: .medium)
    let symbol =
      NSImage(systemSymbolName: symbolName(for: icon), accessibilityDescription: accessibilityLabel(for: icon))?
      .withSymbolConfiguration(configuration) ?? NSImage()
    guard icon == .offline else {
      symbol.isTemplate = true
      return symbol
    }
    let dimmed = NSImage(size: symbol.size, flipped: false) { rect in
      symbol.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 0.4)
      return true
    }
    dimmed.isTemplate = true
    dimmed.accessibilityDescription = accessibilityLabel(for: icon)
    return dimmed
  }
}
