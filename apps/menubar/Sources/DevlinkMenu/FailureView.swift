import AppKit
import SwiftUI

/// The failures this session, with each one's full output: what a notification opens.
public struct FailureView: View {
  let failures: [Failure]
  @Binding var selection: Failure.ID?

  public init(failures: [Failure], selection: Binding<Failure.ID?>) {
    self.failures = failures
    self._selection = selection
  }

  public var body: some View {
    HStack(spacing: 0) {
      if failures.count > 1 {
        List(failures, selection: $selection) { failure in
          VStack(alignment: .leading, spacing: 2) {
            Text(failure.title).lineLimit(2)
            Text(failure.date, format: .dateTime.hour().minute()).font(.caption).foregroundStyle(.secondary)
          }
          .padding(.vertical, 2)
        }
        .listStyle(.inset)
        .frame(width: 220)
        Divider()
      }
      if let failure = selected {
        Detail(failure: failure)
      } else {
        Text("No failures").foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .frame(minWidth: 520, minHeight: 320)
  }

  private var selected: Failure? {
    failures.first { $0.id == selection } ?? failures.first
  }
}

private struct Detail: View {
  let failure: Failure

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline) {
        VStack(alignment: .leading, spacing: 2) {
          Text(failure.title).font(.title3.weight(.semibold))
          Text(failure.date, format: .dateTime.hour().minute().second())
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        Spacer()
        Button("Copy Output") {
          NSPasteboard.general.clearContents()
          NSPasteboard.general.setString(failure.detail, forType: .string)
        }
      }
      ScrollView([.vertical, .horizontal]) {
        Text(failure.detail.isEmpty ? "No output was captured." : failure.detail)
          .font(.system(.callout, design: .monospaced))
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .topLeading)
          .padding(10)
      }
      .background(.background.secondary, in: .rect(cornerRadius: 6))
    }
    .padding(16)
  }
}

/// Owns the failures window, so a notification or the menu can bring it forward.
public final class FailureWindow {
  private var window: NSWindow?
  private let model: MenuModel

  public init(model: MenuModel) {
    self.model = model
  }

  public func show(selecting id: Failure.ID?) {
    let root = FailureWindowRoot(model: model, initial: id)
    if let window {
      window.contentView = NSHostingView(rootView: root)
    } else {
      let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 720, height: 440),
        styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
      window.title = "devlink Failures"
      window.isReleasedWhenClosed = false
      window.contentView = NSHostingView(rootView: root)
      window.center()
      self.window = window
    }
    NSApp.activate()
    window?.makeKeyAndOrderFront(nil)
  }
}

private struct FailureWindowRoot: View {
  let model: MenuModel
  @State private var selection: Failure.ID?

  init(model: MenuModel, initial: Failure.ID?) {
    self.model = model
    self._selection = State(initialValue: initial)
  }

  var body: some View {
    FailureView(failures: model.failures, selection: $selection)
  }
}
