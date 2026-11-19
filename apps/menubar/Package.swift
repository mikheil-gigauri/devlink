// swift-tools-version: 6.2
import PackageDescription

/// The devlink menu bar app (ADR 0010, ADR 0013): a pure client of the daemon's API.
let package = Package(
  name: "DevlinkMenuBar",
  platforms: [.macOS(.v26)],
  products: [
    .executable(name: "Devlink", targets: ["Devlink"])
  ],
  targets: [
    /// API models, the HTTP and event-stream client, and finding and starting the daemon. No UI.
    .target(name: "DevlinkAPI"),
    /// The view model and views.
    .target(
      name: "DevlinkMenu",
      dependencies: ["DevlinkAPI"],
      swiftSettings: [.defaultIsolation(MainActor.self)]
    ),
    .executableTarget(
      name: "Devlink",
      dependencies: ["DevlinkMenu"],
      swiftSettings: [.defaultIsolation(MainActor.self)]
    ),
    .testTarget(name: "DevlinkAPITests", dependencies: ["DevlinkAPI"]),
    .testTarget(
      name: "DevlinkMenuTests",
      dependencies: ["DevlinkMenu"],
      exclude: ["__Snapshots__"]
    ),
  ]
)
