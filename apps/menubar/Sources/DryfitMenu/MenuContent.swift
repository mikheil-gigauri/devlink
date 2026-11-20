import DryfitAPI
import SwiftUI

/// What the menu asks of the app around it: the log, login, updates, quitting.
public struct MenuActions {
  public var openLog: () -> Void
  public var showFailures: (Failure.ID?) -> Void
  public var quit: () -> Void
  /// Nil when the app cannot be a login item (run outside its bundle).
  public var openAtLogin: Binding<Bool>?
  /// Nil when the app does not update itself (run outside its bundle, or built without an update key).
  public var checkForUpdates: (() -> Void)?
  /// Whether updates install by themselves; nil when the app does not update itself.
  public var installUpdatesAutomatically: Binding<Bool>?

  public init(
    openLog: @escaping () -> Void = {}, showFailures: @escaping (Failure.ID?) -> Void = { _ in },
    quit: @escaping () -> Void = {}, openAtLogin: Binding<Bool>? = nil,
    checkForUpdates: (() -> Void)? = nil, installUpdatesAutomatically: Binding<Bool>? = nil
  ) {
    self.openLog = openLog
    self.showFailures = showFailures
    self.quit = quit
    self.openAtLogin = openAtLogin
    self.checkForUpdates = checkForUpdates
    self.installUpdatesAutomatically = installUpdatesAutomatically
  }
}

/// The menu bar window (ADR 0013): what dryfit is doing at a glance, with the everyday controls —
/// watch, sync, link, restore. Adding and changing things happens in the dryfit window, one click away.
public struct MenuContent: View {
  let model: MenuModel
  let navigation: AppNavigation
  let actions: MenuActions
  @Environment(\.openWindow) private var openWindow

  public init(model: MenuModel, navigation: AppNavigation = AppNavigation(), actions: MenuActions) {
    self.model = model
    self.navigation = navigation
    self.actions = actions
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Header(model: model) { show(nil) }
      Divider()
      if model.connection == .online, let outdated = model.outdatedVersion {
        OutdatedBanner(model: model, version: outdated)
        Divider()
      }
      switch model.connection {
      case .online:
        OnlineContent(model: model, actions: actions, show: show)
      case .offline, .starting:
        ServiceUnavailableView(model: model, actions: actions, compact: true)
      case .connecting:
        ProgressView().controlSize(.small).frame(maxWidth: .infinity).padding(28)
      case .incompatible(let daemonVersion):
        IncompatibleView(model: model, actions: actions, daemonVersion: daemonVersion)
      }
      Divider()
      Footer(model: model, actions: actions) {
        navigation.wantsNewLibrary = true
        show(nil)
      }
    }
    .frame(width: 340)
    .onAppear { model.menuOpened() }
  }

  /// Opens the dryfit window, at `item` when given.
  private func show(_ item: SidebarItem?) {
    if let item { navigation.selection = item }
    openWindow(id: mainWindowID)
    NSApp.activate()
  }
}

// MARK: Header and footer

private struct Header: View {
  let model: MenuModel
  let openWindow: () -> Void

  var body: some View {
    HStack(spacing: 8) {
      Circle().fill(dot).frame(width: 8, height: 8).accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 0) {
        Text("dryfit").font(.headline)
        Text(subtitle).font(.caption).foregroundStyle(.secondary)
      }
      Spacer()
      Button("Open", action: openWindow)
        .controlSize(.small)
        .help("Open the dryfit window to add libraries, link apps and manage groups")
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 10)
  }

  private var dot: Color {
    switch model.connection {
    case .online: .green
    case .connecting, .starting: .yellow
    case .offline: .secondary
    case .incompatible: .orange
    }
  }

  private var subtitle: String {
    switch model.connection {
    case .online: model.status.map { "Running, version \($0.daemon.version)" } ?? "Running"
    case .connecting: "Looking for dryfit…"
    case .starting: "Starting…"
    case .offline: "Not running"
    case .incompatible: "Needs an update"
    }
  }
}

private struct Footer: View {
  let model: MenuModel
  let actions: MenuActions
  let addLibrary: () -> Void
  @Environment(\.openSettings) private var openSettings

  var body: some View {
    HStack(spacing: 8) {
      if let activity = model.activity {
        ProgressView().controlSize(.mini)
        Text(activity).lineLimit(1).truncationMode(.middle).foregroundStyle(.secondary)
      } else if model.connection == .online {
        Button("Add Library…", systemImage: "plus", action: addLibrary)
          .buttonStyle(.borderless)
      }
      Spacer(minLength: 8)
    }
    .font(.callout)
    .padding(.horizontal, 14)
    .padding(.vertical, 8)
    // The rest of what the footer's menu held is on the menu bar icon's right-click menu. These keep
    // its shortcuts working while the window is open.
    .background {
      Group {
        Button("Settings…") {
          openSettings()
          NSApp.activate()
        }
        .keyboardShortcut(",")
        Button("Quit", action: actions.quit).keyboardShortcut("q")
      }
      .opacity(0)
      .accessibilityHidden(true)
    }
  }
}

