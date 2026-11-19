import Foundation
import Testing

@testable import DevlinkAPI

@Suite struct DaemonClientTests {
  let base = URL(string: "http://127.0.0.1:4875/")!
  let token = String(repeating: "a", count: 64)
  let health = #"{"name":"devlink","version":"0.1.0","apiVersion":1,"pid":42,"registryUrl":"http://127.0.0.1:4874/","startedAt":"2026-11-18T09:00:00.000Z"}"#

  @Test func readsHealthWithoutSendingTheToken() async throws {
    let (session, requests) = StubURLProtocol.session { _ in .json(health) }
    let client = DaemonClient(baseURL: base, token: token, session: session)

    let reply = try await client.health()

    #expect(reply.pid == 42)
    #expect(requests().first?.url?.absoluteString == "http://127.0.0.1:4875/v1/health")
    #expect(requests().first?.value(forHTTPHeaderField: "Authorization") == nil)
  }

  @Test func postsOperationsWithTheTokenAndATypedBody() async throws {
    let (session, requests) = StubURLProtocol.session { _ in
      .json(#"{"link":{"library":"@acme/ui","consumer":"/r/shop","status":"pending"},"guard":"installed"}"#)
    }
    let client = DaemonClient(baseURL: base, token: token, session: session)

    let result = try await client.link(library: "@acme/ui", consumer: "/r/shop")

    let request = try #require(requests().first)
    #expect(result.guardOutcome == .installed)
    #expect(request.httpMethod == "POST")
    #expect(request.url?.path == "/v1/link")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer \(token)")
    let body = try JSONSerialization.jsonObject(with: try #require(request.httpBody)) as? [String: String]
    #expect(body == ["library": "@acme/ui", "consumer": "/r/shop"])
  }

  @Test func turnsAnErrorReplyIntoAnAPIErrorWithItsOutput() async throws {
    let (session, _) = StubURLProtocol.session { _ in
      .json(#"{"error":{"code":"build-failed","message":"Building @acme/ui failed","details":{"output":"TS2304"}}}"#, status: 422)
    }
    let client = DaemonClient(baseURL: base, token: token, session: session)

    await #expect(throws: APIError(code: .buildFailed, message: "Building @acme/ui failed", output: "TS2304")) {
      try await client.sync(library: "@acme/ui")
    }
  }

  @Test func reportsNoAnswerOrAStrangerOnThePortAsUnavailable() async throws {
    let (refused, _) = StubURLProtocol.session { _ in .init(error: URLError(.cannotConnectToHost)) }
    let (stranger, _) = StubURLProtocol.session { _ in .json("<html>hello</html>") }

    for session in [refused, stranger] {
      let client = DaemonClient(baseURL: base, token: token, session: session)
      await #expect { try await client.status() } throws: { ($0 as? APIError)?.code == .daemonUnavailable }
    }
  }

  @Test func streamsEventsResumingAfterTheLastIDItSaw() async throws {
    let stream = """
      : devlink events

      id: 8
      data: {"id":8,"at":"t","type":"build:started","library":"@acme/ui"}

      id: 9
      data: {"id":9,"at":"t","type":"something:new"}


      """
    let (session, requests) = StubURLProtocol.session { _ in
      let bytes = Data(stream.utf8)
      return .init(chunks: [bytes.prefix(30), bytes.dropFirst(30)].map { Data($0) })
    }
    let client = DaemonClient(baseURL: base, token: token, session: session)

    var received: [ServerEvent] = []
    for try await event in client.events(after: 7) { received.append(event) }

    #expect(received.map(\.kind) == [.buildStarted(library: "@acme/ui"), .unknown(type: "something:new")])
    #expect(requests().first?.value(forHTTPHeaderField: "Last-Event-ID") == "7")
    #expect(requests().first?.value(forHTTPHeaderField: "Authorization") == "Bearer \(token)")
  }
}
