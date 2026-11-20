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
        // No toolbar at all (the window's title bar is hidden too): each page carries its own controls
        // along its top, and the sidebar is shown and hidden from the View menu (⌃⌘S).
        .toolbar(removing: .sidebarToggle)
        .navigationSplitViewColumnWidth(min: 170, ideal: 190, max: 300)
    } detail: {
      // The minimum size goes on the detail column, not the split view: on the split view it makes
      // the toolbar lag behind the sidebar while it opens, pushing the sidebar button into overflow.
      // Up into the title bar: a page's own controls sit level with the window's buttons.
      detail.frame(minWidth: 480, minHeight: 460).ignoresSafeArea(.container, edges: .top)
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

/// The sidebar: libraries, apps and groups, each list in the order the user dragged it into. Drawn
/// to the app's own measurements rather than as a system list: 11 pt section names, rows 4 by 10 pt
/// inside a 6 pt rounded rectangle, and an accent wash for the one that is open.
///
/// It does what the system list did for the keyboard too: ↑ and ↓ move through every row, and ⌥⌘↑
/// and ⌥⌘↓ move the open row within its list, as Move up and Move down in its menu also do.
private struct Sidebar: View {
  let model: MenuModel
  @Bindable var navigation: AppNavigation
  @FocusState private var focused: Bool
  @State private var dragging: String?

  var body: some View {
    let apps = model.apps
    let groups = model.groups
    let rows = SidebarRows(model: model, apps: apps, groups: groups)
    ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          SidebarHeader(title: "Libraries")
          ForEach(model.libraries) { row in
            let failed = row.links.contains { $0.status == .failed }
            let item = SidebarItem.library(row.library.name)
            SidebarRow(
              item: item, navigation: navigation, focused: focused,
              symbol: failed ? "exclamationmark.triangle" : "shippingbox", symbolTint: failed ? .red : nil,
              name: row.library.name, caption: caption(row), watched: row.library.isWatched, count: row.links.count,
              reorder: rows.reorder(item)!, select: select, dragging: $dragging
            ) {
              Button("Sync now") { Task { await model.sync(row.library.name) } }
              Button("Show in Finder") { revealInFinder(row.library.root) }
            }
          }
          if model.libraries.isEmpty, model.connection == .online {
            Text("No libraries yet").foregroundStyle(DS.muted).padding(.horizontal, 14).padding(.vertical, 4)
          }
          if !apps.isEmpty {
            SidebarHeader(title: "Apps")
            ForEach(apps) { app in
              let item = SidebarItem.app(app.root)
              SidebarRow(
                item: item, navigation: navigation, focused: focused,
                symbol: app.hasFailedInstall ? "exclamationmark.triangle" : "macwindow",
                symbolTint: app.hasFailedInstall ? .red : app.linked.isEmpty ? DS.muted : nil,
                name: app.name, caption: caption(app), watched: false, count: app.linked.count,
                reorder: rows.reorder(item)!, select: select, dragging: $dragging
              ) {
                Button("Show in Finder") { revealInFinder(app.root) }
                Divider()
                // Linked apps stay listed: hidden, they could only be restored from the command line.
                Button("Hide app") { Task { await model.hideApp(app.root, navigation: navigation) } }
                  .disabled(!app.linked.isEmpty)
              }
            }
          }
          if !groups.isEmpty {
            SidebarHeader(title: "Groups")
            ForEach(groups) { group in
              let item = SidebarItem.group(group.name)
              SidebarRow(
                item: item, navigation: navigation, focused: focused, symbol: "square.stack.3d.up", symbolTint: nil,
                name: group.name, caption: group.consumers.count == 1 ? "1 app" : "\(group.consumers.count) apps",
                watched: false, count: group.consumers.count, reorder: rows.reorder(item)!, select: select, dragging: $dragging
              ) {
                EmptyView()
              }
            }
          }
          if rows.items.count > 1 {
            Text("Drag rows to reorder")
              .font(DS.caption)
              .foregroundStyle(DS.muted)
              .padding(.horizontal, 12)
              .padding(.vertical, 6)
          }
        }
        .font(DS.body)
        .frame(maxWidth: .infinity, alignment: .leading)
        // Below the window's buttons, which sit over the sidebar now that the window has no toolbar.
        .padding(.top, 30)
        .padding(.bottom, 8)
      }
      .ignoresSafeArea(.container, edges: .top)
      // In the sidebar's own bar, not the toolbar, so it stays put when the sidebar is hidden or shown.
      // A bar rather than an inset, so the rows that run on beneath it fall under the scroll edge effect.
      .scrollEdgeEffectStyle(.hard, for: .bottom)
      .safeAreaBar(edge: .bottom, spacing: 0) { bottomBar }
      .focusable()
      .focused($focused)
      // The open row shows focus itself, in a stronger wash, as a focused system list does.
      .focusEffectDisabled()
      .onKeyPress(keys: [.upArrow, .downArrow]) { press in
        let up = press.key == .upArrow
        // Arrow keys carry the keypad flag; any other modifier is someone else's shortcut.
        let modifiers = press.modifiers.subtracting([.numericPad, .capsLock])
        if modifiers == [.command, .option] {
          guard let item = navigation.selection, let reorder = rows.reorder(item) else { return .ignored }
          reorder.move(by: up ? -1 : 1)
        } else if modifiers.isEmpty {
          navigation.selection = rows.step(from: navigation.selection, by: up ? -1 : 1)
        } else {
          return .ignored
        }
        return .handled
      }
      .onChange(of: navigation.selection) { _, item in
        guard let item, rows.items.contains(item) else { return }
        withAnimation(.snappy(duration: 0.2)) { proxy.scrollTo(item) }
      }
    }
  }

  /// A click opens the row and gives the sidebar the keyboard, so the arrows work straight after.
  private func select(_ item: SidebarItem) {
    navigation.selection = item
    focused = true
  }

  private var bottomBar: some View {
    VStack(spacing: 0) {
      Hairline()
      // What dryfit is doing, as the menu's footer shows it: Auto-sync runs start without a click.
      if let activity = model.activity {
        HStack(spacing: 6) {
          ProgressView().controlSize(.mini)
          Text(activity).lineLimit(1).truncationMode(.middle)
        }
        .font(DS.caption)
        .foregroundStyle(DS.muted)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.top, 7)
        .accessibilityElement(children: .combine)
      }
      HStack(spacing: 6) {
        Menu {
          Button("Add library…") { Task { await model.chooseLibraryFolder(navigation: navigation) } }
          Button("Add app…") { Task { await model.chooseApp(navigation: navigation) } }
          Divider()
          Button("New group…") { navigation.groupEditor = .new }
        } label: {
          HStack(spacing: 4) {
            Image(systemName: "plus")
            Text("Add")
          }
          .font(DS.body)
          .foregroundStyle(DS.muted)
          .contentShape(.rect)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .disabled(model.connection != .online)
        .help("Add a library, an app or a group")
        Spacer()
        let settings = navigation.selection == .settings
        Button {
          navigation.selection = .settings
        } label: {
          Image(systemName: "gearshape")
            .font(DS.body)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .foregroundStyle(settings ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(DS.muted))
            .background(settings ? DS.accentTint : .clear, in: .rect(cornerRadius: DS.radius))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .help("Settings (⌘,)")
        .accessibilityLabel("Settings")
        .accessibilityAddTraits(settings ? .isSelected : [])
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 8)
    }
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

/// Every row in the order the sidebar shows them, and where each sits in its own list.
private struct SidebarRows {
  let model: MenuModel
  let apps: [AppSummary]
  let groups: [DryfitAPI.Group]

  var items: [SidebarItem] {
    model.libraries.map { .library($0.id) } + apps.map { .app($0.root) } + groups.map { .group($0.name) }
  }

  /// The row `by` rows after `item`, or the first or last row when nothing in the list is open.
  func step(from item: SidebarItem?, by offset: Int) -> SidebarItem? {
    let items = items
    guard let item, let index = items.firstIndex(of: item) else {
      return offset > 0 ? items.first : items.last
    }
    return items[min(max(index + offset, 0), items.count - 1)]
  }

  func reorder(_ item: SidebarItem) -> Reorder? {
    switch item {
    case .library(let name): Reorder(kind: .libraries, id: name, ids: model.libraries.map(\.id), model: model)
    case .app(let root): Reorder(kind: .apps, id: root, ids: apps.map(\.root), model: model)
    case .group(let name): Reorder(kind: .groups, id: name, ids: groups.map(\.name), model: model)
    case .settings: nil
    }
  }
}

private struct SidebarHeader: View {
  let title: String

  var body: some View {
    Text(title)
      .font(DS.caption)
      .foregroundStyle(DS.muted)
      .padding(.horizontal, 12)
      .padding(.top, 10)
      .padding(.bottom, 4)
      .accessibilityAddTraits(.isHeader)
  }
}

/// Where a sidebar row sits in its list, so it can be moved, and another row of the list dropped on it.
private struct Reorder {
  let kind: ItemOrder.Kind
  let id: String
  let ids: [String]
  let model: MenuModel

  /// What a dragged row carries: its list and its id.
  var payload: String { "\(kind)\u{1F}\(id)" }

  private var index: Int? { ids.firstIndex(of: id) }
  var canMoveUp: Bool { (index ?? 0) > 0 }
  var canMoveDown: Bool { index.map { $0 < ids.count - 1 } ?? false }

  /// Moves this row up (-1) or down (1) one place.
  func move(by offset: Int) {
    guard let from = index, ids.indices.contains(from + offset) else { return }
    model.move(kind, ids: ids, from: IndexSet(integer: from), to: offset > 0 ? from + offset + 1 : from + offset)
  }

  /// Whether a row dragged with `payload` is one of this list's.
  func accepts(_ payload: String) -> Bool { source(payload) != nil }

  /// Whether dropping the dragged row above, or below, this one would change the order.
  func moves(_ payload: String, below: Bool) -> Bool { destination(payload, below: below) != nil }

  /// Puts the dragged row just above this one, or just below it. False for a row from another list,
  /// or a drop that would leave it where it is.
  func drop(_ payload: String, below: Bool) -> Bool {
    guard let (from, to) = destination(payload, below: below) else { return false }
    model.move(kind, ids: ids, from: IndexSet(integer: from), to: to)
    return true
  }

  private func source(_ payload: String) -> Int? {
    let parts = payload.split(separator: "\u{1F}", maxSplits: 1).map(String.init)
    guard parts.count == 2, parts[0] == "\(kind)" else { return nil }
    return ids.firstIndex(of: parts[1])
  }

  private func destination(_ payload: String, below: Bool) -> (from: Int, to: Int)? {
    guard let from = source(payload), let target = index else { return nil }
    let to = below ? target + 1 : target
    return to == from || to == from + 1 ? nil : (from, to)
  }
}

/// Where a drag over a row would put the dragged row: the half the pointer is in decides above or below,
/// and the marker is drawn at that edge, so it shows where the row lands whichever way it moves. The
/// sidebar knows which row is being dragged, so a row from another list, or a drop that would leave it
/// where it is, shows no marker at all.
private struct RowDrop: DropDelegate {
  let reorder: Reorder
  let dragging: String?
  let height: CGFloat
  @Binding var marker: VerticalEdge?

  func validateDrop(info: DropInfo) -> Bool { dragging.map(reorder.accepts) ?? false }

  func dropUpdated(info: DropInfo) -> DropProposal? {
    guard let dragging else { return DropProposal(operation: .forbidden) }
    let below = info.location.y >= height / 2
    marker = reorder.moves(dragging, below: below) ? (below ? .bottom : .top) : nil
    return DropProposal(operation: marker == nil ? .forbidden : .move)
  }

  func dropExited(info: DropInfo) { marker = nil }

  func performDrop(info: DropInfo) -> Bool {
    defer { marker = nil }
    guard let dragging, let marker else { return false }
    return reorder.drop(dragging, below: marker == .bottom)
  }
}

/// One row: its symbol, name and the number of links, 4 by 10 pt inside a 6 pt rounded rectangle.
private struct SidebarRow<Menu: View>: View {
  let item: SidebarItem
  let navigation: AppNavigation
  let focused: Bool
  let symbol: String
  let symbolTint: Color?
  let name: String
  /// What the row's tooltip says, and VoiceOver after the name: "Linked to 2 apps · Auto-sync on".
  let caption: String
  let watched: Bool
  let count: Int
  let reorder: Reorder
  let select: (SidebarItem) -> Void
  /// The row being dragged, if any, as its payload.
  @Binding var dragging: String?
  @ViewBuilder let menu: Menu
  @State private var marker: VerticalEdge?
  @State private var height: CGFloat = 0

  var body: some View {
    let selected = navigation.selection == item
    Button {
      select(item)
    } label: {
      HStack(spacing: 7) {
        Image(systemName: symbol)
          .frame(width: 14)
          .foregroundStyle(selected ? AnyShapeStyle(Color.accentColor) : symbolTint.map(AnyShapeStyle.init) ?? AnyShapeStyle(.primary))
        Text(name).lineLimit(1)
        if watched {
          Image(systemName: "arrow.clockwise").font(DS.caption)
        }
        Spacer(minLength: 4)
        Text("\(count)").font(DS.caption).foregroundStyle(DS.muted).monospacedDigit()
      }
      .font(DS.body)
      .foregroundStyle(selected ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.primary))
      .padding(.horizontal, 10)
      .padding(.vertical, 4)
      .background(selected ? (focused ? Color.accentColor.opacity(0.22) : DS.accentTint) : .clear, in: .rect(cornerRadius: 6))
      .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .help(caption)
    // One element, read as its name and what it holds, rather than a symbol's name and a bare count.
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(name)
    .accessibilityValue(caption)
    .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    .accessibilityAction(named: "Move up") { reorder.move(by: -1) }
    .accessibilityAction(named: "Move down") { reorder.move(by: 1) }
    .padding(.horizontal, 4)
    .id(item)
    .contextMenu {
      menu
      if reorder.ids.count > 1 {
        if !(menu is EmptyView) { Divider() }
        Button("Move up") { reorder.move(by: -1) }.disabled(!reorder.canMoveUp)
        Button("Move down") { reorder.move(by: 1) }.disabled(!reorder.canMoveDown)
      }
    }
    // Drop marker: the gap the dragged row will land in.
    .overlay(alignment: marker == .bottom ? .bottom : .top) {
      if marker != nil {
        Capsule().fill(Color.accentColor).frame(height: 2).padding(.horizontal, 8)
          .offset(y: marker == .bottom ? 1 : -1)
      }
    }
    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
    // onDrag rather than draggable: it says when a drag starts, so the rows know which one it is.
    .onDrag {
      dragging = reorder.payload
      return NSItemProvider(object: reorder.payload as NSString)
    }
    .onDrop(
      of: [.utf8PlainText, .plainText],
      delegate: RowDrop(reorder: reorder, dragging: dragging, height: height, marker: $marker))
  }
}

// MARK: Welcome

private struct WelcomeView: View {
  let model: MenuModel
  let navigation: AppNavigation

  var body: some View {
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
      .padding(.top, 22)
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
    return Page {
      Text(abbreviatedPath(library.root)).font(DS.caption).foregroundStyle(DS.muted).lineLimit(1)
        .truncationMode(.head)
      Spacer(minLength: 8)
      Text("Auto-sync").font(DS.caption).foregroundStyle(DS.muted).accessibilityHidden(true)
      Toggle("Auto-sync", isOn: Binding(
        get: { library.isWatched },
        set: { enabled in Task { await model.setWatch(name, enabled: enabled) } }))
        .toggleStyle(.mini)
        .disabled(model.isBusy(.watch(name)))
        .help(library.isWatched
          ? "Auto-sync is on: every change you save to \(name) is synced to its apps"
          : "Turn on to sync every change you save to \(name)")
      Button { revealInFinder(library.root) } label: { Image(systemName: "folder") }
        .buttonStyle(.pill)
        .help("Show \(name) in Finder")
        .accessibilityLabel("Show in Finder")
      Button {
        Task { await model.sync(name) }
      } label: {
        Label("Sync now", systemImage: "arrow.clockwise")
          .symbolEffect(.rotate, options: .repeat(.continuous), isActive: model.isBusy(.sync(name)))
      }
      .buttonStyle(.pill)
      // While it runs the symbol turns; it stays at full strength rather than fading as if disabled.
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

      SectionLabel("Linked apps")
      HairlineGroup {
        if row.links.isEmpty {
          GroupRow {
            Text("No app is linked yet. Link one below to install the dev build.").foregroundStyle(DS.muted)
          }
        }
        ForEach(row.links) { link in AppRow(link: link, model: model, actions: actions) }
      }

      SectionLabel("Apps that use \(name)")
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
          Button("Choose app…") { Task { await model.chooseAppAndLink(name) } }.buttonStyle(.pill)
          Button("Look again") { Task { await model.discoverConsumers() } }
            .buttonStyle(.pill(busy: model.isBusy(.discover)))
        }
      }
      Footnote("Found in your project folders. You can change those in Settings.")

      SectionLabel("Build")
      HairlineGroup {
        GroupRow {
          Text("Folder")
          Spacer(minLength: 8)
          Text(abbreviatedPath(library.root)).foregroundStyle(DS.muted).lineLimit(1).truncationMode(.head)
            .textSelection(.enabled)
        }
        GroupRow {
          Text("Build command")
          Spacer(minLength: 8)
          if let build = library.build.map({ BuildCommand(command: $0.command, args: $0.args).line }) {
            Text(build).font(DS.mono).lineLimit(1).truncationMode(.middle).textSelection(.enabled).help(build)
          } else {
            // In the body font: "None" in monospace read as a command called None.
            Text("No build step").foregroundStyle(DS.muted)
          }
        }
        GroupRow {
          Text("Publish folder")
          Spacer(minLength: 8)
          Text(publishFolder(library)).foregroundStyle(DS.muted).lineLimit(1).truncationMode(.head)
            .textSelection(.enabled)
        }
        GroupRow {
          Spacer()
          Button("Change…") { navigation.libraryEditor = LibraryEditorRequest(root: library.root) }.buttonStyle(.pill)
        }
      }

      HairlineGroup {
        GroupRow {
          TwoLine(
            title: "Remove from dryfit",
            caption: row.links.isEmpty ? "Your library's files are not touched." : "Restore its linked apps first.")
          Spacer(minLength: 8)
          Button("Remove…") { confirmingRemoval = true }
            .buttonStyle(.dangerPill(busy: model.isBusy(.unregister(name))))
            .disabled(!row.links.isEmpty)
        }
      }
      .padding(.top, 12)
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
      Spacer()
      Button {
        Task { await model.restoreGroup(name) }
      } label: {
        Label("Restore all", systemImage: "arrow.uturn.backward")
      }
      .buttonStyle(.pill(busy: model.isBusy(.restoreGroup(name))))
      .help("Put every app in \(name) back on released versions")
      PillMenu(busy: model.isBusy(.linkGroup(name))) {
        ForEach(model.status?.libraries ?? []) { library in
          Button(library.name) { Task { await model.linkGroup(name, library: library.name) } }
        }
      } label: {
        HStack(spacing: 4) {
          Image(systemName: "link.badge.plus").accessibilityHidden(true)
          Text("Link library")
          Image(systemName: "chevron.down").font(.system(size: 8, weight: .semibold)).accessibilityHidden(true)
        }
      }
      .disabled(model.status?.libraries.isEmpty ?? true)
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
      HairlineGroup {
        GroupRow {
          TwoLine(title: "Delete group", caption: "Deleting the group leaves its apps as they are.")
          Spacer(minLength: 8)
          Button("Delete…") { confirmingDeletion = true }.buttonStyle(.dangerPill(busy: model.isBusy(.deleteGroup(name))))
        }
      }
      .padding(.top, 12)
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