// MARK: Online

private struct OnlineContent: View {
  let model: MenuModel
  let actions: MenuActions
  let show: (SidebarItem?) -> Void

  var body: some View {
    // As tall as its content, scrolling past what fits under the menu bar.
    ScrollView { sections }
      .scrollBounceBehavior(.basedOnSize)
      .frame(maxHeight: 540)
      .fixedSize(horizontal: false, vertical: true)
      .task {
        // The Link menus offer projects that use each library; finding them reads the disk once.
        if model.consumers.isEmpty { await model.discoverConsumers() }
      }
  }

  private var sections: some View {
    VStack(alignment: .leading, spacing: 14) {
      if let failure = model.failures.first {
        FailureBanner(failure: failure, more: model.failures.count - 1, model: model, actions: actions)
      }
      if let request = model.driftedRestore {
        DriftedRestoreBanner(request: request, model: model)
      }
      if let error = model.actionError {
        ErrorBanner(message: error) { model.dismissActionError() }
      }
      if model.libraries.isEmpty {
        GetStarted(model: model) { show(nil) }
      } else {
        MenuSection(title: "Libraries") {
          ForEach(model.libraries) { row in
            LibraryRowView(row: row, model: model) { show(.library(row.library.name)) }
          }
        }
      }
      if let groups = model.status?.groups, !groups.isEmpty {
        MenuSection(title: "Groups") {
          ForEach(groups) { group in
            GroupRowView(group: group, model: model) { show(.group(group.name)) }
          }
        }
      }
      if let warnings = model.status?.warnings, !warnings.isEmpty {
        ForEach(Array(warnings.enumerated()), id: \.offset) { _, warning in WarningRow(warning: warning) }
      }
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 12)
  }
}

private struct MenuSection<Content: View>: View {
  let title: String
  @ViewBuilder let content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(title)
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(.secondary)
        .padding(.horizontal, 6)
        .padding(.bottom, 2)
      content
    }
  }
}

/// A row that highlights under the pointer, like a menu item.
private struct HoverHighlight: ViewModifier {
  @State private var hovering = false

  func body(content: Content) -> some View {
    content
      .padding(.horizontal, 6)
      .padding(.vertical, 4)
      .background(hovering ? AnyShapeStyle(.quaternary) : AnyShapeStyle(.clear), in: .rect(cornerRadius: 8))
      .onHover { hovering = $0 }
  }
}

private struct GetStarted: View {
  let model: MenuModel
  let openWindow: () -> Void

  var body: some View {
    VStack(spacing: 10) {
      Tile(symbol: "shippingbox", tint: .teal, size: 44)
      Text("Test your library in your apps").font(.headline)
      Text("Add a library you are working on, and dryfit installs each change into the apps that use it.")
        .font(.callout)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
      Button("Get Started", action: openWindow)
        .buttonStyle(.borderedProminent)
        .padding(.top, 2)
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 12)
    .padding(.horizontal, 16)
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
    .background(.red.opacity(0.1), in: .rect(cornerRadius: 10))
  }

  private var firstLine: String {
    failure.detail.split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
  }
}

/// Restoring was refused because the app's package.json changed since it was linked.
struct DriftedRestoreBanner: View {
  let request: RestoreRequest
  let model: MenuModel

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Label {
        Text("\(projectName(request.consumer))'s package.json changed after it was linked. Restoring puts back the version from before linking, and drops those changes.")
      } icon: {
        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
      }
      .font(.callout)
      .fixedSize(horizontal: false, vertical: true)
      HStack {
        Spacer()
        Button("Cancel") { model.driftedRestore = nil }
        Button("Restore Anyway") {
          Task { await model.restore(request.consumer, library: request.library, force: true) }
        }
      }
      .controlSize(.small)
    }
    .padding(10)
    .background(.orange.opacity(0.1), in: .rect(cornerRadius: 10))
  }
}

