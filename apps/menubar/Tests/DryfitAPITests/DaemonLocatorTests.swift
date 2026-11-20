import Foundation
import Testing

@testable import DryfitAPI

/// A folder that is deleted when the last test holding it ends.
final class TemporaryFolder: Sendable {
  let url = FileManager.default.temporaryDirectory.appending(path: "dryfit-locator-\(UUID().uuidString)")

  init() throws { try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true) }

  deinit { try? FileManager.default.removeItem(at: url) }
}

/// Outside the suite: StubURLProtocol keeps its handlers for the whole run, and a handler that called a
/// method would keep the suite, and its folder, alive with it.
private func health(pid: Int32, apiVersion: Int = 1, name: String = "dryfit") -> StubURLProtocol.Reply {
  .json(#"{"name":"\#(name)","version":"0.1.0","apiVersion":\#(apiVersion),"pid":\#(pid),"registryUrl":"r","startedAt":"s"}"#)
}

@Suite struct DaemonLocatorTests {
  let folder: TemporaryFolder
  var root: URL { folder.url }
  let home: DryfitHome

  init() throws {
    folder = try TemporaryFolder()
    home = DryfitHome(root: folder.url)
    try String(repeating: "b", count: 64).appending("\n").write(to: home.token, atomically: true, encoding: .utf8)
  }

  func describeDaemon(pid: Int32, port: Int = 4875) throws {
    let info = #"{"pid":\#(pid),"port":\#(port),"version":"0.1.0","registryUrl":"","startedAt":""}"#
    try info.write(to: home.daemonInfo, atomically: true, encoding: .utf8)
  }

  @Test func findsItInDryfitHomeOrTheDefaultFolder() {
    #expect(DryfitHome.locate(environment: [:], home: URL(filePath: "/Users/me")).root.path == "/Users/me/.dryfit")
    #expect(DryfitHome.locate(environment: ["DRYFIT_HOME": "/tmp/dl"], home: URL(filePath: "/Users/me")).root.path == "/tmp/dl")
  }

  @Test func connectsToTheDaemonTheRecordDescribes() async throws {
    let pid = ProcessInfo.processInfo.processIdentifier
    try describeDaemon(pid: pid, port: 51234)
    let (session, requests) = StubURLProtocol.session { _ in health(pid: pid) }

    let lookup = await DaemonLocator(home: home, session: session).locate()

    guard case .running(let client, let found) = lookup else { Issue.record("not found: \(lookup)"); return }
    #expect(found.pid == pid)
    #expect(client.baseURL.absoluteString == "http://127.0.0.1:51234/")
    #expect(requests().map(\.url?.path) == ["/v1/health"])
  }

  @Test func reportsNotRunningWithoutARecordOrWhenItsProcessIsGone() async throws {
    let (session, requests) = StubURLProtocol.session { _ in health(pid: 1) }
    let locator = DaemonLocator(home: home, session: session)
    #expect(await locator.locate() == .notRunning)

    try describeDaemon(pid: Int32.max - 1)
    #expect(await locator.locate() == .notRunning)
    #expect(requests().isEmpty)
  }

  @Test func doesNotTrustAProcessWhoseHealthNamesAnotherPid() async throws {
    try describeDaemon(pid: ProcessInfo.processInfo.processIdentifier)
    let (session, _) = StubURLProtocol.session { _ in health(pid: 1) }

    #expect(await DaemonLocator(home: home, session: session).locate() == .notRunning)
  }

  @Test func refusesADaemonSpeakingAnotherAPIVersion() async throws {
    let pid = ProcessInfo.processInfo.processIdentifier
    try describeDaemon(pid: pid)
    let (session, _) = StubURLProtocol.session { _ in health(pid: pid, apiVersion: 2) }

    guard case .incompatible(let found) = await DaemonLocator(home: home, session: session).locate() else {
      Issue.record("expected incompatible")
      return
    }
    #expect(found.apiVersion == 2)
  }
}

@Suite struct DaemonLauncherTests {
  actor Commands {
    var ran: [[String]] = []
    var replies: [Int32]
    init(replies: [Int32]) { self.replies = replies }
    func run(_ command: [String]) -> CommandOutput {
      ran.append(command)
      return CommandOutput(exitCode: replies.isEmpty ? 0 : replies.removeFirst(), output: "zsh: command not found: dryfit")
    }
  }

  func launcher(agentInstalled: Bool, _ commands: Commands) -> DaemonLauncher {
    DaemonLauncher(
      agentInstalled: { agentInstalled }, shell: "/bin/zsh", userID: 501,
      run: { command, _ in await commands.run(command) })
  }

  @Test func kicksTheLaunchdAgentWhenItIsInstalled() async throws {
    let commands = Commands(replies: [0])

    try await launcher(agentInstalled: true, commands).start()

    #expect(await commands.ran == [["/bin/launchctl", "kickstart", "gui/501/dev.dryfit.daemon"]])
  }

  @Test func otherwiseRunsTheCLIFromALoginShellSoNodeIsOnThePath() async throws {
    let commands = Commands(replies: [1, 0])

    try await launcher(agentInstalled: true, commands).start()

    #expect(await commands.ran.last == ["/bin/zsh", "-l", "-c", "dryfit daemon start"])
  }

  @Test func triesAnInteractiveShellToo_whereNvmUsuallySetsThePath() async throws {
    let commands = Commands(replies: [127, 0])

    try await launcher(agentInstalled: false, commands).start()

    #expect(await commands.ran.last == ["/bin/zsh", "-l", "-i", "-c", "dryfit daemon start"])
  }

  @Test func explainsWhenNoShellCanFindDryfit() async throws {
    let commands = Commands(replies: [127, 127])

    await #expect(throws: DaemonLauncher.Failure.cliNotFound) {
      try await launcher(agentInstalled: false, commands).start()
    }
    #expect(await commands.ran.count == 2)
  }

  @Test func runsTheCommandDRYFIT_CLINamesInsteadOfDryfit() async throws {
    let commands = Commands(replies: [0])

    try await launcher(agentInstalled: false, commands).start(environment: ["DRYFIT_CLI": "node /src/dryfit.mjs"])

    #expect(await commands.ran == [["/bin/zsh", "-l", "-c", "node /src/dryfit.mjs daemon start"]])
  }

  @Test func installsTheCLIWithNpm_andSaysSoWhenNpmIsMissing() async throws {
    let installed = Commands(replies: [0])
    try await launcher(agentInstalled: false, installed).installCLI(environment: [:])
    #expect(await installed.ran == [["/bin/zsh", "-l", "-c", "npm install --global @dryfit/cli"]])

    let missing = Commands(replies: [127, 127])
    await #expect(throws: DaemonLauncher.Failure.self) {
      try await launcher(agentInstalled: false, missing).installCLI(environment: [:])
    }
  }

  @Test func updatesTheCLIAskingTheRegistryAgain_thenRestartsTheDaemon() async throws {
    let commands = Commands(replies: [0])
    try await launcher(agentInstalled: false, commands).updateCLI(environment: [:])
    #expect(
      await commands.ran == [
        ["/bin/zsh", "-l", "-c", "npm install --global --prefer-online @dryfit/cli@latest && dryfit daemon restart"]
      ])
  }

  @Test func explainsWhenNpmMayNotWriteToItsGlobalFolder() async {
    let denied = DaemonLauncher(
      agentInstalled: { false }, shell: "/bin/zsh", userID: 501,
      run: { _, _ in CommandOutput(exitCode: 243, output: "npm error code EACCES\nnpm error syscall mkdir") })

    do {
      try await denied.installCLI(environment: [:])
      Issue.record("installing should have failed")
    } catch let DaemonLauncher.Failure.failed(output) {
      #expect(output.contains("Terminal"))
      #expect(output.contains(DaemonLauncher.installCommand))
    } catch {
      Issue.record("unexpected \(error)")
    }
  }

  @Test func runsARealCommandWithLargeOutputWithoutBlocking() async {
    let result = await DaemonLauncher.runProcess(["/bin/sh", "-c", "yes dryfit | head -c 200000; exit 3"], environment: [:])

    #expect(result.exitCode == 3)
    #expect(result.output.count == 200_000)
  }
}
