import DryfitAPI
import SwiftUI
import UniformTypeIdentifiers

/// The dryfit window: every library and group, with everything the CLI can do, no terminal needed.
public struct MainWindow: View {
  let model: MenuModel
  @Bindable var navigation: AppNavigation
  let actions: MenuActions

  public init(model: MenuModel, navigation: AppNavigation, actions: MenuActions) {
    self.model = model
    self.navigation = navigation
    self.actions = actions
  }

  public var body: some View {
    NavigationSplitView {
      Sidebar(model: model, navigation: navigation)
        .navigationSplitViewColumnWidth(min: 180, ideal: 200, max: 300)
    } detail: {
      // The minimum size goes on the detail column, not the split view: on the split view it makes
      // the toolbar lag behind the sidebar while it opens, pushing the sidebar button into overflow.
      // Up into the title bar: a page's own controls sit level with the window's buttons.
      detail.frame(minWidth: 480, minHeight: 460)
    }
    .sheet(item: $navigation.libraryEditor) { request in
      LibraryEditor(root: request.root, model: model, navigation: navigation)
    }
    .sheet(item: $navigation.groupEditor) { request in
      GroupEditor(request: request, model: model, navigation: navigation)
    }
    .alert(
      "Restore \(model.driftedRestore.map { projectName($0.consumer) } ?? "the app") anyway?",
      isPresented: Binding(get: { model.driftedRestore != nil }, set: { if !$0 { model.driftedRestore = nil } })
    ) {
      Button("Restore anyway", role: .destructive) {
        if let request = model.driftedRestore {
          Task { await model.restore(request.consumer, library: request.library, force: true) }
        }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("Its package.json changed after it was linked. Restoring puts back the version from before linking, and drops those changes.")
    }
    .task(id: navigation.wantsNewLibrary) {
      guard navigation.wantsNewLibrary, model.connection == .online else { return }
      navigation.wantsNewLibrary = false
      await model.chooseLibraryFolder(navigation: navigation)
    }
    .task(id: model.connection) {
      if model.connection == .online, model.consumers.isEmpty { await model.discoverConsumers() }
    }
    .dropDestination(for: URL.self) { urls, _ in
      guard model.connection == .online, let folder = urls.first(where: \.hasDirectoryPath) else { return false }
      model.open(folderPath(folder), navigation: navigation, orAddAsLibrary: true)
      return true
    }
    .showsInDock()
  }

  @ViewBuilder private var detail: some View {
    // Settings shows whatever the connection, so dryfit can be started or its log opened from there.
    if navigation.selection == .settings {
      SettingsView(model: model, actions: actions)
    } else if model.connection == .online, navigation.selection == nil || !exists(navigation.selection) {
      WelcomeView(model: model, navigation: navigation)
    } else {
      connectedDetail
    }
  }

  private func exists(_ item: SidebarItem?) -> Bool {
    switch item {
    case .library(let name): model.libraries.contains { $0.id == name }
    case .app(let root): model.apps.contains { $0.root == root }
    case .group(let name): model.status?.groups.contains { $0.name == name } == true
    case .settings, nil: false
    }
  }

  @ViewBuilder private var connectedDetail: some View {
    switch model.connection {
    case .online:
      switch navigation.selection {
      case .library(let name) where model.libraries.contains { $0.id == name }:
        LibraryDetail(name: name, model: model, navigation: navigation, actions: actions)
      case .app(let root) where model.apps.contains { $0.root == root }:
        AppDetail(root: root, model: model, navigation: navigation, actions: actions)
      case .group(let name) where model.status?.groups.contains { $0.name == name } == true:
        GroupDetail(name: name, model: model, navigation: navigation)
      default:
        WelcomeView(model: model, navigation: navigation)
      }
    case .offline, .starting:
      ServiceUnavailableView(model: model, actions: actions).frame(maxWidth: .infinity, maxHeight: .infinity)
    case .connecting:
      ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
    case .incompatible(let daemonVersion):
      IncompatibleView(model: model, actions: actions, daemonVersion: daemonVersion)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }
}

// MARK: Sidebar

/// The sidebar: the system's source list, so it is the window's floating glass column, moves with ↑
/// and ↓, selects and reorders the way every Mac list does. Each list keeps the order the user
/// dragged it into; Move Up and Move Down in a row's menu do the same from the keyboard.
private struct Sidebar: View {
  let model: MenuModel
  @Bindable var navigation: AppNavigation

  var body: some View {
    let apps = model.apps
    let groups = model.groups
    List(selection: $navigation.selection) {
      Section("Libraries") {
        ForEach(model.libraries) { row in
          let failed = row.links.contains { $0.status == .failed }
          SidebarLabel(
            name: row.library.name, symbol: failed ? "exclamationmark.triangle.fill" : "shippingbox",
            tint: failed ? .red : nil, watched: row.library.isWatched, count: row.links.count, caption: caption(row))
            .tag(SidebarItem.library(row.library.name))
            .contextMenu {
              Button("Sync Now") { Task { await model.sync(row.library.name) } }
              Button("Show in Finder") { revealInFinder(row.library.root) }
              moveItems(.libraries, row.id, model.libraries.map(\.id))
            }
        }
        .onMove { model.move(.libraries, ids: model.libraries.map(\.id), from: $0, to: $1) }
        if model.libraries.isEmpty, model.connection == .online {
          Text("No libraries yet").foregroundStyle(DS.muted).selectionDisabled()
        }
      }
      if !apps.isEmpty {
        Section("Apps") {
          ForEach(apps) { app in
            SidebarLabel(
              name: app.name, symbol: app.hasFailedInstall ? "exclamationmark.triangle.fill" : "macwindow",
              tint: app.hasFailedInstall ? .red : nil, watched: false, count: app.linked.count, caption: caption(app))
              .tag(SidebarItem.app(app.root))
              .contextMenu {
                Button("Show in Finder") { revealInFinder(app.root) }
                Divider()
                Button("Hide App") { Task { await model.hideApp(app.root, navigation: navigation) } }
                  .disabled(!app.linked.isEmpty)
                moveItems(.apps, app.root, apps.map(\.root))
              }
          }
          .onMove { model.move(.apps, ids: apps.map(\.root), from: $0, to: $1) }
        }
      }
      if !groups.isEmpty {
        Section("Groups") {
          ForEach(groups) { group in
            SidebarLabel(
              name: group.name, symbol: "square.stack.3d.up", tint: nil, watched: false,
              count: group.consumers.count, caption: group.consumers.count == 1 ? "1 app" : "\(group.consumers.count) apps")
              .tag(SidebarItem.group(group.name))
              .contextMenu { moveItems(.groups, group.name, groups.map(\.name)) }
          }
          .onMove { model.move(.groups, ids: groups.map(\.name), from: $0, to: $1) }
        }
      }
    }
    .listStyle(.sidebar)
    .environment(\.sidebarRowSize, .small)
    .font(DS.body)
    .safeAreaBar(edge: .bottom, spacing: 0) { bottomBar }
    .background {
      // ⌥⌘↑ and ⌥⌘↓ move the selected row, as Move Up and Move Down in its menu do.
      Group {
        Button("Move Up") { moveSelection(up: true) }.keyboardShortcut(.upArrow, modifiers: [.command, .option])
        Button("Move Down") { moveSelection(up: false) }.keyboardShortcut(.downArrow, modifiers: [.command, .option])
      }
      .opacity(0)
      .frame(width: 0, height: 0)
      .accessibilityHidden(true)
    }
  }

  @ViewBuilder private func moveItems(_ kind: ItemOrder.Kind, _ id: String, _ ids: [String]) -> some View {
    if ids.count > 1, let index = ids.firstIndex(of: id) {
      Divider()
      Button("Move Up") { model.move(kind, ids: ids, from: IndexSet(integer: index), to: index - 1) }
        .keyboardShortcut(.upArrow, modifiers: [.command, .option])
        .disabled(index == 0)
      Button("Move Down") { model.move(kind, ids: ids, from: IndexSet(integer: index), to: index + 2) }
        .keyboardShortcut(.downArrow, modifiers: [.command, .option])
        .disabled(index == ids.count - 1)
    }
  }

  /// Moves the selected library, app or group one place within its own list.
  private func moveSelection(up: Bool) {
    let (kind, id, ids): (ItemOrder.Kind, String, [String])
    switch navigation.selection {
    case .library(let name)?: (kind, id, ids) = (.libraries, name, model.libraries.map(\.id))
    case .app(let root)?: (kind, id, ids) = (.apps, root, model.apps.map(\.root))
    case .group(let name)?: (kind, id, ids) = (.groups, name, model.groups.map(\.name))
    default: return
    }
    guard let index = ids.firstIndex(of: id), up ? index > 0 : index < ids.count - 1 else { return }
    model.move(kind, ids: ids, from: IndexSet(integer: index), to: up ? index - 1 : index + 2)
  }

  private var bottomBar: some View {
    VStack(alignment: .leading, spacing: 6) {
      if let activity = model.activity {
        HStack(spacing: 6) {
          ProgressView().controlSize(.mini)
          Text(activity).lineLimit(1).truncationMode(.middle)
        }
        .font(DS.caption)
        .foregroundStyle(DS.muted)
        .accessibilityElement(children: .combine)
      }
      HStack(spacing: 6) {
        Menu {
          Button("Add Library…") { Task { await model.chooseLibraryFolder(navigation: navigation) } }
          Button("Add App…") { Task { await model.chooseApp(navigation: navigation) } }
          Divider()
          Button("New Group…") { navigation.groupEditor = .new }
        } label: {
          Label("Add", systemImage: "plus")
        }
        .menuStyle(.button)
        .buttonStyle(.borderless)
        .menuIndicator(.hidden)
        .fixedSize()
        .disabled(model.connection != .online)
        .help("Add a library, an app or a group")
        Spacer()
        Button {
          navigation.selection = .settings
        } label: {
          Image(systemName: "gearshape")
        }
        .buttonStyle(.borderless)
        .foregroundStyle(navigation.selection == .settings ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.secondary))
        .help("Settings (⌘,)")
        .accessibilityLabel("Settings")
      }
    }
    .font(DS.body)
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
  }

  private func caption(_ row: LibraryRow) -> String {
    let apps = if row.links.contains(where: { $0.status == .failed }) {
      "Install failed"
    } else {
      switch row.links.count {
      case 0: "Not linked"
      case 1: "Linked to 1 app"
      default: "Linked to \(row.links.count) apps"
      }
    }
    return row.library.isWatched ? "\(apps) · Auto-sync on" : apps
  }

  private func caption(_ app: AppSummary) -> String {
    if app.hasFailedInstall { return "Install failed" }
    let linked = app.linked.map(\.library)
    if !linked.isEmpty { return "Dev build of " + linked.joined(separator: ", ") }
    return "Uses " + app.libraries.map(\.library).joined(separator: ", ")
  }
}

/// One sidebar row: symbol, name, an auto-sync mark, and how many apps it links as the row's badge.
private struct SidebarLabel: View {
  let name: String
  let symbol: String
  let tint: Color?
  let watched: Bool
  let count: Int
  let caption: String

