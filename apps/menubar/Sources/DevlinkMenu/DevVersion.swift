import Foundation

/// devlink's dev versions (ADR 0004): `1.4.1-dev.20261118143201`, a release version plus a UTC stamp.
enum DevVersion {
  /// `1.4.1 · dev 14:32` in the user's time zone, or the version unchanged when it is not a dev version.
  static func describe(_ version: String, timeZone: TimeZone = .current) -> String {
    guard let (base, date) = parse(version) else { return version }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let parts = calendar.dateComponents([.hour, .minute], from: date)
    return String(format: "%@ · dev %02d:%02d", base, parts.hour ?? 0, parts.minute ?? 0)
  }

  static func parse(_ version: String) -> (base: String, date: Date)? {
    guard let match = version.firstMatch(of: /^(.+)[-.]dev\.(\d{14})$/) else { return nil }
    let stamp = String(match.2)
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "UTC")
    formatter.dateFormat = "yyyyMMddHHmmss"
    guard let date = formatter.date(from: stamp) else { return nil }
    return (String(match.1), date)
  }
}
