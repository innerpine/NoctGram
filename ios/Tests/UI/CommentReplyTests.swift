import XCTest

/// Answers in comments on the mock server (ios/Tests/mock_server.py), as a
/// chat answers a message: «Ответить» or a swipe to the left puts «Ответ …»
/// over the field, and the sent comment quotes the one it answers.
final class CommentReplyTests: XCTestCase {
    /// The captured post with Bob's and Carol's comments.
    private let post = "b8342888-ee60-493c-90e2-a51d4e99b6ee"
    private let carol = "b01c9d02-3956-481b-a380-ae3d5f876fe4"
    private let bob = "47016916-168f-418d-955d-dd3f820dc04d"

    override func setUp() {
        continueAfterFailure = false
    }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        let server = ProcessInfo.processInfo.environment["NOCT_SERVER"] ?? "http://127.0.0.1:8765"
        app.launchArguments = ["-noct.server", server, "-noct.debugRoute", "post:" + post]
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

    /// Scrolls the post down until the element is on screen.
    private func reveal(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
        for _ in 0..<6 {
            if element.exists && element.isHittable { return true }
            app.swipeUp(velocity: .slow)
        }
        return element.exists && element.isHittable
    }

    func testAnswerQuotesTheComment() {
        let app = launch()
        let answer = app.buttons["comment-reply-" + carol]
        expect(answer.waitForExistence(timeout: 20) || reveal(answer, in: app), "Carol's comment offers no «Ответить»", in: app, shot: "reply-button")
        expect(reveal(answer, in: app), "«Ответить» cannot be reached", in: app, shot: "reply-reach")
        answer.tap()

        expect(app.staticTexts["Ответ Кэрол"].waitForExistence(timeout: 5), "«Ответить» shows no «Ответ Кэрол» over the field", in: app, shot: "reply-context")
        let field = app.descendants(matching: .any)["composer-field"]
        expect(field.waitForExistence(timeout: 5), "No comment field", in: app, shot: "reply-field")
        field.tap()
        field.typeText("Там очень красиво")
        app.buttons["Отправить"].tap()

        let sent = app.staticTexts["Там очень красиво"]
        expect(sent.waitForExistence(timeout: 8), "The answer is not in the list", in: app, shot: "reply-sent")
        expect(poll(5) { !app.staticTexts["Ответ Кэрол"].exists }, "«Ответ Кэрол» stays after sending", in: app, shot: "reply-cleared")
        let quotes = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Ответ Кэрол:"))
        // Alice's captured answer and the one just sent both quote Carol.
        expect(poll(5) { quotes.count >= 2 }, "The answer does not quote Carol", in: app, shot: "reply-quote")
        save("49-comment-reply")

        // A swipe to the left answers too, as in a chat.
        let bobText = app.staticTexts["Вторая фотография — просто космос! 🔥"]
        expect(reveal(bobText, in: app) || bobText.exists, "Bob's comment is not on screen", in: app, shot: "reply-bob")
        let start = bobText.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5))
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: -220, dy: 0)))
        expect(app.staticTexts["Ответ Боб"].waitForExistence(timeout: 5), "A swipe to the left does not answer", in: app, shot: "reply-swipe")
        app.buttons["Отменить"].tap()
        expect(poll(5) { !app.staticTexts["Ответ Боб"].exists }, "«Отменить» does not drop the answer", in: app, shot: "reply-cancel")
    }
}
