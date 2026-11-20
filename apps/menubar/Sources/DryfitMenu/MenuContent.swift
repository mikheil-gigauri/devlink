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
/// The window itself is system glass; what it lists is content, drawn with hairlines rather than glass.
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
        OnlineContent(model: model, actions: actions, show: show, addLibrary: addLibrary)
      case .offline, .starting:
        ServiceUnavailableView(model: model, actions: actions, compact: true)
      case .connecting:
        ProgressView().controlSize(.small).frame(maxWidth: .infinity).padding(28)
      case .incompatible(let daemonVersion):
        IncompatibleView(model: model, actions: actions, daemonVersion: daemonVersion)
      }
      // Only when it has something to say: what dryfit is doing, or a way to add a library.
      if model.activity != nil || (model.connection == .online && !model.libraries.isEmpty) {
        Divider()
        Footer(model: model, addLibrary: addLibrary)
      }
    }
    .frame(width: 340)
    .onAppear { model.menuOpened() }
    // The rest of what the old footer menu held is on the menu bar icon's right-click menu. These keep
    // its shortcuts working while the window is open.
    .background {
      Group {
        Button("Settings…") { navigation.showSettings { openWindow(id: mainWindowID) } }
          .keyboardShortcut(",")
        Button("Quit", action: actions.quit).keyboardShortcut("q")
      }
      .opacity(0)
      .accessibilityHidden(true)
    }
  }

  /// Opens the dryfit window, at `item` when given.
  private func show(_ item: SidebarItem?) {
    if let item { navigation.selection = item }
    openWindow(id: mainWindowID)
    NSApp.activate()
  }

  private func addLibrary() {
    navigation.wantsNewLibrary = true
    show(nil)
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
    case .online: model.failures.isEmpty ? .green : .orange
    case .connecting, .starting: .yellow
    case .offline: .secondary
    case .incompatible: .orange
    }
  }

  private var subtitle: String {
    switch model.connection {
    case .online:
      if !model.failures.isEmpty {
        return model.failures.count == 1 ? "Running · 1 failure" : "Running · \(model.failures.count) failures"
      }
      return model.status.map { "Running, version \($0.daemon.version)" } ?? "Running"
    case .connecting: return "Looking for dryfit…"
    case .starting: return "Starting…"
    case .offline: return "Not running"
    case .incompatible: return "Needs an update"
    }
  }
}

private struct Footer: View {
  let model: MenuModel
  let addLibrary: () -> Void

  var body: some View {
    HStack(spacing: 8) {
      if let activity = model.activity {
        ProgressView().controlSize(.mini)
        Text(activity).lineLimit(1).truncationMode(.middle).foregroundStyle(.secondary)
      } else {
        Button("Add Library…", systemImage: "plus", action: addLibrary)
          .buttonStyle(.borderless)
      }
      Spacer(minLength: 8)
    }
    .font(.callout)
    .padding(.horizontal, 14)
    .padding(.vertical, 8)
  }
}

// MARK: Online

private struct OnlineContent: View {
  let model: MenuModel
  let actions: MenuActions
  let show: (SidebarItem?) -> Void
  let addLibrary: () -> Void

  var body: some View {
    // As tall as its content, scrolling past what fits under the menu bar.
    ScrollView { sections }
      .scrollBounceBehavior(.basedOnSize)
      .frame(maxHeight: 540)
      .fixedSize(horizontal: false, vertical: true)
      .task {
        // The link chips offer projects that use each library; finding them reads the disk once.
        if model.consumers.isEmpty { await model.discoverConsumers() }
      }
  }