  var body: some View {
    Label {
      HStack(spacing: 4) {
        Text(name).font(DS.body).lineLimit(1)
        if watched {
          Image(systemName: "arrow.clockwise").font(DS.caption).foregroundStyle(.secondary)
            .accessibilityHidden(true)
        }
      }
    } icon: {
      Image(systemName: symbol).foregroundStyle(tint.map(AnyShapeStyle.init) ?? AnyShapeStyle(.tint))
    }
    .badge(count)
    .help(caption)
    .accessibilityValue(caption)
  }
}

// MARK: Welcome

private struct WelcomeView: View {
  let model: MenuModel
  let navigation: AppNavigation

  var body: some View {
    welcome.toolbar(removing: .title)
  }

  private var welcome: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        Tile(symbol: "shippingbox", tint: .teal)
        Text("Test your library in your apps").font(DS.title).padding(.top, 10).padding(.bottom, 4)
        Text("dryfit publishes each change to a private registry on this Mac and installs it into your apps the way a release would. When you're done, it puts every app back exactly as it was.")
          .foregroundStyle(DS.muted)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.bottom, 12)
        Step(number: 1, title: "Tell dryfit where your apps live", detail: rootsDetail, done: !(model.roots ?? []).isEmpty) {
          Button("Add folders…") { Task { await model.chooseProjectFolders() } }.buttonStyle(.pill)
        }
        Step(
          number: 2, title: "Add a library you're working on",
          detail: "Choose its folder. dryfit works out how to build it.", done: !model.libraries.isEmpty
        ) {
          Button("Add library…") { Task { await model.chooseLibraryFolder(navigation: navigation) } }
            .buttonStyle(.primaryPill)
        }
        Step(
          number: 3, title: "Link it to an app",
          detail: "dryfit lists the apps that use your library under Apps. Link one, then sync, or turn on Auto-sync.",
          done: !(model.status?.links.isEmpty ?? true)
        ) {
          EmptyView()
        }
        if let error = model.actionError {
          ErrorBanner(message: error) { model.dismissActionError() }.padding(.top, 12)
        }
      }
      .font(DS.body)
      .frame(maxWidth: 560, alignment: .leading)
      .padding(.horizontal, 18)
      .padding(.top, 8)
      .padding(.bottom, 16)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private var rootsDetail: String {
    guard let roots = model.roots, !roots.isEmpty else {
      return "Choose the folders that hold your apps, so dryfit can find the ones that use your library."
    }
    return "Looking in " + roots.map(abbreviatedPath).joined(separator: ", ")
  }
}

