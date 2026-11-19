import Foundation

public struct CommandOutput: Sendable, Equatable {
  public let exitCode: Int32
  public let output: String

  public init(exitCode: Int32, output: String) {
    self.exitCode = exitCode
    self.output = output
  }
}

/// Starts the daemon when the user asks (ADR 0013), never on its own. The launchd agent is used when
/// `devlink daemon install` set one up. Otherwise the CLI runs from a login shell, because an app
/// started from Finder lacks the PATH that finds `node` under nvm or Homebrew.
public struct DaemonLauncher: Sendable {
  public enum Failure: Error, Equatable, LocalizedError {
    /// The shell could not find `devlink`.
    case cliNotFound
    case failed(output: String)

    public var errorDescription: String? {
      switch self {
      case .cliNotFound: "Your shell could not find the devlink command. Install it, then run `devlink daemon start` once."
      case .failed(let output): output.isEmpty ? "devlink could not start." : output
      }
    }
  }

  public static let agentLabel = "dev.devlink.daemon"

  private let agentInstalled: @Sendable () -> Bool
  private let shell: String
  private let userID: uid_t
  private let run: @Sendable ([String], [String: String]) async -> CommandOutput

  public init(
    agentInstalled: @escaping @Sendable () -> Bool = {
      FileManager.default.fileExists(
        atPath: FileManager.default.homeDirectoryForCurrentUser
          .appending(path: "Library/LaunchAgents/\(DaemonLauncher.agentLabel).plist").path)
    },
    shell: String = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh",
    userID: uid_t = getuid(),
    run: @escaping @Sendable ([String], [String: String]) async -> CommandOutput = DaemonLauncher.runProcess
  ) {
    self.agentInstalled = agentInstalled
    self.shell = shell
    self.userID = userID
    self.run = run
  }

  public func start(environment: [String: String] = ProcessInfo.processInfo.environment) async throws {
    if agentInstalled() {
      let kick = await run(["/bin/launchctl", "kickstart", "gui/\(userID)/\(Self.agentLabel)"], environment)
      if kick.exitCode == 0 { return }
    }
    var result = await run([shell, "-l", "-c", "devlink daemon start"], environment)
    // nvm and friends are usually set up in .zshrc, which only interactive shells read.
    if result.exitCode == 127 { result = await run([shell, "-l", "-i", "-c", "devlink daemon start"], environment) }
    switch result.exitCode {
    case 0: return
    case 127: throw Failure.cliNotFound
    default: throw Failure.failed(output: result.output.trimmingCharacters(in: .whitespacesAndNewlines))
    }
  }

  /// Runs a command to completion, giving up after a minute, and returns its combined output.
  @Sendable public static func runProcess(_ command: [String], environment: [String: String]) async -> CommandOutput {
    await withCheckedContinuation { continuation in
      let process = Process()
      let pipe = Pipe()
      process.executableURL = URL(filePath: command[0])
      process.arguments = Array(command.dropFirst())
      process.environment = environment
      process.standardInput = FileHandle.nullDevice  // an interactive shell must not wait for input
      process.standardOutput = pipe
      process.standardError = pipe
      // Drained as it arrives: a full pipe would block the command until the timeout.
      let collected = Collected()
      pipe.fileHandleForReading.readabilityHandler = { handle in collected.append(handle.availableData) }
      process.terminationHandler = { finished in
        pipe.fileHandleForReading.readabilityHandler = nil
        collected.append(pipe.fileHandleForReading.readDataToEndOfFile())
        continuation.resume(returning: CommandOutput(exitCode: finished.terminationStatus, output: collected.text))
      }
      do {
        try process.run()
        DispatchQueue.global().asyncAfter(deadline: .now() + 60) { if process.isRunning { process.terminate() } }
      } catch {
        continuation.resume(returning: CommandOutput(exitCode: 127, output: error.localizedDescription))
      }
    }
  }
}

private final class Collected: @unchecked Sendable {
  private let lock = NSLock()
  private var data = Data()

  func append(_ chunk: Data) { lock.withLock { data.append(chunk) } }
  var text: String { lock.withLock { String(decoding: data, as: UTF8.self) } }
}
