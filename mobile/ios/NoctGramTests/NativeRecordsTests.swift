import XCTest
@testable import NoctGram

final class NativeRecordsTests: XCTestCase {
    func testNullableAndMixedJSONFieldsAreSafe() throws {
        let data = Data(#"{"id":"post-1","title":null,"count":"25","fraction":12.5,"enabled":1,"off":false,"yes":"true","nan":"NaN","rows":[null,{"id":"a"},"bad"],"tags":["one",null,2,"two"]}"#.utf8)
        let record = NGRecord(try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any]))
        XCTAssertEqual(record.id, "post-1")
        XCTAssertEqual(record.string("title", default: "Без названия"), "Без названия")
        XCTAssertEqual(record.int("count"), 25)
        XCTAssertEqual(record.int("fraction"), 12)
        XCTAssertEqual(record.double("fraction"), 12.5)
        XCTAssertEqual(record.int("nan"), 0)
        XCTAssertEqual(record.double("nan"), 0)
        XCTAssertTrue(record.bool("enabled"))
        XCTAssertTrue(record.bool("yes"))
        XCTAssertFalse(record.bool("off"))
        XCTAssertFalse(record.bool("missing"))
        XCTAssertNil(record.object("title"))
        XCTAssertEqual(record.objects("rows").map(\.id), ["a"])
        XCTAssertEqual(record.strings("tags"), ["one", "two"])
        XCTAssertTrue(record.objects("missing").isEmpty)
    }

    func testMissingIDsStayStableWithinRecordAndDoNotCollide() {
        let first = NGRecord([:]), second = NGRecord(raw: [:])
        XCTAssertEqual(first.id, first.id)
        XCTAssertNotEqual(first.id, second.id)
        XCTAssertEqual(NGRecord(["id": 42]).id, "42")
        XCTAssertEqual(NGRecord(["limit": String(Int.max)]).int("limit"), Int.max)
        XCTAssertEqual(NGRecord(["limit": "1e100"]).int("limit"), 0)
    }
}