private struct Step<Actions: View>: View {
  let number: Int
  let title: String
  let detail: String
  let done: Bool
  @ViewBuilder let actions: Actions

  var body: some View {
    VStack(spacing: 0) {
      Hairline()
      HStack(alignment: .top, spacing: 12) {
        ZStack {
          if done {
            Circle().fill(.green)
            Image(systemName: "checkmark").font(.system(size: 10, weight: .semibold)).foregroundStyle(.white)
          } else {
            Circle().strokeBorder(DS.strongBorder, lineWidth: 0.5)
            Text("\(number)").font(DS.caption).monospacedDigit()
          }
        }
        .frame(width: 22, height: 22)
        .accessibilityLabel(done ? "Done" : "Step \(number)")
        TwoLine(title: title, caption: detail, titleFont: DS.medium, wraps: true)
          .frame(maxWidth: .infinity, alignment: .leading)
        actions
      }
      .padding(.vertical, 10)
    }
  }
}

// MARK: Library

private struct LibraryDetail: View {
  let name: String
  let model: MenuModel
  let navigation: AppNavigation
  let actions: MenuActions
  @State private var confirmingRemoval = false
  @Environment(\.timeZone) private var timeZone

  var body: some View {
    if let row = model.libraries.first(where: { $0.id == name }) {
      content(row)
    }
  }

