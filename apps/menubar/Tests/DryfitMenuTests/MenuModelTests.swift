import DryfitAPI
import Foundation
import Testing

@testable import DryfitMenu

@MainActor @Suite struct MenuModelTests {
  let daemon = FakeDaemon()
  let notifier = RecordingNotifier()

  /// Whether the fake daemon is up, for tests that start it.
  final class Switch {
    var on = false
  }

  func makeModel(
    lookup: @escaping @MainActor () -> MenuModel.Lookup? = { nil },
    launch: @escaping @MainActor () async throws -> Void = {},
    install: @escaping @MainActor () async throws -> Void = {}
  ) -> MenuModel {
    let daemon = daemon
    return MenuModel(
      connect: { lookup() ?? .running(daemon, health) },
      launch: launch,
      install: install,
      notifier: notifier,
      sleep: { _ in try await Task.sleep(for: .milliseconds(2)) }
    )
  }

  /// Runs the model's connection loop for the length of the test.
  func started(_ model: MenuModel) async -> Task<Void, Never> {
    let task = Task { await model.run() }
    await eventually { model.connection == .online }
    return task
  }

  @Test func connectsAndShowsTheDaemonsState() async {
    let model = makeModel()
    let task = await started(model)
    defer { task.cancel() }

    #expect(model.status == linkedStatus)
    #expect(model.icon == .idle)
    #expect(model.libraries.map(\.library.name) == ["@acme/ui", "@acme/forms"])
    #expect(model.libraries.first?.links.map(\.consumer) == [shop])
  }

  @Test func showsOfflineAndStartsTheDaemonOnlyWhenAsked() async {
    let daemonUp = Switch()
    let model = makeModel(
      lookup: { daemonUp.on ? nil : .notRunning },
      launch: { daemonUp.on = true })
    let task = Task { await model.run() }
    defer { task.cancel() }

    await eventually { model.connection == .offline }
    #expect(model.icon == .offline)

    await model.startDaemon()

    await eventually { model.connection == .online }
    #expect(daemonUp.on)
  }

  @Test func explainsWhyTheDaemonCouldNotBeStarted() async {
    let model = makeModel(
      lookup: { .notRunning },
      launch: { throw DaemonLauncher.Failure.cliNotFound })
    let task = Task { await model.run() }
    defer { task.cancel() }
    await eventually { model.connection == .offline }

    await model.startDaemon()

    #expect(model.connection == .offline)
    #expect(model.startError?.contains("not installed") == true)
    #expect(model.cliMissing)
  }

  @Test func installsTheCLIWhenAsked_thenStartsTheDaemon() async {
    let installed = Switch()
    let daemonUp = Switch()
    let model = makeModel(
      lookup: { daemonUp.on ? nil : .notRunning },
      launch: {
        guard installed.on else { throw DaemonLauncher.Failure.cliNotFound }
        daemonUp.on = true
      },
      install: { installed.on = true })
    let task = Task { await model.run() }
    defer { task.cancel() }
    await eventually { model.connection == .offline }
    await model.startDaemon()
    #expect(model.cliMissing)

    await model.installCLI()

    await eventually { model.connection == .online }
    #expect(!model.cliMissing)
  }

  @Test func readsTheProjectFoldersOnConnecting_andReplacesThem() async {
    let model = makeModel()
    let task = await started(model)
    defer { task.cancel() }
    #expect(model.roots == ["/Users/me/repos"])

    try? await model.setRoots(["/Users/me/work"])

    #expect(model.roots == ["/Users/me/work"])
    #expect(await daemon.calls == ["setRoots /Users/me/work", "discover"])
  }

  @Test func addsALibraryWithTheSettingsChosen_thenLooksForItsProjects() async throws {
    let model = makeModel()
    let task = await started(model)
    defer { task.cancel() }

    let preview = try await model.inspect("/r/ui")
    try await model.register(preview.root, publishDir: "/r/ui/dist", build: BuildCommand(line: "npm run build"))

    #expect(await daemon.calls == ["inspect /r/ui", "register /r/ui /r/ui/dist npm run build", "discover"])
  }

  @Test func asksBeforeRestoringAnAppWhosePackageJsonChanged() async {
    let model = makeModel()
    let task = await started(model)
    defer { task.cancel() }
    await daemon.fail(with: APIError(code: .manifestDrifted, message: "package.json changed"))

    await model.restore(shop)

    #expect(model.driftedRestore == RestoreRequest(consumer: shop))
    #expect(model.actionError == nil)

    await daemon.fail(with: nil)
    await model.restore(shop, force: true)

    #expect(model.driftedRestore == nil)
    #expect(await daemon.calls.last == "restore \(shop) force")
  }

  @Test func restoresOneLibraryAndRetriesThatLibraryAfterADrift() async {
    let model = makeModel()
    let task = await started(model)
    defer { task.cancel() }
    await daemon.fail(with: APIError(code: .manifestDrifted, message: "package.json changed"))

    await model.restore(shop, library: "@acme/ui")
    #expect(model.driftedRestore == RestoreRequest(consumer: shop, library: "@acme/ui"))

    await daemon.fail(with: nil)
    let request = model.driftedRestore!
    await model.restore(request.consumer, library: request.library, force: true)
    #expect(await daemon.calls.last == "restore @acme/ui in \(shop) force")

    daemon.channel.send(.consumerRestored(consumer: shop, library: "@acme/ui", ok: true), id: 1)
    await eventually { model.activity == "Restored @acme/ui in shop" }
  }

