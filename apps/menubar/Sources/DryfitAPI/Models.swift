import Foundation

/// The daemon API version this app was built against (`API_VERSION` in `src/daemon/api.ts`).
public let supportedAPIVersion = 1

/// Every operation the daemon serves as `POST /v1/<name>`. The contract test checks this against the
/// daemon's exported schema, so the two cannot drift apart.
public enum OperationName: String, CaseIterable, Sendable {
  case status, register, unregister, inspect, sync, watch, discover, link, restore
  case saveGroup, deleteGroup, linkGroup, restoreGroup, roots, setRoots, hiddenApps, hideApps, shutdown
}

public struct Health: Codable, Sendable, Equatable {
  public let name: String
  public let version: String
  public let apiVersion: Int
  public let pid: Int32
  public let registryUrl: String
  public let startedAt: String

  public init(name: String, version: String, apiVersion: Int, pid: Int32, registryUrl: String, startedAt: String) {
    self.name = name
    self.version = version
    self.apiVersion = apiVersion
    self.pid = pid
    self.registryUrl = registryUrl
    self.startedAt = startedAt
  }
}

public struct CommandSpec: Codable, Sendable, Equatable {
  public let command: String
  public let args: [String]
  public let cwd: String
}

public struct Library: Codable, Sendable, Equatable, Identifiable {
  public let name: String
  public let root: String
  public let publishDir: String
  public let build: CommandSpec?
  public let lastPublishedVersion: String?
  public let watch: Bool?

  public var id: String { name }
  public var isWatched: Bool { watch == true }

  public init(
    name: String, root: String, publishDir: String, build: CommandSpec? = nil,
    lastPublishedVersion: String? = nil, watch: Bool? = nil
  ) {
    self.name = name
    self.root = root
    self.publishDir = publishDir
    self.build = build
    self.lastPublishedVersion = lastPublishedVersion
    self.watch = watch
  }
}

public enum LinkStatus: String, Codable, Sendable, Equatable {
  case pending, installed, failed

  /// A status a newer daemon may add reads as pending rather than failing the whole status.
  public init(from decoder: any Decoder) throws {
    self = LinkStatus(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .pending
  }
}

public struct Link: Codable, Sendable, Equatable, Identifiable {
  public let library: String
  public let consumer: String
  public let status: LinkStatus
  public let installedVersion: String?
  /// Whether the consumer's pre-commit hook carries the commit guard (`guard` on the wire).
  public let guarded: Bool?

  public var id: String { "\(library)\u{0}\(consumer)" }

  enum CodingKeys: String, CodingKey {
    case library, consumer, status, installedVersion
    case guarded = "guard"
  }

  public init(
    library: String, consumer: String, status: LinkStatus, installedVersion: String? = nil,
    guarded: Bool? = nil
  ) {
    self.library = library
    self.consumer = consumer
    self.status = status
    self.installedVersion = installedVersion
    self.guarded = guarded
  }
}

public struct Group: Codable, Sendable, Equatable, Identifiable {
  public let name: String
  public let consumers: [String]

  public var id: String { name }

  public init(name: String, consumers: [String]) {
    self.name = name
    self.consumers = consumers
  }
}

public struct CoherenceWarning: Codable, Sendable, Equatable {
  public struct Version: Codable, Sendable, Equatable {
    public let consumer: String
    public let version: String

    public init(consumer: String, version: String) {
      self.consumer = consumer
      self.version = version
    }
  }

  public let group: String
  public let library: String
  public let versions: [Version]

  public init(group: String, library: String, versions: [Version]) {
    self.group = group
    self.library = library
    self.versions = versions
  }
}

public struct Job: Codable, Sendable, Equatable, Identifiable {
  public let id: Int
  public let label: String
  public let key: String?
  public let queuedAt: String
  public let startedAt: String?

  public init(id: Int, label: String, key: String? = nil, queuedAt: String, startedAt: String? = nil) {
    self.id = id
    self.label = label
    self.key = key
    self.queuedAt = queuedAt
    self.startedAt = startedAt
  }
}

public struct Jobs: Codable, Sendable, Equatable {
  public let running: Job?
  public let queued: [Job]

  public init(running: Job? = nil, queued: [Job] = []) {
    self.running = running
    self.queued = queued
  }
}

/// Everything the menu shows, in one call.
public struct Status: Codable, Sendable, Equatable {
  public let daemon: Health
  public let libraries: [Library]
  public let links: [Link]
  public let groups: [Group]
  public let warnings: [CoherenceWarning]
  public let jobs: Jobs

  public init(
    daemon: Health, libraries: [Library] = [], links: [Link] = [], groups: [Group] = [],
    warnings: [CoherenceWarning] = [], jobs: Jobs = Jobs()
  ) {
    self.daemon = daemon
    self.libraries = libraries
    self.links = links
    self.groups = groups
    self.warnings = warnings
    self.jobs = jobs
  }
}

/// How a library is built: a command run in its folder.
public struct BuildCommand: Codable, Sendable, Equatable {
  public let command: String
  public let args: [String]

  public init(command: String, args: [String]) {
    self.command = command
    self.args = args
  }

