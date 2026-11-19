import DevlinkAPI
import Foundation
import Testing

@testable import DevlinkMenu

/// The menu's full cycle against a real daemon: start, link, watch, edit, restore. Opt-in, since it
/// needs the built CLI and a sandbox; `npm run menubar:e2e` from the repository root sets it up.
///
///   DEVLINK_E2E_CLI       path to dist/devlink.mjs
///   DEVLINK_HOME          a throwaway devlink home, initialised with the repos folder as a root
///   DEVLINK_E2E_LIBRARY   a registered library's folder (package @acme/ui, built by `npm run build`)
///   DEVLINK_E2E_CONSUMER  a git repo depending on @acme/ui
private let env = ProcessInfo.processInfo.environment
private let enabled = env["DEVLINK_E2E_CLI"] != nil

@MainActor @Suite(.enabled(if: enabled, "set DEVLINK_E2E_CLI to run"), .serialized)
struct EndToEndTests {
  @Test func aFullCycleFromTheMenu() async throws {
    let cli = env["DEVLINK_E2E_CLI"]!
    let library = URL(filePath: env["DEVLINK_E2E_LIBRARY"]!)
    let consumer = env["DEVLINK_E2E_CONSUMER"]!
    let home = DevlinkHome.locate()
    let notifier = RecordingNotifier()
    let model = MenuModel(
      connect: {
        switch await DaemonLocator(home: home).locate() {
        case .running(let client, let health): .running(client, health)
        case .notRunning: .notRunning
        case .incompatible(let health): .incompatible(health)
        }
      },
      launch: {
        let result = await DaemonLauncher.runProcess(
          [try which("node"), cli, "daemon", "start"], environment: env)
        if result.exitCode != 0 { throw DaemonLauncher.Failure.failed(output: result.output) }
      },
      notifier: notifier)
    let loop = Task { await model.run() }
    defer { loop.cancel() }

    // Offline until asked, then started from the menu.
    try await until("offline") { model.connection == .offline }
    await model.startDaemon()
    try await until("online") { model.connection == .online }
    #expect(model.libraries.map(\.library.name) == ["@acme/ui"])

    // Link into the consumer the menu discovered.
    await model.discoverConsumers()
    #expect(model.linkCandidates(for: "@acme/ui").map(\.root) == [consumer])
    await model.link("@acme/ui", into: consumer)
    #expect(model.actionError == nil)
    // Never published yet, so the link waits for the first sync.
    #expect(model.libraries.first?.links.first?.status == .pending)
    await model.sync("@acme/ui")
    #expect(model.actionError == nil)
    try await until("installed", timeout: 180) {
      model.libraries.first?.links.first?.status == .installed
    }
    let installed = URL(filePath: consumer).appending(path: "node_modules/@acme/ui/index.js")
    let first = try String(contentsOf: installed, encoding: .utf8)

    // Watch, edit the library, and the consumer gets the change.
    await model.setWatch("@acme/ui", enabled: true)
    #expect(model.libraries.first?.library.isWatched == true)
    let source = library.appending(path: "index.js")
    try "module.exports = 'edited at \(Date.now.timeIntervalSince1970)';\n".write(
      to: source, atomically: true, encoding: .utf8)
    try await until("edit installed", timeout: 180) {
      (try? String(contentsOf: installed, encoding: .utf8)).map { $0 != first && $0.contains("edited") } == true
    }
    #expect(notifier.posted.isEmpty)

    // Stop watching before restoring, so nothing reinstalls behind restore.
    await model.setWatch("@acme/ui", enabled: false)

    // Restore puts the consumer back as it was.
    await model.restore(consumer)
    #expect(model.actionError == nil)
    try await until("restored") { model.libraries.first?.links.isEmpty == true }
    let manifest = try String(contentsOf: URL(filePath: consumer).appending(path: "package.json"), encoding: .utf8)
    #expect(manifest.contains("file:../ui"))
  }
}

private func which(_ tool: String) throws -> String {
  for folder in (env["PATH"] ?? "").split(separator: ":") {
    let path = "\(folder)/\(tool)"
    if FileManager.default.isExecutableFile(atPath: path) { return path }
  }
  throw DaemonLauncher.Failure.cliNotFound
}

@MainActor private func until(
  _ what: String, timeout: Double = 30, _ condition: @MainActor () -> Bool
) async throws {
  let deadline = Date.now + timeout
  while !condition() {
    guard Date.now < deadline else {
      Issue.record("Timed out waiting for \(what)")
      throw CancellationError()
    }
    try await Task.sleep(for: .milliseconds(100))
  }
}