  @Test func refusesADaemonOfAnotherAPIVersion() async {
    let newer = Health(name: "dryfit", version: "2.0.0", apiVersion: 2, pid: 1, registryUrl: "", startedAt: "")
    let model = makeModel(lookup: { .incompatible(newer) })
    let task = Task { await model.run() }
    defer { task.cancel() }

    await eventually { model.connection == .incompatible(daemonVersion: "2.0.0") }
    #expect(model.icon == .attention)
  }

  @Test func narratesWhatTheDaemonIsDoingAndRefreshesWhenStateChanges() async {
    let model = makeModel()
    let task = await started(model)
    defer { task.cancel() }
    let before = await daemon.statusCalls

    daemon.channel.send(.jobStarted(Job(id: 1, label: "sync @acme/ui", queuedAt: "")), id: 1)
    daemon.channel.send(.installStarted(library: "@acme/ui", consumer: shop, version: version), id: 2)
    await eventually { model.activity == "Installing @acme/ui into shop…" }
    #expect(model.icon == .working)

    daemon.channel.send(.stateChanged, id: 3)
    await eventually { await daemon.statusCalls > before }
  }

  @Test func reportsABuildFailureOnceWithItsOutput() async {
    let model = makeModel()
    let task = await started(model)
    defer { task.cancel() }

    daemon.channel.send(.buildFailed(library: "@acme/ui", output: "TS2304: Cannot find name 'Butto'."), id: 1)
    let job = Job(id: 1, label: "sync @acme/ui", queuedAt: "")
    daemon.channel.send(.jobFinished(job, error: .init(code: "build-failed", message: "Building @acme/ui failed")), id: 2)
    await eventually { notifier.posted.count == 1 }
    try? await Task.sleep(for: .milliseconds(20))

    #expect(notifier.posted.count == 1)
    #expect(model.failures.first?.title == "Build of @acme/ui failed")
    #expect(model.failures.first?.detail == "TS2304: Cannot find name 'Butto'.")
    #expect(model.icon == .attention)

    model.menuOpened()
    #expect(model.icon == .idle)
  }