  /// The command as one line, the way it would be typed.
  public var line: String { ([command] + args).map { $0.contains(" ") ? "\"\($0)\"" : $0 }.joined(separator: " ") }

  /// Splits a typed line into a command and its arguments, honouring double quotes. Nil when empty.
  public init?(line: String) {
    var words: [String] = []
    var word = ""
    var quoted = false
    var started = false
    for character in line {
      if character == "\"" {
        quoted.toggle()
        started = true
      } else if character.isWhitespace, !quoted {
        if started { words.append(word) }
        word = ""
        started = false
      } else {
        word.append(character)
        started = true
      }
    }
    if started { words.append(word) }
    guard let command = words.first else { return nil }
    self.init(command: command, args: Array(words.dropFirst()))
  }
}

/// What adding a folder as a library would do, before it is added.
public struct LibraryPreview: Codable, Sendable, Equatable {
  public let name: String
  public let version: String
  public let root: String
  /// "nx", "angular", "npm-script" or "none".
  public let detected: String
  public let publishDir: String
  public let build: BuildCommand?
  public let registered: Bool

  public init(
    name: String, version: String, root: String, detected: String, publishDir: String, build: BuildCommand?,
    registered: Bool
  ) {
    self.name = name
    self.version = version
    self.root = root
    self.detected = detected
    self.publishDir = publishDir
    self.build = build
    self.registered = registered
  }
}

/// The folders searched for projects.
public struct Roots: Codable, Sendable, Equatable {
  public let roots: [String]

  public init(roots: [String]) { self.roots = roots }
}

/// Apps the user hid: the daemon leaves them out of `discover` until they are shown again.
public struct HiddenApps: Codable, Sendable, Equatable {
  public let hiddenApps: [String]

  public init(hiddenApps: [String]) { self.hiddenApps = hiddenApps }
}

public struct RegisterResult: Codable, Sendable, Equatable {
  public let library: Library
  public let detected: String

  public init(library: Library, detected: String) {
    self.library = library
    self.detected = detected
  }
}

public struct InstallOutcome: Codable, Sendable, Equatable {
  public let consumer: String
  public let ok: Bool
  public let version: String
  public let clearedCaches: [String]?
  public let output: String?

  public init(consumer: String, ok: Bool, version: String, clearedCaches: [String]? = nil, output: String? = nil) {
    self.consumer = consumer
    self.ok = ok
    self.version = version
    self.clearedCaches = clearedCaches
    self.output = output
  }
}

public struct SyncResult: Codable, Sendable, Equatable {
  public let version: String
  public let installs: [InstallOutcome]

  public init(version: String, installs: [InstallOutcome]) {
    self.version = version
    self.installs = installs
  }
}

public struct DiscoveredConsumer: Codable, Sendable, Equatable, Identifiable {
  public struct PackageManager: Codable, Sendable, Equatable {
    public let ok: Bool
    public let name: String?
    public let reason: String?
  }

  public struct Dependency: Codable, Sendable, Equatable {
    public let name: String
    public let field: String
    public let range: String

    public init(name: String, field: String, range: String) {
      self.name = name
      self.field = field
      self.range = range
    }
  }

  public let root: String
  public let name: String?
  public let packageManager: PackageManager
  public let libraries: [Dependency]

  public var id: String { root }

  public init(root: String, name: String?, libraries: [Dependency], packageManager: PackageManager) {
    self.root = root
    self.name = name
    self.libraries = libraries
    self.packageManager = packageManager
  }
}

extension DiscoveredConsumer.Dependency {
  public init(name: String, range: String) {
    self.init(name: name, field: "dependencies", range: range)
  }
}

extension DiscoveredConsumer.PackageManager {
  public init(name: String?) {
    self.init(ok: name != nil, name: name, reason: name == nil ? "No lockfile found" : nil)
  }

  public static let npm = Self(ok: true, name: "npm", reason: nil)
  public static let pnpm = Self(ok: true, name: "pnpm", reason: nil)
}

public struct LinkResult: Codable, Sendable, Equatable {
  public enum GuardOutcome: String, Codable, Sendable {
    case installed, declined
    case notARepo = "not-a-repo"
  }

  public let link: Link
  /// Whether the commit guard went in (`guard` on the wire).
  public let guardOutcome: GuardOutcome

  enum CodingKeys: String, CodingKey {
    case link
    case guardOutcome = "guard"
  }
}

public struct RestoreResult: Codable, Sendable, Equatable {
  public let ok: Bool
  /// The clean install's output, when it failed after the files were restored.
  public let output: String?

  public init(ok: Bool, output: String? = nil) {
    self.ok = ok
    self.output = output
  }
}

public struct GroupMemberOutcome: Codable, Sendable, Equatable {
  public enum Outcome: String, Codable, Sendable {
    case done, skipped, failed
  }

  public let consumer: String
  public let status: Outcome
  public let message: String?

  public init(consumer: String, status: Outcome, message: String? = nil) {
    self.consumer = consumer
    self.status = status
    self.message = message
  }
}

public struct Done: Codable, Sendable, Equatable {
  public let ok: Bool

  public init(ok: Bool = true) { self.ok = ok }
}