  private func content(_ row: LibraryRow) -> some View {
    let library = row.library
    let candidates = model.linkCandidates(for: name)
    let failed = row.links.filter { $0.status == .failed }
    return Page {
      AutoSyncToggle(isOn: Binding(
        get: { library.isWatched },
        set: { enabled in Task { await model.setWatch(name, enabled: enabled) } }))
        .disabled(model.isBusy(.watch(name)))
        .help(library.isWatched
          ? "Auto-sync is on: every change you save to \(name) is synced to its apps"
          : "Turn on to sync every change you save to \(name)")
      Button("Show in Finder", systemImage: "folder") { revealInFinder(library.root) }
        .help("Show \(name) in Finder")
      Button {
        Task { await model.sync(name) }
      } label: {
        Label("Sync now", systemImage: "arrow.clockwise")
          .symbolEffect(.rotate, options: .repeat(.continuous), isActive: model.isBusy(.sync(name)))
          .labelStyle(.titleAndIcon)
      }
      .allowsHitTesting(!model.isBusy(.sync(name)))
      .disabled(row.links.isEmpty)
      .help(row.links.isEmpty ? "Link an app first" : "Build, publish and install into every linked app")
    } content: {
      if let error = model.actionError {
        ErrorBanner(message: error) { model.dismissActionError() }.padding(.bottom, 12)
      }
      PageHeader(
        symbol: "shippingbox", tint: .teal, title: library.name,
        subtitle: library.published(timeZone: timeZone).replacingOccurrences(of: " · dev ", with: " · dev build ")
          + (library.isWatched ? " · Auto-sync on" : ""))

      // What needs attention first: a failed install, above the list it belongs to.
      ForEach(failed) { link in
        InstallFailedCallout(link: link, model: model, actions: actions).padding(.top, 14)
      }

      SectionLabel("Linked apps")
      HairlineGroup {
        if row.links.isEmpty {
          GroupRow {
            Text("No app is linked yet. Link one below to install the dev build.").foregroundStyle(DS.muted)
          }
        }
        ForEach(row.links) { link in AppRow(link: link, model: model, actions: actions) }
      }

      HStack(alignment: .lastTextBaseline) {
        SectionLabel("Apps that use \(name)")
        Spacer()
        Button("Look again") { Task { await model.discoverConsumers() } }
          .buttonStyle(.borderless).controlSize(.small).font(DS.caption)
          .disabled(model.isBusy(.discover))
          .padding(.bottom, 4)
      }
      HairlineGroup {
        if candidates.isEmpty {
          GroupRow {
            Text(model.isBusy(.discover) ? "Looking for apps…" : "No other app in your project folders uses \(name).")
              .foregroundStyle(DS.muted)
          }
        }
        ForEach(candidates) { consumer in
          SuggestedAppRow(library: name, consumer: consumer, model: model)
        }
        GroupRow {
          Text("Not listed?").foregroundStyle(DS.muted)
          Spacer()
          Button("Choose app…") { Task { await model.chooseAppAndLink(name) } }.buttonStyle(.pill)
        }
      }

      // Set once, rarely changed: one quiet line, not a section of its own.
      SectionLabel("Build")
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        VStack(alignment: .leading, spacing: 2) {
          if let build = library.build.map({ BuildCommand(command: $0.command, args: $0.args).line }) {
            Text(build).font(DS.mono).lineLimit(1).truncationMode(.middle).textSelection(.enabled).help(build)
          } else {
            Text("No build step")
          }
          Text("Publishes \(publishFolder(library)) · in \(abbreviatedPath(library.root))")
            .font(DS.caption).foregroundStyle(DS.muted).lineLimit(1).truncationMode(.head)
        }
        Spacer(minLength: 8)
        Button("Change…") { navigation.libraryEditor = LibraryEditorRequest(root: library.root) }.buttonStyle(.pill)
      }

      Divider().padding(.top, 18).padding(.bottom, 10)
      HStack(spacing: 8) {
        Button("Remove from dryfit…", role: .destructive) { confirmingRemoval = true }
          .buttonStyle(.borderless)
          .foregroundStyle(row.links.isEmpty ? .red : DS.muted)
          .disabled(!row.links.isEmpty || model.isBusy(.unregister(name)))
        Text(row.links.isEmpty ? "Your library's files are not touched." : "Restore its linked apps first.")
          .font(DS.caption).foregroundStyle(DS.muted)
      }
    }
    .confirmationDialog("Remove \(name) from dryfit?", isPresented: $confirmingRemoval) {
      Button("Remove", role: .destructive) {
        Task {
          await model.unregister(name)
          if model.actionError == nil { navigation.selection = nil }
        }
      }
    } message: {
      Text("Its dev builds stay in dryfit's registry until they are replaced. Your library's files are not touched.")
    }
  }

  /// "dist/ui" when the publish folder is inside the library, the full path otherwise.
  private func publishFolder(_ library: Library) -> String {
    let root = library.root.hasSuffix("/") ? library.root : library.root + "/"
    if library.publishDir == library.root { return "The library's folder" }
    return library.publishDir.hasPrefix(root) ? String(library.publishDir.dropFirst(root.count)) : abbreviatedPath(library.publishDir)
  }
}