  private var sections: some View {
    VStack(alignment: .leading, spacing: 10) {
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
        GetStarted(addLibrary: addLibrary)
      } else {
        ForEach(model.libraries) { row in
          LibraryCard(row: row, model: model, actions: actions) { show(.library(row.library.name)) }
        }
      }
      if !model.groups.isEmpty {
        VStack(alignment: .leading, spacing: 2) {
          Text("Groups")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 6)
            .padding(.top, 4)
          ForEach(model.groups) { group in
            GroupRowView(group: group, model: model) { show(.group(group.name)) }
          }
        }
      }
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 10)
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
  let addLibrary: () -> Void

  var body: some View {
    VStack(spacing: 10) {
      Tile(symbol: "shippingbox", tint: .teal, size: 44)
      Text("Test your library in your apps").font(.headline)
      Text("Add a library you're working on, and dryfit installs each change into the apps that use it.")
        .font(.callout)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
      Button("Add Library…", action: addLibrary)
        .buttonStyle(.glassProminent)
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


/// A library as a card: its state and controls on top, then, unless folded, the apps it is linked
/// into and one-click links for the apps that use it. A card is content, so a hairline, not glass.
private struct LibraryCard: View {
  let row: LibraryRow
  let model: MenuModel
  let actions: MenuActions
  let open: () -> Void
  /// Folded libraries, by name, one per line; kept between launches.
  @AppStorage("foldedLibraries") private var folded = ""
  @Environment(\.timeZone) private var timeZone

  var body: some View {
    let candidates = model.linkCandidates(for: name)
    VStack(alignment: .leading, spacing: 2) {
      HStack(spacing: 6) {
        Button {
          withAnimation(.snappy) { isFolded.toggle() }
        } label: {
          Image(systemName: "chevron.right")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .rotationEffect(.degrees(isFolded ? 0 : 90))
            .frame(width: 14, height: 22)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isFolded ? "Show \(name)'s apps" : "Hide \(name)'s apps")
        Button(action: open) {
          VStack(alignment: .leading, spacing: 1) {
            Text(name).font(.body.weight(.medium)).lineLimit(1)
            Text(subtitle(candidates: candidates.count)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .help("Show \(name) in the dryfit window")
        Text("Auto").font(.caption).foregroundStyle(.secondary).accessibilityHidden(true)
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
      if syncing {
        ProgressView().progressViewStyle(.linear).controlSize(.mini).padding(.leading, 20)
          .accessibilityLabel("Syncing \(name)")
      }
      if !isFolded {
        ForEach(row.links) { link in LinkRowView(link: link, model: model, actions: actions) }
        LinkChips(library: name, candidates: candidates, model: model)
          .padding(.leading, 20)
          .padding(.top, 2)
      }
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 6)
    .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(.separator, lineWidth: 0.5) }
  }

  private var name: String { row.library.name }

  private var isFolded: Bool {
    get { folded.split(separator: "\n").contains { $0 == name } }
    nonmutating set {
      var names = folded.split(separator: "\n").map(String.init).filter { $0 != name }
      if newValue { names.append(name) }
      folded = names.joined(separator: "\n")
    }
  }

  /// Syncing now: the user asked, or the daemon is running a job for this library.
  private var syncing: Bool {
    model.isBusy(.sync(name)) || model.status?.jobs.running?.label == "sync \(name)"
  }

  private func subtitle(candidates: Int) -> String {
    let count = row.links.count
    guard count > 0 else {
      switch candidates {
      case 0: return "Not linked"
      case 1: return "Not linked · 1 app uses it"
      default: return "Not linked · \(candidates) apps use it"
      }
    }
    let apps = count == 1 ? "1 app" : "\(count) apps"
    return row.library.published(timeZone: timeZone) + " · " + apps
  }

  private var watch: Binding<Bool> {
    Binding(get: { row.library.isWatched }, set: { enabled in Task { await model.setWatch(name, enabled: enabled) } })
  }
}

private struct LinkRowView: View {
  let link: DryfitAPI.Link
  let model: MenuModel
  let actions: MenuActions
  @State private var hovering = false
  @Environment(\.timeZone) private var timeZone

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: link.symbol)
        .font(.caption)
        .foregroundStyle(link.tint)
        .frame(width: 16)
      Text(projectName(link.consumer)).lineLimit(1)
      Spacer(minLength: 8)
      if link.status == .failed, let failure = model.installFailure(in: link.consumer) {
        Button("Failed · Show Output") { actions.showFailures(failure.id) }
          .buttonStyle(.link)
          .font(.caption)
          .foregroundStyle(.red)
      } else {
        Text(link.detail(timeZone: timeZone))
          .font(.caption)
          .foregroundStyle(link.status == .failed ? .red : .secondary)
          .lineLimit(1)
      }
      // Shown under the pointer only, so a list of healthy links stays quiet.
      IconButton(
        symbol: "arrow.uturn.backward",
        label: "Put \(projectName(link.consumer)) back on the release of \(link.library)",
        busy: busy
      ) { Task { await model.restore(link.consumer, library: link.library) } }
      .opacity(hovering || busy ? 1 : 0)
    }
    .padding(.leading, 14)
    .modifier(HoverHighlight())
    .onHover { hovering = $0 }
    .help(abbreviatedPath(link.consumer))
  }

  private var busy: Bool { model.isBusy(.restore(link.consumer, link.library)) }
}

/// Apps that use the library and are not linked to it, each linked with one click, then a menu for
/// any other folder.
private struct LinkChips: View {
  let library: String
  let candidates: [DiscoveredConsumer]
  let model: MenuModel

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      if !candidates.isEmpty {
        Text("Also uses it:").font(.caption).foregroundStyle(.secondary)
      }
      FlowLayout(spacing: 4) {
        ForEach(candidates) { consumer in
          let busy = model.isBusy(.link(library, consumer.root))
          Button {
            Task { await model.link(library, into: consumer.root) }
          } label: {
            HStack(spacing: 3) {
              if busy { ProgressView().controlSize(.mini) } else { Image(systemName: "link") }
              Text(projectName(consumer.root)).lineLimit(1)
            }
            .font(.caption)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .foregroundStyle(.tint)
            .background(.tint.opacity(0.14), in: .rect(cornerRadius: 6))
          }
          .buttonStyle(.plain)
          .disabled(busy)
          .help("Install the dev build of \(library) into \(projectName(consumer.root))")
        }
        Menu {
          LinkMenuItems(library: library, model: model)
        } label: {
          Text(candidates.isEmpty ? "Link to App…" : "Other…").font(.caption)
        }
        .menuStyle(.button)
        .buttonStyle(.borderless)
        .menuIndicator(.hidden)
        .controlSize(.small)
        .fixedSize()
      }
    }
  }
}

