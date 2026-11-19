import DevlinkAPI
import SwiftUI

/// What the menu asks of the app around it: windows, the log, login, quitting.
public struct MenuActions {
  public var openLog: () -> Void
  public var showFailures: (Failure.ID?) -> Void
  public var quit: () -> Void
  /// Nil when the app cannot be a login item (run outside its bundle).
  public var openAtLogin: Binding<Bool>?

  public init(
    openLog: @escaping () -> Void = {}, showFailures: @escaping (Failure.ID?) -> Void = { _ in },
    quit: @escaping () -> Void = {}, openAtLogin: Binding<Bool>? = nil
  ) {
    self.openLog = openLog
    self.showFailures = showFailures
    self.quit = quit
    self.openAtLogin = openAtLogin
  }
}

/// The menu bar window (ADR 0013): the daemon's libraries, links and groups, with the controls for a
/// full cycle — start, watch, sync, link, restore — and the failures worth reading.
public struct MenuContent: View {
  let model: MenuModel
  let actions: MenuActions

  public init(model: MenuModel, actions: MenuActions) {
    self.model = model
    self.actions = actions
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Header(model: model)
      Divider()
      switch model.connection {
      case .online:
        OnlineContent(model: model, actions: actions)
      case .offline, .starting:
        OfflineView(model: model, actions: actions)
      case .connecting:
        ProgressView().controlSize(.small).frame(maxWidth: .infinity).padding(28)
      case .incompatible(let daemonVersion):
        IncompatibleView(daemonVersion: daemonVersion)
      }
      Divider()
      Footer(model: model, actions: actions)
    }
    .frame(width: 360)
    .onAppear { model.menuOpened() }
  }
}

// MARK: Header and footer

private struct Header: View {
  let model: MenuModel

  var body: some View {
    HStack(alignment: .firstTextBaseline) {
      Text("devlink").font(.headline)
      Spacer()
      Text(subtitle).font(.caption).foregroundStyle(.secondary)
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 10)
  }

  private var subtitle: String {
    switch model.connection {
    case .online:
      guard let daemon = model.status?.daemon else { return "Running" }
      let port = URL(string: daemon.registryUrl)?.port.map { " · registry :\($0)" } ?? ""
      return "v\(daemon.version)\(port)"
    case .connecting: return "Looking for devlink…"
    case .starting: return "Starting…"
    case .offline: return "Not running"
    case .incompatible: return "Needs an update"
    }
  }
}

private struct Footer: View {
  let model: MenuModel
  let actions: MenuActions

  var body: some View {
    HStack(spacing: 8) {
      if let activity = model.activity {
        ProgressView().controlSize(.mini)
        Text(activity).lineLimit(1).truncationMode(.middle)
      } else {
        Text(model.connection == .online ? "Idle" : " ").foregroundStyle(.secondary)
      }
      Spacer(minLength: 8)
      Menu {
        Button("Open Daemon Log", action: actions.openLog)
        if !model.failures.isEmpty {
          Button("Show Failures…") { actions.showFailures(nil) }
        }
        if let openAtLogin = actions.openAtLogin {
          Toggle("Open at Login", isOn: openAtLogin)
        }
        Divider()
        Button("Quit devlink Menu", action: actions.quit).keyboardShortcut("q")
      } label: {
        Image(systemName: "ellipsis.circle")
      }
      .menuStyle(.borderlessButton)
      .menuIndicator(.hidden)
      .fixedSize()
      .accessibilityLabel("More")
    }
    .font(.caption)
    .padding(.horizontal, 14)
    .padding(.vertical, 8)
  }
}

// MARK: Offline

private struct OfflineView: View {
  let model: MenuModel
  let actions: MenuActions

  var body: some View {
    VStack(spacing: 10) {
      Image(systemName: "link")
        .font(.system(size: 28, weight: .light))
        .foregroundStyle(.tertiary)
      Text("devlink is not running").font(.headline)
      Text("Start it to publish your libraries and install them into your projects.")
        .font(.callout)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
      if model.connection == .starting {
        ProgressView("Starting…").controlSize(.small).padding(.top, 4)
      } else {
        Button("Start devlink") { Task { await model.startDaemon() } }
          .buttonStyle(.borderedProminent)
          .padding(.top, 4)
      }
      if let error = model.startError {
        Text(error)
          .font(.caption)
          .foregroundStyle(.red)
          .multilineTextAlignment(.center)
          .textSelection(.enabled)
        Button("Open Daemon Log", action: actions.openLog).buttonStyle(.link).font(.caption)
      } else {
        Text("Or run `devlink daemon start` in a terminal.")
          .font(.caption)
          .foregroundStyle(.tertiary)
      }
    }
    .frame(maxWidth: .infinity)
    .padding(.horizontal, 24)
    .padding(.vertical, 20)
  }
}