/// The switch for auto-sync with its name beside it, for the toolbar.
struct AutoSyncToggle: View {
  @Binding var isOn: Bool

  var body: some View {
    HStack(spacing: 6) {
      Text("Auto-sync").font(DS.body).accessibilityHidden(true)
      Toggle("Auto-sync", isOn: $isOn).toggleStyle(.switch).controlSize(.mini).labelsHidden()
    }
    .padding(.leading, 8)
    .fixedSize()
  }
}

/// A failed install, with its first line of output and the two ways on: read it, or put the app back.
private struct InstallFailedCallout: View {
  let link: DryfitAPI.Link
  let model: MenuModel
  let actions: MenuActions

  var body: some View {
    let failure = model.installFailure(in: link.consumer)
    HStack(alignment: .top, spacing: 8) {
      Image(systemName: "xmark.octagon.fill").foregroundStyle(.red).accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 2) {
        Text("Install into \(projectName(link.consumer)) failed").font(DS.medium)
        if let line = failure?.detail.split(whereSeparator: \.isNewline).first {
          Text(line).font(DS.mono).foregroundStyle(DS.muted).lineLimit(1).truncationMode(.tail)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      if let failure {
        Button("Show output") { actions.showFailures(failure.id) }.buttonStyle(.pill)
      }
      Button("Restore") { Task { await model.restore(link.consumer, library: link.library) } }
        .buttonStyle(.pill(busy: model.isBusy(.restore(link.consumer, link.library))))
        .disabled(!model.isBusy(.restore(link.consumer, link.library)) && model.isRestoring(link.consumer))
        .help("Put \(projectName(link.consumer)) back on the release of \(link.library)")
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 8)
    .background(Color.red.opacity(0.12), in: .rect(cornerRadius: DS.radius))
    .overlay { RoundedRectangle(cornerRadius: DS.radius).strokeBorder(Color.red.opacity(0.35), lineWidth: 1) }
  }
}

/// An app linked to a library: what it runs, and a way back to the release.
private struct AppRow: View {
  let link: DryfitAPI.Link
  let model: MenuModel
  let actions: MenuActions
  @Environment(\.timeZone) private var timeZone