  @Test func reportsFailedInstallsAndJobsWithoutOwnEvents() async {
    let model = makeModel()
    let task = await started(model)
    defer { task.cancel() }

    daemon.channel.send(
      .installFailed(library: "@acme/ui", consumer: admin, version: version, output: "npm ERR! ERESOLVE"), id: 1)
    let job = Job(id: 2, label: "sync @acme/ui", queuedAt: "")
    daemon.channel.send(.jobFinished(job, error: .init(code: "publish-failed", message: "Publishing failed")), id: 2)
    daemon.channel.send(.watchFailed(library: "@acme/ui", message: "EMFILE"), id: 3)
    await eventually { notifier.posted.count == 3 }

    #expect(notifier.posted.map(\.title) == [
      "Install of @acme/ui into admin failed", "Publishing failed", "Auto-sync of @acme/ui stopped",
    ])
  }

  @Test func reconnectsWhenTheDaemonGoesAwayAndResumesAfterTheLastEvent() async {
    let model = makeModel()
    let task = await started(model)
    defer { task.cancel() }
    daemon.channel.send(.stateChanged, id: 41)
    await eventually { model.lastEventID == 41 }

    daemon.channel.end()

    await eventually { daemon.channel.resumedAfter.count == 2 }
    #expect(daemon.channel.resumedAfter == [nil, 41])
    await eventually { model.connection == .online }
  }

  @Test func runsActionsAndShowsTheirErrors() async {
    let model = makeModel()
    let task = await started(model)
    defer { task.cancel() }

    await model.sync("@acme/ui")
    await model.setWatch("@acme/ui", enabled: false)
    await model.link("@acme/ui", into: admin)
    #expect(await daemon.calls == ["sync @acme/ui", "watch @acme/ui false", "link @acme/ui \(admin)"])
    #expect(model.actionError == nil)

    await daemon.fail(with: APIError(code: .snapshotMissing, message: "No snapshot of shop was found."))
    await model.restore(shop)
    #expect(model.actionError == "No snapshot of shop was found.")
    #expect(model.isBusy(.restore(shop, nil)) == false)
  }

  @Test func leavesBuildFailuresToTheirEventInsteadOfRepeatingThem() async {
    let model = makeModel()
    let task = await started(model)
    defer { task.cancel() }
    await daemon.fail(with: APIError(code: .buildFailed, message: "Building @acme/ui failed", output: "TS2304"))

    await model.sync("@acme/ui")

    #expect(model.actionError == nil)
  }

  @Test func recordsARestoreWhoseCleanInstallFailed() async {
    let model = makeModel()
    let task = await started(model)
    defer { task.cancel() }
    await daemon.setRestoreReply(RestoreResult(ok: false, output: "npm ERR! network"))

    await model.restore(shop)

    #expect(model.failures.first?.title == "Restored shop, but the clean install failed")
    #expect(model.failures.first?.detail == "npm ERR! network")
  }

  @Test func summarisesGroupMembersThatFailed() async {
    let model = makeModel()
    let task = await started(model)
    defer { task.cancel() }
    await daemon.setGroupReply([
      .init(consumer: shop, status: .done),
      .init(consumer: admin, status: .failed, message: "Install into admin failed"),
    ])

    await model.linkGroup("checkout", library: "@acme/ui")

    #expect(model.actionError == "admin: Install into admin failed")
  }

  @Test func offersToLinkOnlyDiscoveredConsumersThatUseTheLibraryAndAreNotLinked() async {
    let model = makeModel()
    let task = await started(model)
    defer { task.cancel() }
    await daemon.setDiscovered([
      DiscoveredConsumer(root: shop, name: "shop", libraries: [.init(name: "@acme/ui", range: "^1.4.0")], packageManager: .npm),
      DiscoveredConsumer(root: admin, name: "admin", libraries: [.init(name: "@acme/ui", range: "^1.4.0")], packageManager: .npm),
      DiscoveredConsumer(root: "/r/blog", name: "blog", libraries: [.init(name: "@acme/forms", range: "*")], packageManager: .npm),
    ])

    await model.discoverConsumers()

    #expect(model.linkCandidates(for: "@acme/ui").map(\.root) == [admin])
    #expect(model.linkCandidates(for: "@acme/forms").map(\.root) == ["/r/blog"])
  }

  @Test func listsAppsThatUseALibraryOrAreLinkedToOne() async {
    let model = makeModel()
    let task = await started(model)
    defer { task.cancel() }
    await daemon.setDiscovered([
      DiscoveredConsumer(root: admin, name: "admin", libraries: [.init(name: "@acme/ui", range: "^1.4.0")], packageManager: .pnpm),
      DiscoveredConsumer(root: "/r/blog", name: "blog", libraries: [.init(name: "@acme/forms", range: "*")], packageManager: .npm),
      DiscoveredConsumer(root: "/r/other", name: "other", libraries: [.init(name: "left-pad", range: "*")], packageManager: .npm),
    ])

    await model.discoverConsumers()

    #expect(model.apps.map(\.name) == ["admin", "blog", "shop"])
    let shopApp = model.apps.first { $0.root == shop }
    #expect(shopApp?.linked.map(\.library) == ["@acme/ui"])
    #expect(shopApp?.packageManager == nil)
    let adminApp = model.apps.first { $0.root == admin }
    #expect(adminApp?.unlinked.map(\.library) == ["@acme/ui"])
    #expect(adminApp?.libraries.first?.range == "^1.4.0")
    #expect(adminApp?.packageManager == "pnpm")
  }

  @Test func opensAFolderAsAnApp_aLibrary_orSaysWhyNot() async throws {
    let model = makeModel()
    let task = await started(model)
    defer { task.cancel() }
    let folder = FileManager.default.temporaryDirectory.appending(path: "dryfit-apps-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: folder) }
    func project(_ name: String, _ manifest: String?, lockfile: String? = nil) throws -> String {
      let root = folder.appending(path: name)
      try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
      if let manifest { try manifest.write(to: root.appending(path: "package.json"), atomically: true, encoding: .utf8) }
      if let lockfile { try "".write(to: root.appending(path: lockfile), atomically: true, encoding: .utf8) }
      return root.path(percentEncoded: false)
    }
    let store = try project(
      "store", #"{"name":"store","devDependencies":{"@acme/forms":"^2.0.0","typescript":"~5.9.0"}}"#,
      lockfile: "pnpm-lock.yaml")
    let unrelated = try project("unrelated", #"{"name":"unrelated","dependencies":{"left-pad":"*"}}"#)
    let empty = try project("empty", nil)
    let navigation = AppNavigation()

    model.open(store, navigation: navigation, orAddAsLibrary: false)
    #expect(navigation.selection == .app(store))
    let app = model.apps.first { $0.root == store }
    #expect(app?.unlinked.map(\.library) == ["@acme/forms"])
    #expect(app?.libraries.first?.range == "^2.0.0")
    #expect(app?.packageManager == "pnpm")
    #expect(model.linkCandidates(for: "@acme/forms").map(\.root) == [store])

    model.open(unrelated, navigation: navigation, orAddAsLibrary: false)
    #expect(model.actionError?.contains("does not depend on any of your libraries") == true)
    model.open(unrelated, navigation: navigation, orAddAsLibrary: true)
    #expect(navigation.libraryEditor?.root == unrelated)

    model.open(empty, navigation: navigation, orAddAsLibrary: true)
    #expect(model.actionError == "empty has no package.json. Choose the folder that holds it.")

    model.open(ui.root, navigation: navigation, orAddAsLibrary: true)
    #expect(navigation.selection == .library("@acme/ui"))
    #expect(model.actionError == nil)
  }
}