private struct IncompatibleView: View {
  let daemonVersion: String

  var body: some View {
    VStack(spacing: 8) {
      Image(systemName: "exclamationmark.triangle")
        .font(.system(size: 26, weight: .light))
        .foregroundStyle(.orange)
      Text("This app and devlink \(daemonVersion) do not match").font(.headline)
        .multilineTextAlignment(.center)
      Text("They speak different versions of devlink's API. Update the one that is older.")
        .font(.callout)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
    }
    .frame(maxWidth: .infinity)
    .padding(.horizontal, 24)
    .padding(.vertical, 20)
  }
}

// MARK: Online

private struct OnlineContent: View {
  let model: MenuModel
  let actions: MenuActions

  var body: some View {
    // As tall as its content, scrolling past what fits under the menu bar.
    ScrollView { sections }
      .scrollBounceBehavior(.basedOnSize)
      .frame(maxHeight: 520)
      .fixedSize(horizontal: false, vertical: true)
    .task {
      // The Link menus offer projects that use each library; finding them reads the disk once.
      if model.consumers.isEmpty { await model.discoverConsumers() }
    }
  }

  private var sections: some View {
    VStack(alignment: .leading, spacing: 12) {
      if let failure = model.failures.first {
        FailureBanner(failure: failure, more: model.failures.count - 1, model: model, actions: actions)
      }
      if let error = model.actionError {
        Label(error, systemImage: "exclamationmark.circle")
          .font(.caption)
          .foregroundStyle(.red)
          .textSelection(.enabled)
      }
      if model.libraries.isEmpty {
        EmptyLibraries()
      } else {
        Section(title: "Libraries") {
          ForEach(model.libraries) { row in LibraryRowView(row: row, model: model) }
        }
      }
      if let groups = model.status?.groups, !groups.isEmpty {
        Section(title: "Groups") {
          ForEach(groups) { group in GroupRowView(group: group, model: model) }
        }
      }
      if let warnings = model.status?.warnings, !warnings.isEmpty {
        ForEach(Array(warnings.enumerated()), id: \.offset) { _, warning in WarningRow(warning: warning) }
      }
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 12)
  }
}

private struct Section<Content: View>: View {
  let title: String
  @ViewBuilder let content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title.uppercased())
        .font(.caption2.weight(.semibold))
        .foregroundStyle(.secondary)
      content
    }
  }
}

private struct EmptyLibraries: View {
  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text("No libraries yet").font(.headline)
      Text("Run `devlink add` in a library's folder to publish it from here.")
        .font(.callout)
        .foregroundStyle(.secondary)
    }
    .padding(.vertical, 8)
  }
}

private struct FailureBanner: View {
  let failure: Failure
  let more: Int
  let model: MenuModel
  let actions: MenuActions

  var body: some View {
    HStack(alignment: .top, spacing: 8) {
      Image(systemName: "xmark.octagon.fill").foregroundStyle(.red)
      VStack(alignment: .leading, spacing: 2) {
        Text(failure.title).font(.callout.weight(.medium))
        Text(firstLine).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(2)
        HStack(spacing: 12) {
          Button(more > 0 ? "Show All \(more + 1)…" : "Show Output…") { actions.showFailures(failure.id) }
          Button("Dismiss") { model.clearFailures() }
        }
        .buttonStyle(.link)
        .font(.caption)
        .padding(.top, 2)
      }
      Spacer(minLength: 0)
    }
    .padding(10)
    .background(.red.opacity(0.08), in: .rect(cornerRadius: 8))
  }

  private var firstLine: String {
    failure.detail.split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
  }
}

private struct LibraryRowView: View {
  let row: LibraryRow
  let model: MenuModel
  @Environment(\.timeZone) private var timeZone

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        VStack(alignment: .leading, spacing: 1) {
          Text(row.library.name).font(.body.weight(.medium)).lineLimit(1)
          Text(published).font(.caption).foregroundStyle(.secondary)
        }
        Spacer(minLength: 8)
        Toggle("Watch", isOn: watch)
          .toggleStyle(.switch)
          .controlSize(.mini)
          .labelsHidden()
          .disabled(model.isBusy(.watch(name)))
          .help(row.library.isWatched ? "Watching for changes" : "Watch for changes")
        IconButton(
          symbol: "arrow.triangle.2.circlepath", label: "Sync \(name)", busy: model.isBusy(.sync(name))
        ) { Task { await model.sync(name) } }
        LinkMenu(library: name, model: model)
      }
      ForEach(row.links) { link in LinkRowView(link: link, model: model) }
    }
  }

  private var name: String { row.library.name }

  private var published: String {
    guard let version = row.library.lastPublishedVersion else { return "Not published yet" }
    return DevVersion.describe(version, timeZone: timeZone) + (row.library.isWatched ? " · watching" : "")
  }

  private var watch: Binding<Bool> {
    Binding(get: { row.library.isWatched }, set: { enabled in Task { await model.setWatch(name, enabled: enabled) } })
  }
}

