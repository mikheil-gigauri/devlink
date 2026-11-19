import Foundation

/// What the menu needs from the daemon. The view model's tests substitute a fake.
public protocol DaemonAPI: Sendable {
  func status() async throws -> Status
  func inspect(root: String) async throws -> LibraryPreview
  func register(root: String, publishDir: String?, build: BuildCommand?) async throws -> RegisterResult
  func unregister(library: String) async throws -> Done
  func sync(library: String) async throws -> SyncResult
  func setWatch(library: String, enabled: Bool) async throws -> Library
  func discover() async throws -> [DiscoveredConsumer]
  func link(library: String, consumer: String) async throws -> LinkResult
  /// Restores `library` in `consumer`, keeping its other links, or every library when nil.
  func restore(consumer: String, library: String?, force: Bool) async throws -> RestoreResult
  func saveGroup(_ name: String, consumers: [String]) async throws -> Group
  func deleteGroup(_ name: String) async throws -> Done
  func linkGroup(_ group: String, library: String) async throws -> [GroupMemberOutcome]
  func restoreGroup(_ group: String) async throws -> [GroupMemberOutcome]
  func roots() async throws -> [String]
  func setRoots(_ roots: [String]) async throws -> [String]
  func shutdown() async throws -> Done
  /// Follows the daemon's events, first replaying any after `lastEventID`. Ends when the daemon goes away.
  func events(after lastEventID: Int?) -> AsyncThrowingStream<ServerEvent, any Error>
}

/// Talks to devlinkd over its HTTP API (ADR 0012).
public struct DaemonClient: DaemonAPI {
  public let baseURL: URL
  private let token: String
  private let session: URLSession

  public init(baseURL: URL, token: String, session: URLSession = .shared) {
    self.baseURL = baseURL
    self.token = token
    self.session = session
  }

  /// Who is listening. Sent without the token, so the caller can check it is devlink first.
  public func health(timeout: TimeInterval = 2) async throws -> Health {
    var request = URLRequest(url: baseURL.appending(path: "v1/health"), timeoutInterval: timeout)
    request.httpMethod = "GET"
    return try await send(request)
  }

  public func status() async throws -> Status { try await call(.status, Empty()) }

  public func inspect(root: String) async throws -> LibraryPreview {
    try await call(.inspect, ["root": root])
  }

  public func register(root: String, publishDir: String?, build: BuildCommand?) async throws -> RegisterResult {
    try await call(.register, RegisterInput(root: root, publishDir: publishDir, build: build))
  }

  public func unregister(library: String) async throws -> Done {
    try await call(.unregister, ["library": library])
  }

  public func sync(library: String) async throws -> SyncResult {
    try await call(.sync, ["library": library])
  }

  public func setWatch(library: String, enabled: Bool) async throws -> Library {
    try await call(.watch, WatchInput(library: library, enabled: enabled))
  }

  public func discover() async throws -> [DiscoveredConsumer] { try await call(.discover, Empty()) }

  public func link(library: String, consumer: String) async throws -> LinkResult {
    try await call(.link, ["library": library, "consumer": consumer])
  }

  public func restore(consumer: String, library: String?, force: Bool) async throws -> RestoreResult {
    try await call(.restore, RestoreInput(consumer: consumer, library: library, force: force ? true : nil))
  }

  public func saveGroup(_ name: String, consumers: [String]) async throws -> Group {
    try await call(.saveGroup, SaveGroupInput(name: name, consumers: consumers))
  }

  public func deleteGroup(_ name: String) async throws -> Done {
    try await call(.deleteGroup, ["name": name])
  }

  public func linkGroup(_ group: String, library: String) async throws -> [GroupMemberOutcome] {
    try await call(.linkGroup, ["group": group, "library": library])
  }

  public func restoreGroup(_ group: String) async throws -> [GroupMemberOutcome] {
    try await call(.restoreGroup, ["group": group])
  }

  public func roots() async throws -> [String] {
    let reply: Roots = try await call(.roots, Empty())
    return reply.roots
  }

  public func setRoots(_ roots: [String]) async throws -> [String] {
    let reply: Roots = try await call(.setRoots, Roots(roots: roots))
    return reply.roots
  }

  public func shutdown() async throws -> Done { try await call(.shutdown, Empty()) }

  public func call<Input: Encodable, Output: Decodable>(_ operation: OperationName, _ input: Input) async throws -> Output {
    // Builds, publishes and installs run inside one call, so it may legitimately take minutes.
    var request = URLRequest(url: baseURL.appending(path: "v1/\(operation.rawValue)"), timeoutInterval: 20 * 60)
    request.httpMethod = "POST"
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(input)
    return try await send(request)
  }

  public func events(after lastEventID: Int?) -> AsyncThrowingStream<ServerEvent, any Error> {
    // The daemon sends a heartbeat every 15 s, so a minute of silence means it is gone.
    var request = URLRequest(url: baseURL.appending(path: "v1/events"), timeoutInterval: 60)
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    if let lastEventID { request.setValue(String(lastEventID), forHTTPHeaderField: "Last-Event-ID") }

    return AsyncThrowingStream { [request, session] continuation in
      let task = Task {
        do {
          let (bytes, response) = try await session.bytes(for: request)
          if let error = await Self.failure(response, body: bytes) { throw error }
          var parser = EventStreamParser()
          let decoder = JSONDecoder()
          for try await byte in bytes {
            for message in parser.feed(CollectionOfOne(byte)) {
              continuation.yield(try decoder.decode(ServerEvent.self, from: Data(message.data.utf8)))
            }
          }
          continuation.finish()
        } catch let error as APIError {
          continuation.finish(throwing: error)
        } catch {
          continuation.finish(throwing: Task.isCancelled ? CancellationError() : APIError.unavailable(error.localizedDescription))
        }
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }

  private func send<Output: Decodable>(_ request: URLRequest) async throws -> Output {
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: request)
    } catch {
      throw APIError.unavailable(error.localizedDescription)
    }
    if let status = (response as? HTTPURLResponse)?.statusCode, !(200..<300).contains(status) {
      throw (try? JSONDecoder().decode(APIErrorBody.self, from: data))?.apiError
        ?? APIError.unavailable("it answered with HTTP \(status)")
    }
    do {
      return try JSONDecoder().decode(Output.self, from: data)
    } catch {
      // Something answered, but not devlink speaking this API.
      throw APIError.unavailable("another program answered on its port")
    }
  }

  private static func failure(_ response: URLResponse, body: URLSession.AsyncBytes) async -> APIError? {
    guard let status = (response as? HTTPURLResponse)?.statusCode, !(200..<300).contains(status) else { return nil }
    var data = Data()
    do { for try await byte in body { data.append(byte) } } catch {}
    return (try? JSONDecoder().decode(APIErrorBody.self, from: data))?.apiError
      ?? .unavailable("it answered with HTTP \(status)")
  }
}

private struct Empty: Encodable {}

/// Optional fields are left out rather than sent as null, which the daemon's schema rejects.
private struct RegisterInput: Encodable {
  let root: String
  let publishDir: String?
  let build: BuildCommand?
}

private struct RestoreInput: Encodable {
  let consumer: String
  let library: String?
  let force: Bool?
}

private struct SaveGroupInput: Encodable {
  let name: String
  let consumers: [String]
}

private struct WatchInput: Encodable {
  let library: String
  let enabled: Bool
}
