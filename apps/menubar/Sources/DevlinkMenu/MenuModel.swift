import DevlinkAPI
import Foundation
import Observation

/// Something worth telling the user about: a failed build, install, publish or watch.
public struct Failure: Identifiable, Equatable, Sendable {
  public let id: UUID
  public let title: String
  /// The captured output, or the daemon's explanation.
  public let detail: String
  public let date: Date

  public init(id: UUID = UUID(), title: String, detail: String, date: Date = .now) {
    self.id = id
    self.title = title
    self.detail = detail
    self.date = date
  }
}

/// Posts failures where the user will see them: a system notification in the app.
public protocol Notifier: AnyObject {
  func post(_ failure: Failure)
}

/// A library with the consumers it is linked into.
public struct LibraryRow: Identifiable, Equatable {
  public let library: Library
  public let links: [Link]
  public var id: String { library.name }
}

/// The menu's state and actions (ADR 0013). It follows the daemon's events, keeps `status` current,
/// and never starts the daemon unless asked.
@Observable public final class MenuModel {
  public enum Lookup: Sendable {
    case running(any DaemonAPI, Health)
    case notRunning
    case incompatible(Health)
  }

  public enum Connection: Equatable {
    case connecting, offline, starting, online
    /// The daemon speaks another API version; devlink or this app needs updating.
    case incompatible(daemonVersion: String)
  }

  /// What the menu bar icon shows, most urgent first.
  public enum Icon: Equatable {
    case offline, attention, working, idle
  }

  /// Something the user started; while it runs, its control shows progress and cannot be repeated.
  public enum Action: Hashable {
    case sync(String), watch(String), link(String, String), restore(String)
    case linkGroup(String), restoreGroup(String), discover
  }

  public internal(set) var connection = Connection.connecting
  public internal(set) var status: Status?
  /// What the daemon is doing now, in words.
  public internal(set) var activity: String?
  /// Newest first.
  public internal(set) var failures: [Failure] = []
  public internal(set) var hasUnseenFailure = false
  public internal(set) var consumers: [DiscoveredConsumer] = []
  public internal(set) var inFlight: Set<Action> = []
  /// Why the last action did not work, shown under the controls.
  public internal(set) var actionError: String?
  /// Why starting the daemon did not work.
  public internal(set) var startError: String?
  private(set) var lastEventID: Int?

  @ObservationIgnored private let connect: () async -> Lookup
  @ObservationIgnored private let launch: () async throws -> Void
  @ObservationIgnored private let notifier: any Notifier
  @ObservationIgnored private let sleep: @Sendable (Duration) async throws -> Void
  @ObservationIgnored private var api: (any DaemonAPI)?
  @ObservationIgnored private var nudged = false
  @ObservationIgnored private var refreshing = false
  @ObservationIgnored private var refreshAgain = false
  @ObservationIgnored private var startDeadline: ContinuousClock.Instant?

  static let minimumDelay = Duration.seconds(1)
  static let maximumDelay = Duration.seconds(10)
  static let startTimeout = Duration.seconds(30)

  public init(
    connect: @escaping () async -> Lookup,
    launch: @escaping () async throws -> Void,
    notifier: any Notifier,
    sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
  ) {
    self.connect = connect
    self.launch = launch
    self.notifier = notifier
    self.sleep = sleep
  }

  // MARK: Derived state

  public var icon: Icon {
    switch connection {
    case .connecting, .offline, .starting: return .offline
    case .incompatible: return .attention
    case .online: break
    }
    if hasUnseenFailure || status?.links.contains(where: { $0.status == .failed }) == true { return .attention }
    if status?.jobs.running != nil || activity != nil || !inFlight.isEmpty { return .working }
    return .idle
  }

  public var libraries: [LibraryRow] {
    guard let status else { return [] }
    return status.libraries.map { library in
      LibraryRow(library: library, links: status.links.filter { $0.library == library.name })
    }
  }

  /// Discovered consumers that depend on `library` and are not linked to it yet.
  public func linkCandidates(for library: String) -> [DiscoveredConsumer] {
    let linked = Set(status?.links.filter { $0.library == library }.map(\.consumer) ?? [])
    return consumers.filter { consumer in
      consumer.libraries.contains { $0.name == library } && !linked.contains(consumer.root)
    }
  }

  public func isBusy(_ action: Action) -> Bool { inFlight.contains(action) }

  // MARK: Connection

  /// Follows the daemon for as long as the app runs: connects, follows its events, and when it goes
  /// away, looks again with backoff (re-reading `daemon.json`, since a restarted daemon may move).
  public func run() async {
    var delay = Self.minimumDelay
    while !Task.isCancelled {
      switch await connect() {
      case .running(let api, _):
        delay = Self.minimumDelay
        await follow(api)
      case .notRunning:
        api = nil
        if connection == .starting, let deadline = startDeadline, ContinuousClock.now < deadline { break }
        if connection == .starting {
          startError = "devlink did not start within 30 seconds. Its log may say why."
        }
        connection = .offline
      case .incompatible(let health):
        api = nil
        connection = .incompatible(daemonVersion: health.version)
      }
      await pause(delay)
      delay = min(delay * 2, Self.maximumDelay)
    }
  }

  /// Starts the daemon at the user's request, then looks for it straight away.
  public func startDaemon() async {
    guard connection == .offline else { return }
    connection = .starting
    startError = nil
    do {
      try await launch()
      startDeadline = .now + Self.startTimeout
      nudged = true
    } catch {
      startError = error.localizedDescription
      connection = .offline
    }
  }

