import Foundation

/// Answers requests from a per-test handler, so the client is tested without a server.
final class StubURLProtocol: URLProtocol, @unchecked Sendable {
  struct Reply: Sendable {
    var status = 200
    var chunks: [Data] = []
    var error: URLError?
  }

  private nonisolated(unsafe) static var handlers: [String: @Sendable (URLRequest) -> Reply] = [:]
  private nonisolated(unsafe) static var requests: [String: [URLRequest]] = [:]
  private static let lock = NSLock()

  /// A session whose requests go to `handler`; `id` keeps parallel tests apart.
  static func session(_ handler: @escaping @Sendable (URLRequest) -> Reply) -> (URLSession, () -> [URLRequest]) {
    let id = UUID().uuidString
    lock.withLock { handlers[id] = handler }
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [StubURLProtocol.self]
    configuration.httpAdditionalHeaders = ["X-Stub": id]
    return (URLSession(configuration: configuration), { lock.withLock { requests[id] ?? [] } })
  }

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    let id = request.value(forHTTPHeaderField: "X-Stub") ?? ""
    var recorded = request
    if recorded.httpBody == nil, let stream = request.httpBodyStream { recorded.httpBody = Data(reading: stream) }
    let handler = Self.lock.withLock {
      Self.requests[id, default: []].append(recorded)
      return Self.handlers[id]
    }
    let reply = handler?(recorded) ?? Reply(status: 500)
    if let error = reply.error {
      client?.urlProtocol(self, didFailWithError: error)
      return
    }
    let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: nil)!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    for chunk in reply.chunks { client?.urlProtocol(self, didLoad: chunk) }
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}
}

extension Data {
  init(reading stream: InputStream) {
    self.init()
    stream.open()
    defer { stream.close() }
    var buffer = [UInt8](repeating: 0, count: 4096)
    while stream.hasBytesAvailable {
      let count = stream.read(&buffer, maxLength: buffer.count)
      if count <= 0 { break }
      append(buffer, count: count)
    }
  }
}

extension StubURLProtocol.Reply {
  static func json(_ text: String, status: Int = 200) -> Self { Self(status: status, chunks: [Data(text.utf8)]) }
}
