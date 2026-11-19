import Foundation

/// Turns the bytes of a server-sent-events stream into messages. A message ends at a blank line; it may
/// arrive split across any number of chunks. Comment lines (`: ping`) are skipped.
public struct EventStreamParser: Sendable {
  public struct Message: Sendable, Equatable {
    public let id: Int?
    public let data: String
  }

  private var line: [UInt8] = []
  private var id: Int?
  private var data: [String] = []

  public init() {}

  public mutating func feed(_ bytes: some Sequence<UInt8>) -> [Message] {
    var messages: [Message] = []
    for byte in bytes {
      guard byte == UInt8(ascii: "\n") else {
        line.append(byte)
        continue
      }
      if line.last == UInt8(ascii: "\r") { line.removeLast() }
      if let message = take(String(decoding: line, as: UTF8.self)) { messages.append(message) }
      line.removeAll(keepingCapacity: true)
    }
    return messages
  }

  /// Handles one complete line; a blank one ends the message.
  private mutating func take(_ text: String) -> Message? {
    if text.isEmpty {
      defer { (id, data) = (nil, []) }
      return data.isEmpty ? nil : Message(id: id, data: data.joined(separator: "\n"))
    }
    if text.hasPrefix(":") { return nil }
    let (field, value) = split(text)
    switch field {
    case "id": id = Int(value)
    case "data": data.append(value)
    default: break
    }
    return nil
  }

  private func split(_ text: String) -> (String, String) {
    guard let colon = text.firstIndex(of: ":") else { return (text, "") }
    var value = text[text.index(after: colon)...]
    if value.first == " " { value = value.dropFirst() }
    return (String(text[..<colon]), String(value))
  }
}