  var body: some View {
    GroupRow {
      Image(systemName: link.status == .failed ? "xmark.circle" : link.status == .pending ? "clock" : "checkmark.circle")
        .foregroundStyle(link.tint)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 1) {
        NameAndBadge(name: projectName(link.consumer), badge: packageManager)
        if link.status == .failed, let failure = model.installFailure(in: link.consumer) {
          Button("Install failed · Show output") { actions.showFailures(failure.id) }
            .buttonStyle(.plain)
            .font(DS.caption)
            .foregroundStyle(.red)
        } else {
          Text(detail)
            .font(DS.caption)
            .foregroundStyle(link.status == .failed ? AnyShapeStyle(.red) : AnyShapeStyle(DS.muted))
            .lineLimit(1)
        }
      }
      Spacer(minLength: 8)
      // Always at full strength: dimmed until hovered, it read as disabled and keyboard users never saw it.
      Button("Restore") { Task { await model.restore(link.consumer, library: link.library) } }
        .buttonStyle(.pill(busy: busy))
        .disabled(!busy && model.isRestoring(link.consumer))
        .help("Put \(projectName(link.consumer)) back on the release of \(link.library)")
    }
    .contentShape(.rect)
    .help(abbreviatedPath(link.consumer))
    .contextMenu {
      Button("Show in Finder") { revealInFinder(link.consumer) }
    }
  }

  private var busy: Bool { model.isBusy(.restore(link.consumer, link.library)) }

  private var detail: String {
    let described = link.detail(timeZone: timeZone)
    return link.status == .installed && link.guarded == true ? described + " · commit guard on" : described
  }

  private var packageManager: String? {
    model.consumers.first { $0.root == link.consumer }?.packageManager.name
  }
}

/// An app that uses the library and is not linked to it yet, with a one-click Link.
private struct SuggestedAppRow: View {
  let library: String
  let consumer: DiscoveredConsumer
  let model: MenuModel

  var body: some View {
    GroupRow {
      Image(systemName: "macwindow").foregroundStyle(DS.muted).accessibilityHidden(true)
      TwoLineView(
        title: NameAndBadge(name: projectName(consumer.root), badge: consumer.packageManager.name),
        caption: consumer.libraries.first(where: { $0.name == library }).map { describeDependency($0.range) }
          ?? abbreviatedPath(consumer.root))
      Spacer(minLength: 8)
      Button("Link") { Task { await model.link(library, into: consumer.root) } }
        .buttonStyle(.accentPill(busy: model.isBusy(.link(library, consumer.root))))
        .help("Install the dev build of \(library) into \(projectName(consumer.root))")
    }
    .help(abbreviatedPath(consumer.root))
    .contextMenu {
      Button("Show in Finder") { revealInFinder(consumer.root) }
    }
  }
}

