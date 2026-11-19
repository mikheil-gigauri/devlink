/// dryfit's release versions, `major.minor.patch`, compared to tell which of the app and the CLI is
/// older. Whatever follows `-` or `+` is ignored, so a dev build counts as the release it is based on.
enum ReleaseVersion {
  /// False when either is not a release version, so an unexpected version never asks for an update.
  static func isOlder(_ version: String, than other: String) -> Bool {
    guard let version = parts(version), let other = parts(other) else { return false }
    return version.lexicographicallyPrecedes(other)
  }

  static func parts(_ version: String) -> [Int]? {
    let base = version.split(whereSeparator: { $0 == "-" || $0 == "+" }).first ?? ""
    let numbers = base.split(separator: ".", omittingEmptySubsequences: false).map { Int($0) }
    guard numbers.count == 3, numbers.allSatisfy({ ($0 ?? -1) >= 0 }) else { return nil }
    return numbers.compactMap { $0 }
  }
}
