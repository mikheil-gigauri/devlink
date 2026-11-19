import Foundation

/// One event from `GET /v1/events`: what happened, with a resumable id.
public struct ServerEvent: Decodable, Sendable, Equatable {
  public let id: Int
  public let at: String
  public let kind: Kind

  public enum Kind: Sendable, Equatable {
    case buildStarted(library: String)
    case buildSucceeded(library: String)
    case buildFailed(library: String, output: String)
    case publishSucceeded(library: String, version: String)
    case installStarted(library: String, consumer: String, version: String)
    case installSucceeded(library: String, consumer: String, version: String)
    case installFailed(library: String, consumer: String, version: String, output: String)
    case cachesCleared(consumer: String, paths: [String])
    case consumerRestored(consumer: String, ok: Bool)
    case jobQueued(Job)
    case jobStarted(Job)
    case jobFinished(Job, error: JobError?)
    case libraryChanged(library: String)
    case watchFailed(library: String, message: String)
    case stateChanged
    /// An event this app does not know yet, from a newer daemon. It is ignored, not an error.
    case unknown(type: String)

    /// The wire name, for known events.
    public var type: String? {
      switch self {
      case .buildStarted: "build:started"
      case .buildSucceeded: "build:succeeded"
      case .buildFailed: "build:failed"
      case .publishSucceeded: "publish:succeeded"
      case .installStarted: "install:started"
      case .installSucceeded: "install:succeeded"
      case .installFailed: "install:failed"
      case .cachesCleared: "caches:cleared"
      case .consumerRestored: "consumer:restored"
      case .jobQueued: "job:queued"
      case .jobStarted: "job:started"
      case .jobFinished: "job:finished"
      case .libraryChanged: "library:changed"
      case .watchFailed: "watch:failed"
      case .stateChanged: "state:changed"
      case .unknown: nil
      }
    }
  }

  public struct JobError: Codable, Sendable, Equatable {
    public let code: String
    public let message: String

    public init(code: String, message: String) {
      self.code = code
      self.message = message
    }
  }

  /// Every event type this app understands, in the daemon's order.
  public static let knownTypes = [
    "build:started", "build:succeeded", "build:failed", "publish:succeeded", "install:started",
    "install:succeeded", "install:failed", "caches:cleared", "consumer:restored", "job:queued",
    "job:started", "job:finished", "library:changed", "watch:failed", "state:changed",
  ]

  public init(id: Int, at: String = "", kind: Kind) {
    self.id = id
    self.at = at
    self.kind = kind
  }

  enum CodingKeys: String, CodingKey {
    case id, at, type, library, consumer, version, output, paths, ok, job, error, message
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(Int.self, forKey: .id)
    at = try c.decode(String.self, forKey: .at)
    let type = try c.decode(String.self, forKey: .type)
    func string(_ key: CodingKeys) throws -> String { try c.decode(String.self, forKey: key) }

    kind =
      switch type {
      case "build:started": .buildStarted(library: try string(.library))
      case "build:succeeded": .buildSucceeded(library: try string(.library))
      case "build:failed": .buildFailed(library: try string(.library), output: try string(.output))
      case "publish:succeeded": .publishSucceeded(library: try string(.library), version: try string(.version))
      case "install:started":
        .installStarted(library: try string(.library), consumer: try string(.consumer), version: try string(.version))
      case "install:succeeded":
        .installSucceeded(library: try string(.library), consumer: try string(.consumer), version: try string(.version))
      case "install:failed":
        .installFailed(
          library: try string(.library), consumer: try string(.consumer), version: try string(.version),
          output: try string(.output))
      case "caches:cleared":
        .cachesCleared(consumer: try string(.consumer), paths: try c.decode([String].self, forKey: .paths))
      case "consumer:restored":
        .consumerRestored(consumer: try string(.consumer), ok: try c.decode(Bool.self, forKey: .ok))
      case "job:queued": .jobQueued(try c.decode(Job.self, forKey: .job))
      case "job:started": .jobStarted(try c.decode(Job.self, forKey: .job))
      case "job:finished":
        .jobFinished(try c.decode(Job.self, forKey: .job), error: try c.decodeIfPresent(JobError.self, forKey: .error))
      case "library:changed": .libraryChanged(library: try string(.library))
      case "watch:failed": .watchFailed(library: try string(.library), message: try string(.message))
      case "state:changed": .stateChanged
      default: .unknown(type: type)
      }
  }
}