// MARK: Group

private struct GroupDetail: View {
  let name: String
  let model: MenuModel
  let navigation: AppNavigation
  @State private var confirmingDeletion = false
  @Environment(\.timeZone) private var timeZone

  var body: some View {
    if let group = model.status?.groups.first(where: { $0.name == name }) {
      content(group)
    }
  }

  private func content(_ group: DryfitAPI.Group) -> some View {
    Page {
      Button {
        Task { await model.restoreGroup(name) }
      } label: {
        Label("Restore all", systemImage: "arrow.uturn.backward").labelStyle(.titleAndIcon)
      }
      .disabled(model.isBusy(.restoreGroup(name)))
      .help("Put every app in \(name) back on released versions")
      Menu {
        ForEach(model.status?.libraries ?? []) { library in
          Button(library.name) { Task { await model.linkGroup(name, library: library.name) } }
        }
      } label: {
        Label("Link library", systemImage: "link.badge.plus").labelStyle(.titleAndIcon)
      }
      .disabled(model.status?.libraries.isEmpty ?? true || model.isBusy(.linkGroup(name)))
      .help("Link a library into every app in \(name)")
    } content: {
      if let error = model.actionError {
        ErrorBanner(message: error) { model.dismissActionError() }.padding(.bottom, 12)
      }
      PageHeader(
        symbol: "square.stack.3d.up", tint: .purple, title: group.name,
        subtitle: "Link a library into all of these apps at once, and restore them together.")
      SectionLabel("Apps")
      HairlineGroup {
        ForEach(group.consumers, id: \.self) { consumer in
          GroupRow {
            TwoLine(title: projectName(consumer), caption: abbreviatedPath(consumer)).layoutPriority(1)
            Spacer(minLength: 8)
            Text(linked(consumer)).foregroundStyle(DS.muted).lineLimit(1)
          }
        }
        GroupRow {
          Spacer()
          Button("Edit…") { navigation.groupEditor = .edit(group) }.buttonStyle(.pill)
        }
      }
      if let warnings = model.status?.warnings.filter({ $0.group == name }), !warnings.isEmpty {
        HairlineGroup(border: .orange.opacity(0.5)) {
          ForEach(Array(warnings.enumerated()), id: \.offset) { _, warning in
            GroupRow {
              Image(systemName: "exclamationmark.triangle").foregroundStyle(.orange).accessibilityHidden(true)
              Text(
                "\(warning.library) differs: "
                  + warning.versions
                  .map { "\(projectName($0.consumer)) \(DevVersion.describe($0.version, timeZone: timeZone))" }
                  .joined(separator: ", "))
                .fixedSize(horizontal: false, vertical: true)
            }
          }
        }
        .padding(.top, 12)
      }
      Divider().padding(.top, 18).padding(.bottom, 10)
      HStack(spacing: 8) {
        Button("Delete group…", role: .destructive) { confirmingDeletion = true }
          .buttonStyle(.borderless)
          .foregroundStyle(.red)
          .disabled(model.isBusy(.deleteGroup(name)))
        Text("Its apps stay as they are.").font(DS.caption).foregroundStyle(DS.muted)
      }
    }
    .confirmationDialog("Delete the group \(name)?", isPresented: $confirmingDeletion) {
      Button("Delete", role: .destructive) {
        Task {
          await model.deleteGroup(name)
          // Stay on the page when it failed, so its banner says why, as Remove does.
          if model.actionError == nil { navigation.selection = nil }
        }
      }
    } message: {
      Text("Its apps stay linked or restored as they are now.")
    }
  }

  private func linked(_ consumer: String) -> String {
    let links = model.status?.links.filter { $0.consumer == consumer } ?? []
    guard !links.isEmpty else { return "Released versions" }
    return "Dev build of " + links.map(\.library).joined(separator: ", ")
  }
}