  /// The user opened the menu, so any failure has now been seen.
  public func menuOpened() {
    hasUnseenFailure = false
  }

  /// The user dismissed the failures they have read.
  public func clearFailures() {
    failures = []
    hasUnseenFailure = false
  }

  private func follow(_ api: any DaemonAPI) async {
    self.api = api
    // Subscribed before reading status, so nothing that happens in between is missed.
    let events = api.events(after: lastEventID)
    // Online once there is something to show, so the menu never flashes an empty daemon.
    await refresh()
    connection = .online
    startError = nil
    startDeadline = nil
    do {
      for try await event in events { handle(event) }
    } catch {}
    self.api = nil
    if !Task.isCancelled { connection = .offline }
  }

  private func pause(_ total: Duration) async {
    let step = Duration.milliseconds(250)
    var waited = Duration.zero
    while waited < total, !nudged, !Task.isCancelled {
      try? await sleep(step)
      waited += step
    }
    nudged = false
  }

  // MARK: Events

  func handle(_ event: ServerEvent) {
    lastEventID = event.id
    switch event.kind {
    case .buildStarted(let library):
      activity = "Building \(library)…"
    case .buildFailed(let library, let output):
      fail("Build of \(library) failed", output)
    case .publishSucceeded(let library, let version):
      activity = "Published \(library) \(DevVersion.describe(version))"
    case .installStarted(let library, let consumer, _):
      activity = "Installing \(library) into \(projectName(consumer))…"
    case .installFailed(let library, let consumer, _, let output):
      fail("Install of \(library) into \(projectName(consumer)) failed", output)
    case .consumerRestored(let consumer, _):
      activity = "Restored \(projectName(consumer))"
    case .jobStarted(let job):
      activity = describe(job)
      scheduleRefresh()
    case .jobQueued, .stateChanged:
      scheduleRefresh()
    case .jobFinished(_, let error):
      // A failed build has its own event with the output; anything else is reported here.
      if let error, error.code != APIError.Code.buildFailed.rawValue { fail(error.message, error.message) }
      Task { await refresh(clearingActivityWhenIdle: true) }
    case .watchFailed(let library, let message):
      fail("Stopped watching \(library)", message)
      scheduleRefresh()
    case .buildSucceeded, .installSucceeded, .cachesCleared, .libraryChanged, .unknown:
      break
    }
  }

  private func fail(_ title: String, _ detail: String) {
    let failure = Failure(title: title, detail: detail)
    failures = Array(([failure] + failures).prefix(20))
    hasUnseenFailure = true
    notifier.post(failure)
  }

  private func scheduleRefresh() {
    Task { await refresh() }
  }

  /// Reloads status. Requests that arrive while one is loading fold into a single follow-up.
  private func refresh(clearingActivityWhenIdle: Bool = false) async {
    if refreshing {
      refreshAgain = true
    } else {
      refreshing = true
      repeat {
        refreshAgain = false
        guard let api else { break }
        if let next = try? await api.status(), next != status { status = next }
      } while refreshAgain
      refreshing = false
    }
    if clearingActivityWhenIdle, status?.jobs.running == nil, status?.jobs.queued.isEmpty != false {
      activity = nil
    }
  }

  // MARK: Actions

  public func sync(_ library: String) async {
    await perform(.sync(library)) { _ = try await $0.sync(library: library) }
  }

  public func setWatch(_ library: String, enabled: Bool) async {
    await perform(.watch(library)) { _ = try await $0.setWatch(library: library, enabled: enabled) }
  }

  public func link(_ library: String, into consumer: String) async {
    await perform(.link(library, consumer)) { _ = try await $0.link(library: library, consumer: consumer) }
  }

  public func restore(_ consumer: String) async {
    await perform(.restore(consumer)) { api in
      let result = try await api.restore(consumer: consumer)
      if !result.ok {
        self.fail("Restored \(projectName(consumer)), but the clean install failed", result.output ?? "")
      }
    }
  }

  public func linkGroup(_ group: String, library: String) async {
    await perform(.linkGroup(group)) { api in
      self.report(try await api.linkGroup(group, library: library))
    }
  }

  public func restoreGroup(_ group: String) async {
    await perform(.restoreGroup(group)) { api in
      self.report(try await api.restoreGroup(group))
    }
  }

  /// Looks for projects that use the registered libraries, for the Link menus.
  public func discoverConsumers() async {
    await perform(.discover) { api in self.consumers = try await api.discover() }
  }

  private func report(_ outcomes: [GroupMemberOutcome]) {
    let failed = outcomes.filter { $0.status == .failed }
    if !failed.isEmpty {
      actionError = failed.map { "\(projectName($0.consumer)): \($0.message ?? "failed")" }.joined(separator: "\n")
    }
  }

  private func perform(_ action: Action, _ body: (any DaemonAPI) async throws -> Void) async {
    guard let api, !inFlight.contains(action) else { return }
    inFlight.insert(action)
    actionError = nil
    do {
      try await body(api)
    } catch let error as APIError where error.code == .buildFailed {
      // Its build:failed event has already reported it, with the output.
    } catch {
      actionError = error.localizedDescription
    }
    inFlight.remove(action)
    await refresh()
  }

  private func describe(_ job: Job) -> String {
    let words = job.label.split(separator: " ").map { $0.hasPrefix("/") ? projectName(String($0)) : String($0) }
    let text = words.joined(separator: " ")
    return text.prefix(1).uppercased() + text.dropFirst()
  }
}

/// A project's folder name, which is how people refer to it.
func projectName(_ path: String) -> String {
  URL(filePath: path).lastPathComponent
}
