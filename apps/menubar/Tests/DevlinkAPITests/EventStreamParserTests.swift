import Foundation
import Testing

@testable import DevlinkAPI

@Suite struct EventStreamParserTests {
  @Test func splitsMessagesAtBlankLinesAndKeepsTheirIDs() {
    var parser = EventStreamParser()

    let messages = parser.feed(Array("id: 1\ndata: {\"a\":1}\n\nid: 2\ndata: {\"b\":2}\n\n".utf8))

    #expect(messages == [.init(id: 1, data: #"{"a":1}"#), .init(id: 2, data: #"{"b":2}"#)])
  }

  @Test func waitsForTheRestOfAMessageSplitAcrossChunks() {
    var parser = EventStreamParser()

    #expect(parser.feed(Array("id: 7\nda".utf8)).isEmpty)
    #expect(parser.feed(Array("ta: {}\n".utf8)).isEmpty)
    #expect(parser.feed(Array("\n".utf8)) == [.init(id: 7, data: "{}")])
  }

  @Test func ignoresCommentsAndHeartbeatsAndAcceptsCRLF() {
    var parser = EventStreamParser()

    let messages = parser.feed(Array(": devlink events\n\n: ping\n\nid: 3\r\ndata: {}\r\n\r\n".utf8))

    #expect(messages == [.init(id: 3, data: "{}")])
  }

  @Test func joinsMultilineData() {
    var parser = EventStreamParser()

    #expect(parser.feed(Array("data: a\ndata: b\n\n".utf8)) == [.init(id: nil, data: "a\nb")])
  }
}
