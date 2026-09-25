import XCTest

/// Messages on the mock server (ios/Tests/mock_server.py): a chat slides
/// left to «Удалить» and «В архив», as in Telegram. Archiving moves it to
/// «Архив», where «Вернуть» brings it back; «Удалить» asks first. A failed
/// check saves the screen and prints the element tree.
final class ThreadSwipeTests: XCTestCase {
    /// The dialogue with Carol, first in the list.
    private let carol = "thread-p:local_carol"

    override func setUp() {
        continueAfterFailure = false
    }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        let server = ProcessInfo.processInfo.environment["NOCT_SERVER"] ?? "http://127.0.0.1:8765"
        app.launchArguments = ["-noct.server", server, "-noct.debugTab", "messages"]
        app.launch()
        return app
    }

    private func save(_ name: String) {
        guard let directory = ProcessInfo.processInfo.environment["SHOTS_DIR"] else { return }
        let url = URL(fileURLWithPath: directory).appendingPathComponent(name + ".png")
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url)
    }

    private func expect(_ passed: Bool, _ message: String, in app: XCUIApplication, shot: String) {
        if !passed {
            save(shot + "-failed")
            print("UI TREE (\(message)):\n" + app.debugDescription)
        }
        XCTAssertTrue(passed, message)
    }

    private func poll(_ timeout: TimeInterval, until condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    /// Pulls the row to the left, past the point where it stays open.
    private func swipeLeft(_ row: XCUIElement) {
        let start = row.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.5))
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: -220, dy: 0)))
    }

    private func row(in app: XCUIApplication, shot: String) -> XCUIElement {
        let row = app.buttons[carol]
        expect(row.waitForExistence(timeout: 20), "No chat with Carol", in: app, shot: shot)
        return row
    }

    func testSwipeArchivesAndReturnsAChat() {
        let app = launch()
        swipeLeft(row(in: app, shot: "38-thread-swipe"))
        let archive = app.buttons["swipe-В архив"]
        expect(archive.waitForExistence(timeout: 5), "A swipe shows no «В архив»", in: app, shot: "38-thread-swipe")
        expect(app.buttons["swipe-Удалить"].exists, "A swipe shows no «Удалить»", in: app, shot: "38-thread-swipe")
        save("38-thread-swipe")
        archive.tap()
        expect(poll(8) { !app.buttons[carol].exists }, "The archived chat stays in the list", in: app, shot: "39-thread-archive")

        app.buttons["Архив"].firstMatch.tap()
        swipeLeft(row(in: app, shot: "39-thread-archive"))
        let back = app.buttons["swipe-Вернуть"]
        expect(back.waitForExistence(timeout: 5), "No «Вернуть» in the archive", in: app, shot: "39-thread-archive")
        save("39-thread-archive")
        back.tap()
        expect(poll(8) { !app.buttons[carol].exists }, "The chat stays in the archive", in: app, shot: "39-thread-archive")
        app.buttons["Чаты"].firstMatch.tap()
        _ = row(in: app, shot: "39-thread-archive")
    }

    func testDeleteAsksAndATapCloses() {
        let app = launch()
        swipeLeft(row(in: app, shot: "40-thread-delete"))
        let delete = app.buttons["swipe-Удалить"]
        expect(delete.waitForExistence(timeout: 5), "A swipe shows no «Удалить»", in: app, shot: "40-thread-delete")
        delete.tap()
        let cancel = app.buttons["Отмена"]
        expect(cancel.waitForExistence(timeout: 5), "«Удалить» does not ask first", in: app, shot: "40-thread-delete")
        expect(app.buttons["Удалить у меня"].exists, "No «Удалить у меня»", in: app, shot: "40-thread-delete")
        save("40-thread-delete")
        cancel.tap()
        expect(poll(5) { !cancel.exists }, "The question does not close", in: app, shot: "40-thread-delete")

        // A tap on an open row closes it instead of opening the chat.
        let row = row(in: app, shot: "41-thread-close")
        swipeLeft(row)
        expect(app.buttons["swipe-В архив"].waitForExistence(timeout: 5), "The row does not open again", in: app, shot: "41-thread-close")
        // The open row has slid left: tap what is still on screen of it.
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 80, dy: row.frame.midY)).tap()
        expect(poll(5) { !app.buttons["swipe-В архив"].exists }, "A tap does not close the row", in: app, shot: "41-thread-close")
        expect(app.buttons[carol].exists, "A tap on an open row opens the chat", in: app, shot: "41-thread-close")
    }
}
