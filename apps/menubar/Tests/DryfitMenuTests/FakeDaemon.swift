import DryfitAPI
import Foundation
import Testing
@testable import DryfitMenu

let shop = "/Users/me/repos/shop"
let admin = "/Users/me/repos/admin"
let version = "1.4.1-dev.20261118143201"

let health = Health(
  name: "dryfit", version: "0.1.0", apiVersion: 1, pid: 42, registryUrl: "http://127.0.0.1:4874/",
  startedAt: "2026-11-18T09:00:00.000Z")

let ui = Library(
  name: "@acme/ui", root: "/Users/me/repos/ui-lib/projects/ui", publishDir: "/Users/me/repos/ui-lib/dist/ui",
  lastPublishedVersion: version, watch: true)
let forms = Library(name: "@acme/forms", root: "/Users/me/repos/forms", publishDir: "/Users/me/repos/forms")

let linkedStatus = Status(
  daemon: health,
  libraries: [ui, forms],
  links: [Link(library: "@acme/ui", consumer: shop, status: .installed, installedVersion: version, guarded: true)],
  groups: [Group(name: "checkout", consumers: [shop, admin])])

/// A daemon that answers from scripted replies and lets the test push events.
actor FakeDaemon: DaemonAPI {
  var statusReply = linkedStatus
  var statusCalls = 0
  var calls: [String] = []
  var failure: APIError?
  var restoreReply = RestoreResult(ok: true)
  var groupReply: [GroupMemberOutcome] = []
  var discovered: [DiscoveredConsumer] = []
  nonisolated let channel = EventChannel()

  func setStatus(_ status: Status) { statusReply = status }
  func fail(with error: APIError?) { failure = error }
  func setRestoreReply(_ reply: RestoreResult) { restoreReply = reply }
  func setGroupReply(_ reply: [GroupMemberOutcome]) { groupReply = reply }
  func setDiscovered(_ consumers: [DiscoveredConsumer]) { discovered = consumers }

  private func record(_ call: String) throws {
    calls.append(call)
    if let failure { throw failure }
  }

  func status() async throws -> Status {
    statusCalls += 1
    return statusReply
  }

  func sync(library: String) async throws -> SyncResult {
    try record("sync \(library)")
    return SyncResult(version: version, installs: [])
  }

  func setWatch(library: String, enabled: Bool) async throws -> Library {
    try record("watch \(library) \(enabled)")
    return ui
  }

  func discover() async throws -> [DiscoveredConsumer] {
    try record("discover")
    return discovered
  }

  func link(library: String, consumer: String) async throws -> LinkResult {
    try record("link \(library) \(consumer)")
    let json = #"{"link":{"library":"\#(library)","consumer":"\#(consumer)","status":"pending"},"guard":"installed"}"#
    return try JSONDecoder().decode(LinkResult.self, from: Data(json.utf8))
  }

  func restore(consumer: String, library: String?, force: Bool) async throws -> RestoreResult {
    try record("restore \(library.map { "\($0) in " } ?? "")\(consumer)\(force ? " force" : "")")
    return restoreReply
  }

  func inspect(root: String) async throws -> LibraryPreview {
    try record("inspect \(root)")
    return LibraryPreview(
      name: "@acme/ui", version: "1.4.0", root: root, detected: "npm-script", publishDir: root,
      build: BuildCommand(command: "npm", args: ["run", "build"]), registered: false)
  }

  func register(root: String, publishDir: String?, build: BuildCommand?) async throws -> RegisterResult {
    try record("register \(root) \(publishDir ?? "-") \(build?.line ?? "-")")
    return RegisterResult(library: ui, detected: "given")
  }

  func unregister(library: String) async throws -> Done {
    try record("unregister \(library)")
    return Done()
  }

  func saveGroup(_ name: String, consumers: [String]) async throws -> Group {
    try record("saveGroup \(name) \(consumers.joined(separator: ","))")
    return Group(name: name, consumers: consumers)
  }

  func deleteGroup(_ name: String) async throws -> Done {
    try record("deleteGroup \(name)")
    return Done()
  }

  var rootsReply = ["/Users/me/repos"]

  func roots() async throws -> [String] { rootsReply }

  func setRoots(_ roots: [String]) async throws -> [String] {
    try record("setRoots \(roots.joined(separator: ","))")
    rootsReply = roots
    return roots
  }

  func shutdown() async throws -> Done {
    try record("shutdown")
    return Done()
  }

  func linkGroup(_ group: String, library: String) async throws -> [GroupMemberOutcome] {
    try record("linkGroup \(group) \(library)")
    return groupReply
  }

  func restoreGroup(_ group: String) async throws -> [GroupMemberOutcome] {
    try record("restoreGroup \(group)")
    return groupReply
  }

  nonisolated func events(after lastEventID: Int?) -> AsyncThrowingStream<ServerEvent, any Error> {
    channel.open(after: lastEventID)
  }
}

/// The event stream of the current connection; the test pushes events or ends it.
final class EventChannel: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: AsyncThrowingStream<ServerEvent, any Error>.Continuation?
  private(set) var resumedAfter: [Int?] = []

  func open(after lastEventID: Int?) -> AsyncThrowingStream<ServerEvent, any Error> {
    let (stream, continuation) = AsyncThrowingStream<ServerEvent, any Error>.makeStream()
    lock.withLock {
      self.continuation = continuation
      resumedAfter.append(lastEventID)
    }
    return stream
  }

  var isOpen: Bool { lock.withLock { continuation != nil } }

  func send(_ kind: ServerEvent.Kind, id: Int) {
    _ = lock.withLock { continuation?.yield(ServerEvent(id: id, kind: kind)) }
  }

  /// The daemon went away.
  func end() {
    lock.withLock {
      continuation?.finish()
      continuation = nil
    }
  }
}

@MainActor final class RecordingNotifier: Notifier {
  var posted: [Failure] = []
  func post(_ failure: Failure) { posted.append(failure) }
}

/// Waits until `condition` holds, failing after a second.
@MainActor func eventually(
  _ condition: @MainActor () async -> Bool, sourceLocation: SourceLocation = #_sourceLocation
) async {
  for _ in 0..<200 {
    if await condition() { return }
    try? await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("condition never held", sourceLocation: sourceLocation)
}