private struct LibraryRowView: View {
  let row: LibraryRow
  let model: MenuModel
  let open: () -> Void
  @Environment(\.timeZone) private var timeZone

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 8) {
        Button(action: open) {
          VStack(alignment: .leading, spacing: 1) {
            Text(row.library.name).font(.body.weight(.medium)).lineLimit(1)
            Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .help("Show \(name) in the dryfit window")
        Toggle("Auto-sync \(name)", isOn: watch)
          .toggleStyle(.switch)
          .controlSize(.mini)
          .labelsHidden()
          .disabled(model.isBusy(.watch(name)))
          .help(row.library.isWatched ? "Auto-sync is on: every change you save is synced" : "Auto-sync: sync every change you save")
        IconButton(
          symbol: "arrow.triangle.2.circlepath", label: "Sync \(name) now", busy: model.isBusy(.sync(name))
        ) { Task { await model.sync(name) } }
      }
      .modifier(HoverHighlight())
      ForEach(row.links) { link in LinkRowView(link: link, model: model) }
      Menu {
        LinkMenuItems(library: name, model: model)
      } label: {
        Label("Link to App", systemImage: "plus").font(.caption)
      }
      .menuStyle(.button)
      .buttonStyle(.borderless)
      .menuIndicator(.hidden)
      .controlSize(.small)
      .fixedSize()
      .padding(.leading, 20)
      .padding(.vertical, 2)
    }
  }

  private var name: String { row.library.name }

  private var subtitle: String {
    row.library.published(timeZone: timeZone) + (row.library.isWatched ? " · Auto-sync on" : "")
  }

  private var watch: Binding<Bool> {
    Binding(get: { row.library.isWatched }, set: { enabled in Task { await model.setWatch(name, enabled: enabled) } })
  }
}

private struct LinkRowView: View {
  let link: DryfitAPI.Link
  let model: MenuModel
  @Environment(\.timeZone) private var timeZone

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: link.symbol)
        .font(.caption)
        .foregroundStyle(link.tint)
        .frame(width: 16)
      Text(projectName(link.consumer)).lineLimit(1)
      Spacer(minLength: 8)
      Text(link.detail(timeZone: timeZone))
        .font(.caption)
        .foregroundStyle(link.status == .failed ? .red : .secondary)
        .lineLimit(1)
      IconButton(
        symbol: "arrow.uturn.backward",
        label: "Put \(projectName(link.consumer)) back on the release of \(link.library)",
        busy: model.isBusy(.restore(link.consumer, link.library))
      ) { Task { await model.restore(link.consumer, library: link.library) } }
    }
    .padding(.leading, 14)
    .modifier(HoverHighlight())
    .help(abbreviatedPath(link.consumer))
  }
}

private struct GroupRowView: View {
  let group: DryfitAPI.Group
  let model: MenuModel
  let open: () -> Void

