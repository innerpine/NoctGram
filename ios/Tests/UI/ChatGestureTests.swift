import XCTest

/// Gestures of a dialogue and a group on the mock server
/// (ios/Tests/mock_server.py): swipe a message left to answer it, hold it
/// for reactions and actions, and scroll starting on a bubble.
final class ChatGestureTests: XCTestCase {
    /// «Во сколько встречаемся?» from Bob.
    private let messageId = "message-message:local_bob:mock-4"
    /// «🔥» from Bob, the newest message of the dialogue.
    private let newestId = "message-message:local_bob:mock-5"
    /// «Могу взять термос с чаем ☕️» from Carol in «Ночные прогулки».
    private let groupMessageId = "message-room:mock-2"

    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(route: String = "chat:local_bob", _ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        let server = ProcessInfo.processInfo.environment["NOCT_SERVER"] ?? "http://127.0.0.1:8765"
        app.launchArguments = ["-noct.server", server, "-noct.debugTab", "messages", "-noct.debugRoute", route] + extra
        app.launch()
        return app
    }

    private func element(_ id: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)[id]
    }

    /// Pulls the bubble to the left past the reply threshold.
    private func swipeLeft(_ bubble: XCUIElement) {
        let start = bubble.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5))
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: -180, dy: 0)))
    }

    /// The newest message ends above the given element (the composer):
    /// nothing hides under the keyboard or the input.
    private func expectNewest(in app: XCUIApplication, above element: XCUIElement) {
        // Let the keyboard, if any, finish rising.
        if app.keyboards.firstMatch.waitForExistence(timeout: 2) {
            Thread.sleep(forTimeInterval: 1)
        }
        let newest = self.element(newestId, in: app)
        XCTAssertTrue(newest.exists)
        XCTAssertTrue(element.exists)
        XCTAssertLessThanOrEqual(newest.frame.maxY, element.frame.minY)
    }

    private func save(_ name: String) {
        guard let directory = ProcessInfo.processInfo.environment["SHOTS_DIR"] else { return }
        let url = URL(fileURLWithPath: directory).appendingPathComponent(name + ".png")
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url)
    }

    func testSwipeLeftAnswersTheMessage() {
        let app = launch()
        let bubble = element(messageId, in: app)
        XCTAssertTrue(bubble.waitForExistence(timeout: 30))
        swipeLeft(bubble)
        let reply = app.staticTexts["Ответ Боб"]
        XCTAssertTrue(reply.waitForExistence(timeout: 5))
        // The keyboard opens and the dialogue stays on its newest message.
        expectNewest(in: app, above: reply)
        save("22-swipe-reply")
    }

    func testHoldShowsReactionsAndActions() {
        let app = launch()
        let bubble = element(messageId, in: app)
        XCTAssertTrue(bubble.waitForExistence(timeout: 30))
        bubble.press(forDuration: 0.8)
        let fire = app.buttons["reaction-🔥"]
        XCTAssertTrue(fire.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Ответить"].exists)
        XCTAssertTrue(app.buttons["Переслать"].exists)
        save("23-hold-menu")
        fire.tap()
        expectation(for: NSPredicate(format: "label CONTAINS %@", "🔥"), evaluatedWith: element(messageId, in: app))
        waitForExpectations(timeout: 10)
        // The bubble grew by a row of reactions; the newest message stays
        // above the input.
        expectNewest(in: app, above: app.buttons["Отправить"].firstMatch)
        save("24-reacted")
        // A tap on the reaction under the message takes it back.
        element(messageId, in: app).coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 1))
            .withOffset(CGVector(dx: 40, dy: -22)).tap()
        expectation(for: NSPredicate(format: "NOT (label CONTAINS %@)", "🔥"), evaluatedWith: element(messageId, in: app))
        waitForExpectations(timeout: 10)
    }

    /// Drags the list down by 300 pt from a point and tells how far the
    /// message moved (the log shows it as an activity).
    private func dragDown(from point: XCUICoordinate, watching bubble: XCUIElement, _ name: String) -> CGFloat {
        let before = bubble.frame.minY
        point.press(forDuration: 0.05, thenDragTo: point.withOffset(CGVector(dx: 0, dy: 300)))
        let moved = bubble.exists ? bubble.frame.minY - before : .infinity
        XCTContext.runActivity(named: "\(name): the message moved by \(moved) pt") { _ in }
        return moved
    }

    /// The swipe and hold gestures must not keep the list from scrolling
    /// when the finger lands on a bubble; beside the bubbles (the right
    /// margin of the list) is the control.
    func testScrollStartsOnAMessage() {
        let app = launch()
        let bubble = element(messageId, in: app)
        XCTAssertTrue(bubble.waitForExistence(timeout: 30))
        let margin = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
            .withOffset(CGVector(dx: app.frame.width - 3, dy: bubble.frame.midY))
        let beside = dragDown(from: margin, watching: bubble, "Beside the bubbles")
        save("27-scrolled-beside")
        // A fresh start at the newest messages, then the same drag on the bubble.
        app.terminate()
        let again = launch()
        let target = element(messageId, in: again)
        XCTAssertTrue(target.waitForExistence(timeout: 30))
        let on = dragDown(from: target.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)), watching: target, "On a bubble")
        save("28-scrolled-on-bubble")
        XCTAssertGreaterThan(beside, 150, "The list does not scroll at all")
        XCTAssertGreaterThan(on, 150, "A drag that starts on a message does not scroll the list")
        XCTAssertFalse(again.buttons["reaction-🔥"].exists)
        XCTAssertFalse(again.staticTexts["Ответ Боб"].exists)
    }

    /// Which gesture, if any, keeps a drag on a bubble from scrolling: the
    /// log shows how far the list moves with each one switched off.
    func testScrollDiagnostics() {
        for off in ["hold", "swipe"] {
            let app = launch(["-noct.debugGestures", off])
            let bubble = element(messageId, in: app)
            XCTAssertTrue(bubble.waitForExistence(timeout: 30))
            _ = dragDown(from: bubble.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)), watching: bubble, "On a bubble, \(off) off")
            app.terminate()
        }
    }

    func testGroupHoldAndSwipe() {
        let app = launch(route: "room:room_night_walks")
        let bubble = element(groupMessageId, in: app)
        XCTAssertTrue(bubble.waitForExistence(timeout: 30))
        bubble.press(forDuration: 0.8)
        let heart = app.buttons["reaction-❤️"]
        XCTAssertTrue(heart.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Ответить"].exists)
        XCTAssertTrue(app.buttons["Скопировать"].exists)
        save("25-group-menu")
        heart.tap()
        expectation(for: NSPredicate(format: "label CONTAINS %@", "❤️"), evaluatedWith: element(groupMessageId, in: app))
        waitForExpectations(timeout: 10)
        swipeLeft(bubble)
        XCTAssertTrue(app.staticTexts["Ответ Кэрол"].waitForExistence(timeout: 5))
        save("26-group-reply")
    }
}
