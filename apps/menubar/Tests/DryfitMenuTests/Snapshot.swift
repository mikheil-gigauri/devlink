import AppKit
import Foundation
import SwiftUI
import Testing

enum Snapshots {
  /// The macOS major version the references in `__Snapshots__` were drawn on. AppKit draws controls
  /// differently from one major version to the next, so elsewhere the comparison would only measure that.
  static let recordedOn = 27
  static let recording = ProcessInfo.processInfo.environment["SNAPSHOT_RECORD"] == "1"
  static let comparable = recording || ProcessInfo.processInfo.operatingSystemVersion.majorVersion == recordedOn
  static let skipped = "references were drawn on macOS \(recordedOn); record them on this one with SNAPSHOT_RECORD=1"
}

/// Renders a view in light and dark, at 2x whatever the screen, and compares it with the reference
/// PNGs in `__Snapshots__`. `SNAPSHOT_RECORD=1` rewrites the references; a mismatch leaves
/// `<name>.<appearance>.actual.png` beside the reference to look at.
@MainActor
func assertSnapshot(
  of view: some View, named name: String, size: CGSize? = nil,
  filePath: String = #filePath, sourceLocation: SourceLocation = #_sourceLocation
) {
  _ = NSApplication.shared
  let folder = URL(filePath: filePath).deletingLastPathComponent().appending(path: "__Snapshots__")
  let record = Snapshots.recording

  for (appearance, suffix) in [(NSAppearance.Name.aqua, "light"), (.darkAqua, "dark")] {
    let png = render(view, appearance: NSAppearance(named: appearance)!, size: size)
    let reference = folder.appending(path: "\(name).\(suffix).png")
    let actual = folder.appending(path: "\(name).\(suffix).actual.png")

    guard !record, let expected = try? Data(contentsOf: reference) else {
      try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      try? png.write(to: reference)
      Issue.record("Recorded \(reference.lastPathComponent); run the tests again", sourceLocation: sourceLocation)
      continue
    }
    if let difference = compare(png, expected) {
      try? png.write(to: actual)
      Issue.record(
        "\(name).\(suffix) differs from its reference: \(difference). See \(actual.lastPathComponent)",
        sourceLocation: sourceLocation)
    } else {
      try? FileManager.default.removeItem(at: actual)
    }
  }
}

@MainActor
private func render(_ view: some View, appearance: NSAppearance, size: CGSize?) -> Data {
  let utc = TimeZone(identifier: "UTC")!
  let host = NSHostingView(
    rootView: view.environment(\.timeZone, utc).background(Color(nsColor: .windowBackgroundColor)))
  host.appearance = appearance
  let window = NSWindow(
    contentRect: NSRect(origin: .zero, size: size ?? CGSize(width: 360, height: 400)), styleMask: [.borderless],
    backing: .buffered, defer: false)
  window.appearance = appearance
  window.contentView = host
  if size == nil { window.setContentSize(host.fittingSize) }
  host.layoutSubtreeIfNeeded()
  // Let SwiftUI settle (tasks, ViewThatFits) before drawing.
  RunLoop.main.run(until: .now + 0.05)
  host.layoutSubtreeIfNeeded()

  let bounds = host.bounds
  let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: Int(bounds.width * 2), pixelsHigh: Int(bounds.height * 2),
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
    bytesPerRow: 0, bitsPerPixel: 32)!
  rep.size = bounds.size
  NSAppearance.current = appearance
  appearance.performAsCurrentDrawingAppearance { host.cacheDisplay(in: bounds, to: rep) }
  return rep.representation(using: .png, properties: [:])!
}

/// Nil when the images match closely enough: font smoothing differs by a shade between runs.
private func compare(_ actual: Data, _ expected: Data) -> String? {
  guard let a = NSBitmapImageRep(data: actual), let b = NSBitmapImageRep(data: expected) else {
    return "unreadable PNG"
  }
  guard a.pixelsWide == b.pixelsWide, a.pixelsHigh == b.pixelsHigh else {
    return "size \(a.pixelsWide)×\(a.pixelsHigh), expected \(b.pixelsWide)×\(b.pixelsHigh)"
  }
  let pa = rgba(a), pb = rgba(b)
  var differing = 0
  for i in stride(from: 0, to: pa.count, by: 4) {
    for c in 0..<4 where abs(Int(pa[i + c]) - Int(pb[i + c])) > 24 {
      differing += 1
      break
    }
  }
  let share = Double(differing) / Double(a.pixelsWide * a.pixelsHigh)
  return share > 0.002 ? "\(differing) pixels (\(String(format: "%.2f", share * 100))%)" : nil
}

private func rgba(_ rep: NSBitmapImageRep) -> [UInt8] {
  let width = rep.pixelsWide, height = rep.pixelsHigh
  var pixels = [UInt8](repeating: 0, count: width * height * 4)
  let context = CGContext(
    data: &pixels, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  context.draw(rep.cgImage!, in: CGRect(x: 0, y: 0, width: width, height: height))
  return pixels
}
