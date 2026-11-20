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
        ScrollView {
          VStack(spacing: 0) {
            ForEach(failures) { failure in
              let on = failure.id == selected?.id
              Button {
                selection = failure.id
              } label: {
                VStack(alignment: .leading, spacing: 1) {
                  Text(failure.title).lineLimit(2).multilineTextAlignment(.leading)
                  Text(failure.date, format: .dateTime.hour().minute()).font(DS.caption).foregroundStyle(.secondary)
                }
                .font(DS.body)
                .foregroundStyle(on ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.primary))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .background(on ? DS.accentTint : .clear, in: .rect(cornerRadius: 6))
                .contentShape(.rect)
              }
              .buttonStyle(.plain)
              .accessibilityAddTraits(on ? .isSelected : [])
            }
          }
          .padding(.horizontal, 4)
          .padding(.vertical, 6)
        }
        .frame(width: 200)
        .background(.background.secondary)
        Rectangle().fill(DS.hairline).frame(width: 0.5)
      }
      if let failure = selected {
        Detail(failure: failure)
      } else {
        Text("No failures").foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .font(DS.body)
    .frame(minWidth: 520, minHeight: 320)
  }

  private var selected: Failure? {
    failures.first { $0.id == selection } ?? failures.first
  }
}

private struct Detail: View {
  let failure: Failure
  @Environment(\.timeZone) private var timeZone

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 8) {
        Image(systemName: "xmark.circle").foregroundStyle(.red).frame(width: 14).accessibilityHidden(true)
        Text(failure.title).font(DS.sheetTitle).lineLimit(2)
        Spacer(minLength: 8)
        Button("Copy output") {
          NSPasteboard.general.clearContents()
          NSPasteboard.general.setString(failure.detail, forType: .string)
        }
        .buttonStyle(.pill)
      }
      Text(when)
        .font(DS.caption)
        .foregroundStyle(.secondary)
        .padding(.leading, 22)
        .padding(.top, 2)
        .padding(.bottom, 10)
      ScrollView([.vertical, .horizontal]) {
        Text(failure.detail.isEmpty ? "No output was captured." : failure.detail)
          .font(DS.mono)
          .lineSpacing(5)
          .foregroundStyle(.secondary)
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .topLeading)
          .padding(.horizontal, 10)
          .padding(.vertical, 8)
      }
      .background(DS.neutralFill, in: .rect(cornerRadius: DS.radius))
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
  }

  /// "Today at 14:32".
  private var when: String {
    let formatter = DateFormatter()
    formatter.dateStyle = .medium
    formatter.timeStyle = .short
    formatter.doesRelativeDateFormatting = true
    formatter.timeZone = timeZone
    return formatter.string(from: failure.date)
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
      window.title = "Failures"
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