private struct LinkMenu: View {
  let library: String
  let model: MenuModel

  var body: some View {
    Menu {
      let candidates = model.linkCandidates(for: library)
      if candidates.isEmpty {
        Text(model.isBusy(.discover) ? "Looking for projects…" : "No other projects use \(library)")
      }
      ForEach(candidates) { consumer in
        Button(consumer.name ?? projectName(consumer.root)) {
          Task { await model.link(library, into: consumer.root) }
        }
      }
      Divider()
      Button("Look Again") { Task { await model.discoverConsumers() } }
    } label: {
      Image(systemName: "link.badge.plus")
    }
    .menuStyle(.borderlessButton)
    .menuIndicator(.hidden)
    .fixedSize()
    .help("Link \(library) into a project")
    .accessibilityLabel("Link \(library) into a project")
  }
}

private struct LinkRowView: View {
  let link: DevlinkAPI.Link
  let model: MenuModel
  @Environment(\.timeZone) private var timeZone

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: symbol)
        .font(.caption)
        .foregroundStyle(tint)
        .frame(width: 14)
      Text(projectName(link.consumer)).lineLimit(1)
      Text(detail).font(.caption).foregroundStyle(link.status == .failed ? .red : .secondary).lineLimit(1)
      Spacer(minLength: 8)
      IconButton(
        symbol: "arrow.uturn.backward", label: "Restore \(projectName(link.consumer))",
        busy: model.isBusy(.restore(link.consumer))
      ) { Task { await model.restore(link.consumer) } }
    }
    .padding(.leading, 10)
    .help(link.consumer)
  }

  private var symbol: String {
    switch link.status {
    case .installed: "checkmark.circle.fill"
    case .pending: "clock"
    case .failed: "xmark.octagon.fill"
    }
  }

  private var tint: Color {
    switch link.status {
    case .installed: .green
    case .pending: .secondary
    case .failed: .red
    }
  }

  private var detail: String {
    switch link.status {
    case .failed: "Install failed"
    case .pending: "Sync to install"
    case .installed: link.installedVersion.map { DevVersion.describe($0, timeZone: timeZone) } ?? "Installed"
    }
  }
}

private struct GroupRowView: View {
  let group: DevlinkAPI.Group
  let model: MenuModel

  var body: some View {
    HStack(spacing: 8) {
      VStack(alignment: .leading, spacing: 1) {
        Text(group.name).font(.body.weight(.medium))
        Text(group.consumers.map(projectName).joined(separator: ", "))
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      Spacer(minLength: 8)
      Menu {
        ForEach(model.status?.libraries ?? []) { library in
          Button(library.name) { Task { await model.linkGroup(group.name, library: library.name) } }
        }
      } label: {
        if model.isBusy(.linkGroup(group.name)) {
          ProgressView().controlSize(.small)
        } else {
          Image(systemName: "link.badge.plus")
        }
      }
      .menuStyle(.borderlessButton)
      .menuIndicator(.hidden)
      .fixedSize()
      .help("Link a library into every project in \(group.name)")
      .accessibilityLabel("Link a library into \(group.name)")
      IconButton(
        symbol: "arrow.uturn.backward", label: "Restore every project in \(group.name)",
        busy: model.isBusy(.restoreGroup(group.name))
      ) { Task { await model.restoreGroup(group.name) } }
    }
  }
}

private struct WarningRow: View {
  let warning: CoherenceWarning
  @Environment(\.timeZone) private var timeZone

  var body: some View {
    Label {
      Text("\(warning.group) has \(warning.library) at different versions: ")
        + Text(warning.versions.map { "\(projectName($0.consumer)) \(DevVersion.describe($0.version, timeZone: timeZone))" }
          .joined(separator: ", "))
    } icon: {
      Image(systemName: "exclamationmark.triangle").foregroundStyle(.orange)
    }
    .font(.caption)
    .foregroundStyle(.secondary)
  }
}

/// A borderless symbol button that shows a spinner while its action runs.
private struct IconButton: View {
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
      .frame(width: 18, height: 18)
      .contentShape(.rect)
    }
    .buttonStyle(.borderless)
    .disabled(busy)
    .help(label)
    .accessibilityLabel(label)
  }
}
