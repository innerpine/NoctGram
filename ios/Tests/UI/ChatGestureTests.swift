import XCTest

/// Gestures of a dialogue and a group on the mock server
/// (ios/Tests/mock_server.py): swipe a message left to answer it, hold it
/// for reactions and actions, tap a reaction, and scroll starting on a
/// bubble. A failed check saves the screen and prints the element tree.
final class ChatGestureTests: XCTestCase {
    /// «Во сколько встречаемся?» from Bob.
    private let messageId = "message-message:local_bob:mock-4"
    /// «🔥» from Bob, the newest message of the dialogue.
    private let newestId = "message-message:local_bob:mock-5"
    /// «Красота! А это моя луна сегодня» with a photo, from the viewer.
    private let photoId = "message-message:local_alice:mock-2"
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
    private func swipeLeft(_ bubble: XCUIElement, from point: CGVector = CGVector(dx: 0.8, dy: 0.5)) {
        let start = bubble.coordinate(withNormalizedOffset: point)
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: -180, dy: 0)))
    }

    private func save(_ name: String) {
        guard let directory = ProcessInfo.processInfo.environment["SHOTS_DIR"] else { return }
        let url = URL(fileURLWithPath: directory).appendingPathComponent(name + ".png")
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url)
    }

    /// Polls until the condition holds or the time is up.
    private func poll(_ timeout: TimeInterval, until condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    /// Checks, and on failure saves «<shot>-failed» and prints the tree.
    private func expect(_ passed: Bool, _ message: String, in app: XCUIApplication, shot: String) {
        if !passed {
            save(shot + "-failed")
            print("UI TREE (\(message)):\n" + app.debugDescription)
        }
        XCTAssertTrue(passed, message)
    }

    private func label(_ id: String, in app: XCUIApplication) -> String {
        let item = element(id, in: app)
        return item.exists ? item.label : ""
    }

    /// The newest message ends above the given element (the composer):
    /// nothing hides under the keyboard or the input.
    private func expectNewest(in app: XCUIApplication, above element: XCUIElement, shot: String) {
        // Let the keyboard, if any, finish rising.
        if app.keyboards.firstMatch.waitForExistence(timeout: 2) {
            Thread.sleep(forTimeInterval: 1)
        }
        let newest = self.element(newestId, in: app)
        let above = newest.exists && element.exists && newest.frame.maxY <= element.frame.minY
        expect(above, "The newest message hides under the input", in: app, shot: shot)
    }

    func testSwipeLeftAnswersTheMessage() {
        let app = launch()
        let bubble = element(messageId, in: app)
        expect(bubble.waitForExistence(timeout: 30), "No message", in: app, shot: "22-swipe-reply")
        swipeLeft(bubble)
        let reply = app.staticTexts["Ответ Боб"]
        expect(reply.waitForExistence(timeout: 5), "A swipe to the left does not answer", in: app, shot: "22-swipe-reply")
        // The keyboard opens and the dialogue stays on its newest message.
        expectNewest(in: app, above: reply, shot: "22-swipe-reply")
        save("22-swipe-reply")
    }

    /// A swipe that starts on a photo answers too, and the photo stays closed.
    func testSwipeOnAPhotoAnswers() {
        let app = launch()
        let bubble = element(photoId, in: app)
        expect(bubble.waitForExistence(timeout: 30), "No photo message", in: app, shot: "29-swipe-photo")
        swipeLeft(bubble, from: CGVector(dx: 0.8, dy: 0.3))
        expect(app.staticTexts["Ответ себе"].waitForExistence(timeout: 5), "A swipe on a photo does not answer", in: app, shot: "29-swipe-photo")
    }

    func testHoldShowsReactionsAndActions() {
        let app = launch()
        let bubble = element(messageId, in: app)
        expect(bubble.waitForExistence(timeout: 30), "No message", in: app, shot: "23-hold-menu")
        bubble.press(forDuration: 0.8)
        let fire = app.buttons["reaction-🔥"]
        expect(fire.waitForExistence(timeout: 5), "Holding shows no reactions", in: app, shot: "23-hold-menu")
        XCTAssertTrue(app.buttons["Ответить"].exists)
        XCTAssertTrue(app.buttons["Переслать"].exists)
        save("23-hold-menu")
        fire.tap()
        let reacted = poll(10) { label(messageId, in: app).contains("🔥") }
        expect(reacted, "The reaction does not show under the message", in: app, shot: "24-reacted")
        // The bubble grew by a row of reactions; the newest message stays
        // above the input.
        expectNewest(in: app, above: app.buttons["Отправить"].firstMatch, shot: "24-reacted")
        save("24-reacted")
        // A tap on the reaction under the message takes it back.
        element(messageId, in: app).coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 1))
            .withOffset(CGVector(dx: 40, dy: -22)).tap()
        let removed = poll(10) { !label(messageId, in: app).contains("🔥") }
        expect(removed, "A tap on the reaction does not take it back", in: app, shot: "24-unreacted")
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
        expect(bubble.waitForExistence(timeout: 30), "No message", in: app, shot: "27-scrolled-beside")
        let margin = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
            .withOffset(CGVector(dx: app.frame.width - 3, dy: bubble.frame.midY))
        let beside = dragDown(from: margin, watching: bubble, "Beside the bubbles")
        save("27-scrolled-beside")
        // A fresh start at the newest messages, then the same drag on the bubble.
        app.terminate()
        let again = launch()
        let target = element(messageId, in: again)
        expect(target.waitForExistence(timeout: 30), "No message", in: again, shot: "28-scrolled-on-bubble")
        let on = dragDown(from: target.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)), watching: target, "On a bubble")
        save("28-scrolled-on-bubble")
        XCTAssertGreaterThan(beside, 150, "The list does not scroll at all")
        XCTAssertGreaterThan(on, 150, "A drag that starts on a message does not scroll the list")
        XCTAssertFalse(again.buttons["reaction-🔥"].exists)
        XCTAssertFalse(again.staticTexts["Ответ Боб"].exists)
    }

    func testGroupHoldAndSwipe() {
        let app = launch(route: "room:room_night_walks")
        let bubble = element(groupMessageId, in: app)
        expect(bubble.waitForExistence(timeout: 30), "No group message", in: app, shot: "25-group-menu")
        bubble.press(forDuration: 0.8)
        let heart = app.buttons["reaction-❤️"]
        expect(heart.waitForExistence(timeout: 5), "Holding shows no reactions in a group", in: app, shot: "25-group-menu")
        XCTAssertTrue(app.buttons["Ответить"].exists)
        XCTAssertTrue(app.buttons["Скопировать"].exists)
        save("25-group-menu")
        heart.tap()
        let reacted = poll(10) { label(groupMessageId, in: app).contains("❤️") }
        expect(reacted, "The reaction does not show under the group message", in: app, shot: "26-group-reply")
        swipeLeft(element(groupMessageId, in: app))
        expect(app.staticTexts["Ответ Кэрол"].waitForExistence(timeout: 5), "A swipe does not answer in a group", in: app, shot: "26-group-reply")
        save("26-group-reply")
    }
}
