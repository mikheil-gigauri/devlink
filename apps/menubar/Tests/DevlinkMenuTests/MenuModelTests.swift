import DevlinkAPI
import Foundation
import Testing

@testable import DevlinkMenu

@MainActor @Suite struct MenuModelTests {
  let daemon = FakeDaemon()
  let notifier = RecordingNotifier()

  /// Whether the fake daemon is up, for tests that start it.
  final class Switch {
    var on = false
  }

  func makeModel(
    lookup: @escaping @MainActor () -> MenuModel.Lookup? = { nil },
    launch: @escaping @MainActor () async throws -> Void = {}
  ) -> MenuModel {
    let daemon = daemon
    return MenuModel(
      connect: { lookup() ?? .running(daemon, health) },
      launch: launch,
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
    #expect(model.startError?.contains("could not find the devlink command") == true)
  }

  @Test func refusesADaemonOfAnotherAPIVersion() async {
    let newer = Health(name: "devlink", version: "2.0.0", apiVersion: 2, pid: 1, registryUrl: "", startedAt: "")
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
      "Install of @acme/ui into admin failed", "Publishing failed", "Stopped watching @acme/ui",
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

    await daemon.fail(with: APIError(code: .manifestDrifted, message: "shop has changes devlink did not make."))
    await model.restore(shop)
    #expect(model.actionError == "shop has changes devlink did not make.")
    #expect(model.isBusy(.restore(shop)) == false)
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
}
