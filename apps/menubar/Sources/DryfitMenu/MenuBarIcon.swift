import AppKit

/// The menu bar glyph: dryfit's package with its dev tag, drawn as a template image so the menu bar
/// tints it. The package stays put; the tag says how things are.
public enum MenuBarIcon {
  static func accessibilityLabel(for icon: MenuModel.Icon) -> String {
    switch icon {
    case .offline: "dryfit, stopped"
    case .idle: "dryfit"
    case .working: "dryfit, syncing"
    case .attention: "dryfit, something failed"
    }
  }

  static let size = NSSize(width: 20, height: 18)

  public static func image(for icon: MenuModel.Icon) -> NSImage {
    let image = NSImage(size: size, flipped: true) { _ in
      draw(icon)
      return true
    }
    image.isTemplate = true
    image.accessibilityDescription = accessibilityLabel(for: icon)
    return image
  }

  private static func draw(_ icon: MenuModel.Icon) {
    let alpha: CGFloat = icon == .offline ? 0.4 : 1
    NSColor.black.withAlphaComponent(alpha).set()

    // The package: an isometric box, its lid edges meeting in the middle.
    let top = NSPoint(x: 9, y: 2), centre = NSPoint(x: 9, y: 8.5), bottom = NSPoint(x: 9, y: 15.5)
    let leftTop = NSPoint(x: 2.5, y: 5.25), rightTop = NSPoint(x: 15.5, y: 5.25)
    let leftBottom = NSPoint(x: 2.5, y: 12.25), rightBottom = NSPoint(x: 15.5, y: 12.25)
    let box = NSBezierPath()
    box.move(to: top)
    for point in [rightTop, rightBottom, bottom, leftBottom, leftTop] { box.line(to: point) }
    box.close()
    box.move(to: leftTop)
    box.line(to: centre)
    box.line(to: rightTop)
    box.move(to: centre)
    box.line(to: bottom)
    box.lineWidth = 1.5
    box.lineJoinStyle = .round
    if icon == .working { box.setLineDash([2.2, 1.6], count: 2, phase: 0) }
    box.stroke()

    guard icon != .offline else { return }
    // The dev tag at the bottom right, cut out of the box so the two read apart.
    let tag = NSRect(x: 11.5, y: 10.5, width: 8, height: 6)
    let gap = NSBezierPath(roundedRect: tag.insetBy(dx: -1.25, dy: -1.25), xRadius: 4.25, yRadius: 4.25)
    NSGraphicsContext.current?.compositingOperation = .destinationOut
    gap.fill()
    NSGraphicsContext.current?.compositingOperation = .sourceOver
    let tagPath = NSBezierPath(roundedRect: tag, xRadius: 3, yRadius: 3)
    if icon == .attention {
      // Something failed: the tag turns into a warning, an exclamation mark cut out of it.
      tagPath.fill()
      NSGraphicsContext.current?.compositingOperation = .destinationOut
      NSBezierPath(roundedRect: NSRect(x: 14.85, y: 11.5, width: 1.3, height: 2.6), xRadius: 0.65, yRadius: 0.65).fill()
      NSBezierPath(ovalIn: NSRect(x: 14.85, y: 14.5, width: 1.3, height: 1.3)).fill()
      NSGraphicsContext.current?.compositingOperation = .sourceOver
    } else {
      tagPath.fill()
    }
  }
}
