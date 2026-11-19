import Foundation
import Testing

@testable import DevlinkAPI

/// The contract the daemon exports (ADR 0013): every sample it sends must decode, and the operations,
/// error codes and event types this app knows must be the ones it declares.
@Suite struct ContractTests {
  static let contract = URL(filePath: #filePath)
    .deletingLastPathComponent()
    .appending(path: "../../../../packages/devlink/api/")
    .standardizedFileURL

  struct Schema: Decodable {
    let apiVersion: Int
    let operations: [String: Operation]
    let errorCodes: [String]
    let eventTypes: [String]
    struct Operation: Decodable { let method: String; let path: String }
  }

  struct Fixtures: Decodable {
    let health: Health
    let outputs: Outputs
    let events: [ServerEvent]
    let errorBody: APIErrorBody

    struct Outputs: Decodable {
      let status: Status
      let register: RegisterResult
      let unregister: Done
      let inspect: LibraryPreview
      let sync: SyncResult
      let watch: Library
      let discover: [DiscoveredConsumer]
      let link: LinkResult
      let restore: RestoreResult
      let saveGroup: Group
      let deleteGroup: Done
      let linkGroup: [GroupMemberOutcome]
      let restoreGroup: [GroupMemberOutcome]
      let roots: Roots
      let setRoots: Roots
      let shutdown: Done
    }
  }

  func load<T: Decodable>(_ type: T.Type, from file: String) throws -> T {
    try JSONDecoder().decode(T.self, from: Data(contentsOf: Self.contract.appending(path: file)))
  }

  @Test func speaksTheDaemonsAPIVersion() throws {
    #expect(try load(Schema.self, from: "schema.json").apiVersion == supportedAPIVersion)
  }

  @Test func knowsExactlyTheDaemonsOperations() throws {
    let schema = try load(Schema.self, from: "schema.json")

    #expect(Set(schema.operations.keys) == Set(OperationName.allCases.map(\.rawValue)))
    for (name, operation) in schema.operations {
      #expect(operation.method == "POST")
      #expect(operation.path == "/v1/\(name)")
    }
  }

  @Test func knowsEveryErrorCodeAndEventType() throws {
    let schema = try load(Schema.self, from: "schema.json")

    #expect(Set(schema.errorCodes) == Set(APIError.Code.allCases.map(\.rawValue)).subtracting(["daemon-unavailable"]))
    #expect(Set(schema.eventTypes) == Set(ServerEvent.knownTypes))
  }

  @Test func decodesEverySampleTheDaemonSends() throws {
    let fixtures = try load(Fixtures.self, from: "fixtures.json")
    let status = fixtures.outputs.status

    #expect(status.daemon == fixtures.health)
    #expect(status.libraries.first?.build?.args == ["build", "acme-ui"])
    #expect(status.links.map(\.status) == [.installed, .failed])
    #expect(status.links.first?.guarded == true)
    #expect(status.jobs.running?.label == "sync @acme/ui")
    #expect(status.warnings.first?.versions.count == 2)
    #expect(fixtures.outputs.sync.installs.map(\.ok) == [true, false])
    #expect(fixtures.outputs.discover.last?.name == nil)
    #expect(fixtures.outputs.discover.last?.packageManager.ok == false)
    #expect(fixtures.outputs.link.guardOutcome == .installed)
    #expect(fixtures.outputs.restore == RestoreResult(ok: false, output: "npm error network request failed"))
    #expect(fixtures.outputs.linkGroup.map(\.status) == [.done, .failed])
    #expect(fixtures.outputs.inspect.build?.args == ["build", "ui"])
    #expect(fixtures.outputs.inspect.registered == false)
    #expect(fixtures.outputs.setRoots.roots.count == 2)
    #expect(fixtures.errorBody.error.code == .manifestDrifted)
  }

  @Test func decodesEveryEventIntoItsOwnCase() throws {
    let events = try load(Fixtures.self, from: "fixtures.json").events

    #expect(events.map(\.id) == Array(1...events.count))
    #expect(!events.contains { if case .unknown = $0.kind { true } else { false } })
    #expect(events.compactMap(\.kind.type) == ServerEvent.knownTypes)
  }
}
