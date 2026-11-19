import DryfitAPI
import SwiftUI

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
        .navigationSplitViewColumnWidth(min: 200, ideal: 230, max: 320)
    } detail: {
      // The minimum size goes on the detail column, not the split view: on the split view it makes
      // the toolbar lag behind the sidebar while it opens, pushing the sidebar button into overflow.
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
      Button("Restore Anyway", role: .destructive) {
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
      model.open(folder.path(percentEncoded: false), navigation: navigation, orAddAsLibrary: true)
      return true
    }
    .showsInDock()
  }

  @ViewBuilder private var detail: some View {
    switch model.connection {
    case .online:
      switch navigation.selection {
      case .library(let name) where model.libraries.contains { $0.id == name }:
        LibraryDetail(name: name, model: model, navigation: navigation, actions: actions)
      case .app(let root) where model.apps.contains { $0.root == root }:
        AppDetail(root: root, model: model, actions: actions)
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

private struct Sidebar: View {
  let model: MenuModel
  @Bindable var navigation: AppNavigation
  @Environment(\.timeZone) private var timeZone

  var body: some View {
    List(selection: $navigation.selection) {
      Section("Libraries") {
        ForEach(model.libraries) { row in
          // One line per row, the system's own height: the details are in the badge (apps linked)
          // and the tooltip, so a long list stays scannable.
          Label {
            HStack(spacing: 4) {
              Text(row.library.name).lineLimit(1)
              if row.library.isWatched {
                Image(systemName: "arrow.triangle.2.circlepath")
                  .font(.caption2)
                  .foregroundStyle(.secondary)
                  .accessibilityLabel("Auto-sync on")
              }
            }
          } icon: {
            Image(systemName: row.links.contains { $0.status == .failed } ? "exclamationmark.triangle.fill" : "shippingbox")
              .foregroundStyle(row.links.contains { $0.status == .failed } ? .red : .teal)
          }
          .badge(row.links.count)
          .help(caption(row))
          .tag(SidebarItem.library(row.library.name))
          .contextMenu {
            Button("Sync Now") { Task { await model.sync(row.library.name) } }
            Button("Show in Finder") { revealInFinder(row.library.root) }
          }
        }
        if model.libraries.isEmpty, model.connection == .online {
          Text("No libraries yet").foregroundStyle(.tertiary)
        }
      }
      let apps = model.apps
      if !apps.isEmpty {
        Section("Apps") {
          ForEach(apps) { app in
            Label {
              Text(app.name).lineLimit(1)
            } icon: {
              Image(systemName: app.hasFailedInstall ? "exclamationmark.triangle.fill" : "macwindow")
                .foregroundStyle(app.hasFailedInstall ? Color.red : app.linked.isEmpty ? Color.secondary : Color.devBuild)
            }
            .badge(app.linked.count)
            .help(caption(app))
            .tag(SidebarItem.app(app.root))
            .contextMenu {
              Button("Show in Finder") { revealInFinder(app.root) }
            }
          }
        }
      }
      if let groups = model.status?.groups, !groups.isEmpty {
        Section("Groups") {
          ForEach(groups) { group in
            Label(group.name, systemImage: "square.stack.3d.up")
              .badge(group.consumers.count)
              .help(group.consumers.count == 1 ? "1 app" : "\(group.consumers.count) apps")
              .tag(SidebarItem.group(group.name))
          }
        }
      }
    }
    .listStyle(.sidebar)
    // In the sidebar's own bar, not the toolbar: a toolbar item there sits beside the sidebar
    // button and jumps about whenever the sidebar is hidden or shown.
    .safeAreaInset(edge: .bottom, spacing: 0) {
      HStack {
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
      }
      .padding(.horizontal, 14)
      .padding(.vertical, 10)
    }
  }

  private func caption(_ row: LibraryRow) -> String {
    let apps = switch row.links.count {
    case 0: "Not linked"
    case 1: "Linked to 1 app"
    default: "Linked to \(row.links.count) apps"
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

// MARK: Welcome

private struct WelcomeView: View {
  let model: MenuModel
  let navigation: AppNavigation

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 28) {
        VStack(alignment: .leading, spacing: 8) {
          Tile(symbol: "shippingbox", tint: .teal, size: 56)
          Text("Test your library in your apps").font(.largeTitle.bold()).padding(.top, 6)
          Text("dryfit publishes each change to a private registry on this Mac and installs it into your apps the way a release would. When you are done, it puts every app back exactly as it was.")
            .font(.title3)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
        VStack(alignment: .leading, spacing: 18) {
          Step(
            number: 1, title: "Tell dryfit where your apps live",
            detail: rootsDetail, done: !(model.roots ?? []).isEmpty
          ) {
            Button(model.roots?.isEmpty == false ? "Add Folders…" : "Choose Folders…") {
              Task { await model.chooseProjectFolders() }
            }
          }
          Step(
            number: 2, title: "Add a library you are working on",
            detail: "Choose its folder. dryfit works out how to build it.",
            done: !model.libraries.isEmpty
          ) {
            Button("Add Library…") { Task { await model.chooseLibraryFolder(navigation: navigation) } }
              .buttonStyle(.borderedProminent)
          }
          Step(
            number: 3, title: "Link it to an app",
            detail: "dryfit lists the apps that use your library under Apps. Link one, then sync, or turn on Auto-sync to sync every change you save.",
            done: !(model.status?.links.isEmpty ?? true)
          ) {
            EmptyView()
          }
        }
        if let error = model.actionError {
          ErrorBanner(message: error) { model.dismissActionError() }
        }
      }
      .frame(maxWidth: 560, alignment: .leading)
      .padding(40)
      .frame(maxWidth: .infinity)
    }
    .navigationTitle("dryfit")
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
    HStack(alignment: .top, spacing: 14) {
      ZStack {
        Circle().fill(done ? AnyShapeStyle(.green) : AnyShapeStyle(.quaternary))
        if done {
          Image(systemName: "checkmark").font(.caption.bold()).foregroundStyle(.white)
        } else {
          Text("\(number)").font(.callout.weight(.semibold).monospacedDigit())
        }
      }
      .frame(width: 26, height: 26)
      .accessibilityLabel(done ? "Done" : "Step \(number)")
      VStack(alignment: .leading, spacing: 4) {
        Text(title).font(.headline)
        Text(detail).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        actions.padding(.top, 4)
      }
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
    return Form {
      if let error = model.actionError {
        ErrorBanner(message: error) { model.dismissActionError() }
          .listRowInsets(EdgeInsets())
          .listRowBackground(Color.clear)
      }
      Section {
        HStack(spacing: 14) {
          Tile(symbol: "shippingbox", tint: .teal, size: 48)
          VStack(alignment: .leading, spacing: 2) {
            Text(library.name).font(.title2.bold()).textSelection(.enabled)
            Text(library.published(timeZone: timeZone) + (library.isWatched ? " · Auto-sync on" : ""))
              .foregroundStyle(.secondary)
          }
        }
        .padding(.vertical, 4)
      }

      Section {
        if row.links.isEmpty {
          Text("No app is linked yet. Link one below to install the dev build.")
            .foregroundStyle(.secondary)
        }
        ForEach(row.links) { link in AppRow(link: link, model: model, actions: actions) }
      } header: {
        Text("Linked apps")
      }

      Section {
        let candidates = model.linkCandidates(for: name)
        if candidates.isEmpty {
          Text(model.isBusy(.discover) ? "Looking for apps…" : "No other app in your project folders uses \(name).")
            .foregroundStyle(.secondary)
        }
        ForEach(candidates) { consumer in
          SuggestedAppRow(library: name, consumer: consumer, model: model)
        }
        HStack {
          Button("Look Again") { Task { await model.discoverConsumers() } }
            .disabled(model.isBusy(.discover))
          Spacer()
          Button("Choose App…") { Task { await model.chooseAppAndLink(name) } }
        }
      } header: {
        Text("Apps that use \(name)")
      } footer: {
        Text("Found in your project folders. You can change those in Settings.")
      }

      Section("Build") {
        LabeledContent("Folder") { PathText(path: library.root) }
        LabeledContent("Build command") {
          Text(library.build.map { BuildCommand(command: $0.command, args: $0.args).line } ?? "None")
            .font(.body.monospaced())
            .foregroundStyle(library.build == nil ? .secondary : .primary)
            .textSelection(.enabled)
        }
        LabeledContent("Publish folder") { PathText(path: library.publishDir) }
        HStack {
          Spacer()
          Button("Change…") { navigation.libraryEditor = LibraryEditorRequest(root: library.root) }
        }
      }

      Section {
        HStack {
          VStack(alignment: .leading, spacing: 2) {
            Text("Remove from dryfit")
            Text(row.links.isEmpty ? "Your library's files are not touched." : "Restore its apps first.")
              .font(.caption)
              .foregroundStyle(.secondary)
          }
          Spacer()
          Button("Remove…", role: .destructive) { confirmingRemoval = true }
            .disabled(!row.links.isEmpty || model.isBusy(.unregister(name)))
        }
      }
    }
    .formStyle(.grouped)
    .navigationTitle(library.name)
    .navigationSubtitle(abbreviatedPath(library.root))
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
    .toolbar {
      ToolbarItem {
        AutoSyncSwitch(library: library, model: model)
      }
      ToolbarSpacer(.fixed)
      ToolbarItem {
        // The label stays put while syncing (its symbol spins), so the toolbar does not reflow.
        Button {
          Task { await model.sync(name) }
        } label: {
          Label("Sync Now", systemImage: "arrow.triangle.2.circlepath")
            .symbolEffect(.rotate, options: .repeat(.continuous), isActive: model.isBusy(.sync(name)))
        }
        .labelStyle(.titleAndIcon)
        .buttonStyle(.glassProminent)
        .disabled(model.isBusy(.sync(name)) || row.links.isEmpty)
        .help(row.links.isEmpty ? "Link an app first" : "Build, publish and install into every linked app")
      }
    }
  }
}

/// An app linked to a library: where it is, what it runs, and a way back to the release.
private struct AppRow: View {
  let link: DryfitAPI.Link
  let model: MenuModel
  let actions: MenuActions
  @Environment(\.timeZone) private var timeZone

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: link.symbol).foregroundStyle(link.tint).frame(width: 18)
      VStack(alignment: .leading, spacing: 1) {
        HStack(spacing: 6) {
          Text(projectName(link.consumer))
          if let manager = packageManager { Badge(text: manager) }
        }
        Text(abbreviatedPath(link.consumer)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
      }
      Spacer()
      if link.status == .failed, let failure = model.installFailure(in: link.consumer) {
        Button("Install failed") { actions.showFailures(failure.id) }
          .buttonStyle(.link)
          .foregroundStyle(.red)
          .help("Show the install's output")
      } else {
        Text(link.detail(timeZone: timeZone))
          .font(.callout)
          .foregroundStyle(link.status == .failed ? .red : .secondary)
      }
      Button("Restore") { Task { await model.restore(link.consumer, library: link.library) } }
        .controlSize(.small)
        .disabled(model.isBusy(.restore(link.consumer, link.library)))
        .help("Put \(projectName(link.consumer)) back on the release of \(link.library)")
    }
    .contextMenu {
      Button("Show in Finder") { revealInFinder(link.consumer) }
    }
  }

  private var packageManager: String? {
    model.consumers.first { $0.root == link.consumer }?.packageManager.name
  }
}

/// The Auto-sync switch, with its name beside it: when on, every change saved in the library is
/// built and installed into its linked apps.
struct AutoSyncSwitch: View {
  let library: Library
  let model: MenuModel

  var body: some View {
    // A toolbar hides a toggle's own label, so the name is a separate Text beside the switch.
    HStack(spacing: 8) {
      Text("Auto-sync").accessibilityHidden(true)
      Toggle("Auto-sync", isOn: Binding(
        get: { library.isWatched },
        set: { enabled in Task { await model.setWatch(library.name, enabled: enabled) } }))
        .toggleStyle(.switch)
        .controlSize(.small)
        .labelsHidden()
    }
    .padding(.leading, 10)
    .padding(.trailing, 4)
    .disabled(model.isBusy(.watch(library.name)))
    .help(library.isWatched
      ? "Auto-sync is on: every change you save to \(library.name) is synced to its apps"
      : "Turn on to sync every change you save to \(library.name)")
  }
}

/// An app that uses the library and is not linked to it yet, with a one-click Link.
private struct SuggestedAppRow: View {
  let library: String
  let consumer: DiscoveredConsumer
  let model: MenuModel

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: "macwindow").foregroundStyle(.secondary).frame(width: 18)
      VStack(alignment: .leading, spacing: 1) {
        HStack(spacing: 6) {
          Text(projectName(consumer.root))
          if let manager = consumer.packageManager.name { Badge(text: manager) }
        }
        Text(abbreviatedPath(consumer.root)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
      }
      Spacer()
      if let range = consumer.libraries.first(where: { $0.name == library })?.range {
        Text(range).font(.callout.monospacedDigit()).foregroundStyle(.secondary)
      }
      Button("Link") { Task { await model.link(library, into: consumer.root) } }
        .controlSize(.small)
        .disabled(model.isBusy(.link(library, consumer.root)))
        .help("Install the dev build of \(library) into \(projectName(consumer.root))")
    }
    .contextMenu {
      Button("Show in Finder") { revealInFinder(consumer.root) }
    }
  }
}

private struct PathText: View {
  let path: String

  var body: some View {
    HStack(spacing: 4) {
      Text(abbreviatedPath(path)).lineLimit(1).truncationMode(.head).textSelection(.enabled)
      Button("Show in Finder", systemImage: "arrow.right.circle.fill") { revealInFinder(path) }
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
        .foregroundStyle(.secondary)
        .help("Show in Finder")
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
    Form {
      if let error = model.actionError {
        ErrorBanner(message: error) { model.dismissActionError() }
          .listRowInsets(EdgeInsets())
          .listRowBackground(Color.clear)
      }
      Section {
        HStack(spacing: 14) {
          Tile(symbol: "square.stack.3d.up", tint: .indigo, size: 48)
          VStack(alignment: .leading, spacing: 2) {
            Text(group.name).font(.title2.bold())
            Text("Link a library into all of these apps at once, and restore them together.")
              .foregroundStyle(.secondary)
          }
        }
        .padding(.vertical, 4)
      }
      Section("Apps") {
        ForEach(group.consumers, id: \.self) { consumer in
          HStack {
            VStack(alignment: .leading, spacing: 1) {
              Text(projectName(consumer))
              Text(abbreviatedPath(consumer)).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Text(linked(consumer)).font(.callout).foregroundStyle(.secondary)
          }
        }
        HStack {
          Spacer()
          Button("Edit…") { navigation.groupEditor = .edit(group) }
        }
      }
      if let warnings = model.status?.warnings.filter({ $0.group == name }), !warnings.isEmpty {
        Section {
          ForEach(Array(warnings.enumerated()), id: \.offset) { _, warning in
            Label(
              "These apps run different builds of \(warning.library). Sync it, or restore the group.",
              systemImage: "exclamationmark.triangle.fill")
          }
        }
      }
      Section {
        HStack {
          Text("Delete group")
          Spacer()
          Button("Delete…", role: .destructive) { confirmingDeletion = true }
        }
      } footer: {
        Text("Deleting the group leaves its apps as they are.")
      }
    }
    .formStyle(.grouped)
    .navigationTitle(group.name)
    .navigationSubtitle(group.consumers.count == 1 ? "1 app" : "\(group.consumers.count) apps")
    .confirmationDialog("Delete the group \(name)?", isPresented: $confirmingDeletion) {
      Button("Delete", role: .destructive) {
        Task {
          await model.deleteGroup(name)
          navigation.selection = nil
        }
      }
    } message: {
      Text("Its apps stay linked or restored as they are now.")
    }
    .toolbar {
      ToolbarItem {
        Button {
          Task { await model.restoreGroup(name) }
        } label: {
          Label("Restore All", systemImage: "arrow.uturn.backward")
        }
        .labelStyle(.titleAndIcon)
        .disabled(model.isBusy(.restoreGroup(name)))
        .help("Put every app in \(name) back on released versions")
      }
      ToolbarSpacer(.fixed)
      ToolbarItem {
        Menu {
          ForEach(model.status?.libraries ?? []) { library in
            Button(library.name) { Task { await model.linkGroup(name, library: library.name) } }
          }
        } label: {
          Label("Link Library", systemImage: "link.badge.plus")
        }
        .labelStyle(.titleAndIcon)
        .buttonStyle(.glassProminent)
        .disabled(model.isBusy(.linkGroup(name)) || (model.status?.libraries.isEmpty ?? true))
        .help("Link a library into every app in \(name)")
      }
    }
  }

  private func linked(_ consumer: String) -> String {
    let links = model.status?.links.filter { $0.consumer == consumer } ?? []
    guard !links.isEmpty else { return "Released versions" }
    return links.map { "\($0.library) \($0.detail(timeZone: timeZone))" }.joined(separator: ", ")
  }
}
