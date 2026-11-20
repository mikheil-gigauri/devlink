import DryfitAPI
import Foundation
import SwiftUI

/// The order the user dragged libraries, apps and groups into in the sidebar. The menu bar window
/// lists them the same way. It is how this Mac shows them, not part of dryfit's state, so the app
/// keeps it rather than the daemon.
public struct ItemOrder: Codable, Equatable, Sendable {
  public enum Kind: Sendable { case libraries, apps, groups }

  /// Library names, app folders and group names, each in the user's order.
  public var libraries: [String] = []
  public var apps: [String] = []
  public var groups: [String] = []

  public init() {}

  subscript(kind: Kind) -> [String] {
    get {
      switch kind {
      case .libraries: libraries
      case .apps: apps
      case .groups: groups
      }
    }
    set {
      switch kind {
      case .libraries: libraries = newValue
      case .apps: apps = newValue
      case .groups: groups = newValue
      }
    }
  }

  /// `items` in the user's order. Ones never moved keep their own order, after the ones that were.
  func sorted<Item>(_ items: [Item], _ kind: Kind, by id: (Item) -> String) -> [Item] {
    let ranks = Dictionary(self[kind].enumerated().map { ($1, $0) }, uniquingKeysWith: { first, _ in first })
    return items.enumerated()
      .sorted { lhs, rhs in
        switch (ranks[id(lhs.element)], ranks[id(rhs.element)]) {
        case let (left?, right?): left < right
        case (.some, nil): true
        case (nil, .some): false
        case (nil, nil): lhs.offset < rhs.offset
        }
      }
      .map(\.element)
  }
}

/// Where the order is kept between launches.
public struct ItemOrderStore {
  public var load: () -> ItemOrder
  public var save: (ItemOrder) -> Void

  public init(load: @escaping () -> ItemOrder, save: @escaping (ItemOrder) -> Void) {
    self.load = load
    self.save = save
  }

  /// Nothing kept: for tests and previews.
  public static var memory: ItemOrderStore { ItemOrderStore(load: { ItemOrder() }, save: { _ in }) }

  public static func userDefaults(_ defaults: UserDefaults = .standard, key: String = "itemOrder") -> ItemOrderStore {
    ItemOrderStore(
      load: {
        defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(ItemOrder.self, from: $0) } ?? ItemOrder()
      },
      save: { order in
        if let data = try? JSONEncoder().encode(order) { defaults.set(data, forKey: key) }
      })
  }
}

extension MenuModel {
  /// The groups, in the user's order.
  public var groups: [DryfitAPI.Group] {
    order.sorted(status?.groups ?? [], .groups, by: \.name)
  }

  /// Moves sidebar rows, as `onMove` reports it, in a list showing `ids` in their current order.
  public func move(_ kind: ItemOrder.Kind, ids: [String], from source: IndexSet, to destination: Int) {
    var ids = ids
    ids.move(fromOffsets: source, toOffset: destination)
    // Ones not listed right now (a library being re-added, an app on a drive that is out) keep their place after.
    order[kind] = ids + order[kind].filter { !ids.contains($0) }
  }
}
