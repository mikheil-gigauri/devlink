import Darwin
import Foundation

/// dryfit's folder, shared with the CLI and the daemon: `~/.dryfit`, or `$DRYFIT_HOME` (ADR 0012).
public struct DryfitHome: Sendable, Equatable {
  public let root: URL

  public init(root: URL) {
    self.root = root
  }

  public static func locate(
    environment: [String: String] = ProcessInfo.processInfo.environment,
    home: URL = FileManager.default.homeDirectoryForCurrentUser
  ) -> DryfitHome {
    if let custom = environment["DRYFIT_HOME"], !custom.isEmpty { return DryfitHome(root: URL(filePath: custom)) }
    return DryfitHome(root: home.appending(path: ".dryfit"))
  }

  public var daemonInfo: URL { root.appending(path: "daemon.json") }
  public var token: URL { root.appending(path: "token") }
  public var log: URL { root.appending(path: "logs/daemon.log") }
}

/// What the running daemon writes about itself once it is listening.
struct DaemonInfo: Decodable {
  let pid: Int32
  let port: Int
}

public enum DaemonLookup: Sendable, Equatable {
  case running(DaemonClient, Health)
  case notRunning
  /// A daemon that speaks another API version: this app or dryfit needs updating.
  case incompatible(Health)

  public static func == (lhs: DaemonLookup, rhs: DaemonLookup) -> Bool {
    switch (lhs, rhs) {
    case (.running(let a, let x), .running(let b, let y)): a.baseURL == b.baseURL && x == y
    case (.notRunning, .notRunning): true
    case (.incompatible(let x), .incompatible(let y)): x == y
    default: false
    }
  }
}

/// Finds the daemon the way the CLI does: through `daemon.json`, trusting it only once `/v1/health`
/// reports the pid the file names, since a pid can be reused and a port taken by something else.
public struct DaemonLocator: Sendable {
  let home: DryfitHome
  let session: URLSession

  public init(home: DryfitHome, session: URLSession = .shared) {
    self.home = home
    self.session = session
  }

  public func locate() async -> DaemonLookup {
    guard
      let data = try? Data(contentsOf: home.daemonInfo),
      let info = try? JSONDecoder().decode(DaemonInfo.self, from: data),
      isAlive(info.pid),
      let token = readToken()
    else { return .notRunning }

    let client = DaemonClient(baseURL: URL(string: "http://127.0.0.1:\(info.port)/")!, token: token, session: session)
    guard let health = try? await client.health(), health.name == "dryfit", health.pid == info.pid else {
      return .notRunning
    }
    return health.apiVersion == supportedAPIVersion ? .running(client, health) : .incompatible(health)
  }

  private func readToken() -> String? {
    guard let text = try? String(contentsOf: home.token, encoding: .utf8) else { return nil }
    let token = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return token.count == 64 && token.allSatisfy(\.isHexDigit) ? token : nil
  }

  private func isAlive(_ pid: Int32) -> Bool {
    // EPERM: the process exists but belongs to someone else.
    kill(pid, 0) == 0 || errno == EPERM
  }
}