  var body: some View {
    HStack(spacing: 8) {
      Button(action: open) {
        VStack(alignment: .leading, spacing: 1) {
          Text(group.name).font(.body.weight(.medium))
          Text(group.consumers.map(projectName).joined(separator: ", "))
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
      }
      .buttonStyle(.plain)
      Menu {
        Section("Link into every app in \(group.name)") {
          ForEach(model.status?.libraries ?? []) { library in
            Button(library.name) { Task { await model.linkGroup(group.name, library: library.name) } }
          }
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
      .help("Link a library into every app in \(group.name)")
      .accessibilityLabel("Link a library into \(group.name)")
      IconButton(
        symbol: "arrow.uturn.backward", label: "Put every app in \(group.name) back on released versions",
        busy: model.isBusy(.restoreGroup(group.name))
      ) { Task { await model.restoreGroup(group.name) } }
    }
    .modifier(HoverHighlight())
  }
}

private struct WarningRow: View {
  let warning: CoherenceWarning
  @Environment(\.timeZone) private var timeZone

  var body: some View {
    Label {
      Text("\(warning.group) has \(warning.library) at different versions: \(versions)")
    } icon: {
      Image(systemName: "exclamationmark.triangle").foregroundStyle(.orange)
    }
    .font(.caption)
    .foregroundStyle(.secondary)
    .padding(.horizontal, 6)
  }

  private var versions: String {
    warning.versions
      .map { "\(projectName($0.consumer)) \(DevVersion.describe($0.version, timeZone: timeZone))" }
      .joined(separator: ", ")
  }
}

// MARK: Not running

/// dryfit's service is not running: start it, or install the CLI it runs from.
struct ServiceUnavailableView: View {
  let model: MenuModel
  let actions: MenuActions
  var compact = false

  var body: some View {
    VStack(spacing: 10) {
      Image(systemName: model.cliMissing ? "arrow.down.circle" : "power")
        .font(.system(size: compact ? 28 : 40, weight: .light))
        .foregroundStyle(.tertiary)
      Text(model.cliMissing ? "Install dryfit" : "dryfit is not running").font(compact ? .headline : .title2.bold())
      Text(explanation)
        .font(.callout)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
      if model.connection == .starting {
        ProgressView("Starting…").controlSize(.small).padding(.top, 4)
      } else if model.isBusy(.installCLI) {
        ProgressView("Installing with npm…").controlSize(.small).padding(.top, 4)
      } else if model.cliMissing {
        Button("Install dryfit") { Task { await model.installCLI() } }
          .buttonStyle(.borderedProminent)
          .padding(.top, 4)
        Text("Runs \(DaemonLauncher.installCommand)").font(.caption).foregroundStyle(.tertiary)
      } else {
        Button("Start dryfit") { Task { await model.startDaemon() } }
          .buttonStyle(.borderedProminent)
          .padding(.top, 4)
      }
      // Shown while the CLI is missing too: a failed install would otherwise just offer the button
      // again, with no word of why.
      if let error = model.startError, !model.isBusy(.installCLI) {
        Text(error)
          .font(.caption)
          .foregroundStyle(.red)
          .multilineTextAlignment(.center)
          .textSelection(.enabled)
          .fixedSize(horizontal: false, vertical: true)
        if model.cliMissing {
          Button("Copy Install Command") {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(DaemonLauncher.installCommand, forType: .string)
          }
          .buttonStyle(.link)
          .font(.caption)
        } else {
          Button("Open Log", action: actions.openLog).buttonStyle(.link).font(.caption)
        }
      }
    }
    .frame(maxWidth: compact ? .infinity : 380)
    .padding(.horizontal, 24)
    .padding(.vertical, 20)
  }

  private var explanation: String {
    if model.cliMissing {
      return "The app runs dryfit's command-line tool in the background. It needs Node.js and npm."
    }
    return "Start it to publish your libraries and install them into your apps."
  }
}

struct IncompatibleView: View {
  let model: MenuModel
  let actions: MenuActions
  let daemonVersion: String

  var body: some View {
    VStack(spacing: 8) {
      Image(systemName: "exclamationmark.triangle")
        .font(.system(size: 26, weight: .light))
        .foregroundStyle(.orange)
      Text("This app and dryfit \(daemonVersion) do not match").font(.headline)
        .multilineTextAlignment(.center)
      Text(explanation)
        .font(.callout)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
      if model.outdatedVersion != nil {
        UpdateDryfitControl(model: model, prominent: true).padding(.top, 4)
      } else if model.appIsOlder, let checkForUpdates = actions.checkForUpdates {
        Button("Check for Updates…", action: checkForUpdates)
          .buttonStyle(.borderedProminent)
          .padding(.top, 4)
      }
    }
    .frame(maxWidth: .infinity)
    .padding(.horizontal, 24)
    .padding(.vertical, 20)
  }

  private var explanation: String {
    if model.outdatedVersion != nil {
      return "They speak different versions of dryfit's API. dryfit is the older one."
    }
    if model.appIsOlder { return "They speak different versions of dryfit's API. This app is the older one." }
    return "They speak different versions of dryfit's API. Update the one that is older."
  }
}

/// Above the menu while dryfit runs an older version than this app: the app updated itself, but the
/// CLI it runs comes from npm.
private struct OutdatedBanner: View {
  let model: MenuModel
  let version: String

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Image(systemName: "arrow.up.circle.fill").foregroundStyle(.orange).accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 2) {
        Text("dryfit \(version) is older than this app").font(.callout.weight(.medium))
        Text("Update it to \(model.appVersion ?? "the newest version") to get what is new.")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      Spacer(minLength: 8)
      UpdateDryfitControl(model: model, prominent: false)
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 8)
  }
}

/// Updates dryfit with npm and restarts it, showing progress and, when it fails, why.
struct UpdateDryfitControl: View {
  let model: MenuModel
  let prominent: Bool

  var body: some View {
    VStack(alignment: prominent ? .center : .trailing, spacing: 4) {
      if model.isBusy(.updateCLI) {
        ProgressView(prominent ? "Updating with npm…" : "").controlSize(.small)
      } else if prominent {
        Button("Update dryfit") { Task { await model.updateCLI() } }
          .buttonStyle(.borderedProminent)
        Text("Runs npm install --global @dryfit/cli@latest, then restarts dryfit")
          .font(.caption)
          .foregroundStyle(.tertiary)
          .multilineTextAlignment(.center)
      } else {
        Button("Update") { Task { await model.updateCLI() } }
          .controlSize(.small)
          .help("Runs npm install --global @dryfit/cli@latest, then restarts dryfit")
      }
      if let error = model.updateError {
        Text(error)
          .font(.caption)
          .foregroundStyle(.red)
          .multilineTextAlignment(prominent ? .center : .trailing)
          .textSelection(.enabled)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
  }
}
