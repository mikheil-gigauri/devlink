import Foundation

/// A failure the daemon reported, or `daemonUnavailable` when it could not be reached.
public struct APIError: Error, Sendable, Equatable, LocalizedError {
  public enum Code: String, CaseIterable, Sendable, Decodable {
    case invalidManifest = "invalid-manifest"
    case libraryNotFound = "library-not-found"
    case notAConsumer = "not-a-consumer"
    case packageManagerUndetected = "package-manager-undetected"
    case unsupportedPackageManager = "unsupported-package-manager"
    case buildFailed = "build-failed"
    case publishFailed = "publish-failed"
    case snapshotMissing = "snapshot-missing"
    case manifestDrifted = "manifest-drifted"
    case stateCorrupt = "state-corrupt"
    case registryFailed = "registry-failed"
    case libraryLinked = "library-linked"
    case consumerLinked = "consumer-linked"
    case groupNotFound = "group-not-found"
    case invalidGroup = "invalid-group"
    case invalidRequest = "invalid-request"
    case daemonStopping = "daemon-stopping"
    case invalidConfig = "invalid-config"
    case daemonFailed = "daemon-failed"
    case unauthorized
    case forbidden
    case notFound = "not-found"
    case payloadTooLarge = "payload-too-large"
    case `internal`
    /// Client side only: nothing answered, or something that is not dryfit did.
    case daemonUnavailable = "daemon-unavailable"

    /// A code a newer daemon may add reads as internal rather than failing to decode the error.
    public init(from decoder: any Decoder) throws {
      self = Code(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .internal
    }
  }

  public let code: Code
  public let message: String
  /// Captured command output (a failed build or install), when the daemon sent it.
  public let output: String?

  public init(code: Code, message: String, output: String? = nil) {
    self.code = code
    self.message = message
    self.output = output
  }

  public var errorDescription: String? { message }

  public static func unavailable(_ reason: String) -> APIError {
    APIError(code: .daemonUnavailable, message: "Could not reach dryfit: \(reason).")
  }
}

/// The body of every error reply: `{ "error": { code, message, details } }`.
public struct APIErrorBody: Decodable, Sendable {
  public struct Body: Decodable, Sendable {
    public let code: APIError.Code
    public let message: String
    public let details: Details?
  }

  public struct Details: Decodable, Sendable {
    public let output: String?
  }

  public let error: Body

  var apiError: APIError {
    APIError(code: error.code, message: error.message, output: error.details?.output)
  }
}