private struct GroupRowView: View {
  let group: DryfitAPI.Group
  let model: MenuModel
  let open: () -> Void

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: "square.stack.3d.up").foregroundStyle(.secondary).frame(width: 16)
      Button(action: open) {
        VStack(alignment: .leading, spacing: 1) {
          Text(group.name).font(.body.weight(.medium))
          Text(subtitle)
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
          ForEach(model.libraries) { row in
            Button(row.library.name) { Task { await model.linkGroup(group.name, library: row.library.name) } }
          }
        }
      } label: {
        if model.isBusy(.linkGroup(group.name)) {
          ProgressView().controlSize(.mini)
        } else {
          Text("Link…")
        }
      }
      .menuStyle(.button)
      .menuIndicator(.hidden)
      .controlSize(.small)
      .fixedSize()
      .help("Link a library into every app in \(group.name)")
      IconButton(
        symbol: "arrow.uturn.backward", label: "Put every app in \(group.name) back on released versions",
        busy: model.isBusy(.restoreGroup(group.name))
      ) { Task { await model.restoreGroup(group.name) } }
    }
    .modifier(HoverHighlight())
  }

  private var subtitle: String {
    let apps = group.consumers.map(projectName).joined(separator: ", ")
    let differs = model.status?.warnings.contains { $0.group == group.name } == true
    return differs ? apps + " · versions differ" : apps
  }
}

/// Lays its views out in rows, wrapping to a new row when the next one does not fit.
struct FlowLayout: Layout {
  var spacing: CGFloat = 4

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let rows = rows(width: proposal.width ?? .infinity, subviews: subviews)
    let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
    return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var y = bounds.minY
    for row in rows(width: bounds.width, subviews: subviews) {
      var x = bounds.minX
      for index in row.indices {
        let size = subviews[index].sizeThatFits(.unspecified)
        subviews[index].place(at: CGPoint(x: x, y: y + (row.height - size.height) / 2), proposal: .unspecified)
        x += size.width + spacing
      }
      y += row.height + spacing
    }
  }

  private func rows(width: CGFloat, subviews: Subviews) -> [(indices: [Int], width: CGFloat, height: CGFloat)] {
    var rows: [(indices: [Int], width: CGFloat, height: CGFloat)] = []
    var current: (indices: [Int], width: CGFloat, height: CGFloat) = ([], 0, 0)
    for index in subviews.indices {
      let size = subviews[index].sizeThatFits(.unspecified)
      let needed = current.indices.isEmpty ? size.width : current.width + spacing + size.width
      if needed > width, !current.indices.isEmpty {
        rows.append(current)
        current = ([index], size.width, size.height)
      } else {
        current = (current.indices + [index], needed, max(current.height, size.height))
      }
    }
    if !current.indices.isEmpty { rows.append(current) }
    return rows
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
          .buttonStyle(.glassProminent)
          .padding(.top, 4)
        Text("Runs \(DaemonLauncher.installCommand)").font(.caption).foregroundStyle(.tertiary)
      } else {
        Button("Start dryfit") { Task { await model.startDaemon() } }
          .buttonStyle(.glassProminent)
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
          .buttonStyle(.glassProminent)
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
          .buttonStyle(.glassProminent)
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
