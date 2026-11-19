// swift-tools-version: 6.2
import PackageDescription

/// The dryfit menu bar app (ADR 0010, ADR 0013): a pure client of the daemon's API.
let package = Package(
  name: "DryfitMenuBar",
  platforms: [.macOS(.v26)],
  products: [
    .executable(name: "Dryfit", targets: ["Dryfit"])
  ],
  targets: [
    /// API models, the HTTP and event-stream client, and finding and starting the daemon. No UI.
    .target(name: "DryfitAPI"),
    /// The view model and views.
    .target(
      name: "DryfitMenu",
      dependencies: ["DryfitAPI"],
      swiftSettings: [.defaultIsolation(MainActor.self)]
    ),
    .executableTarget(
      name: "Dryfit",
      dependencies: ["DryfitMenu"],
      swiftSettings: [.defaultIsolation(MainActor.self)]
    ),
    .testTarget(name: "DryfitAPITests", dependencies: ["DryfitAPI"]),
    .testTarget(
      name: "DryfitMenuTests",
      dependencies: ["DryfitMenu"],
      exclude: ["__Snapshots__"]
    ),
  ]
)
