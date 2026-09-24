import XCTest

/// Gestures of a dialogue on the mock server (ios/Tests/mock_server.py):
/// swipe a message left to answer it, hold it for reactions and actions.
final class ChatGestureTests: XCTestCase {
    /// «Во сколько встречаемся?» from Bob.
    private let messageId = "message-message:local_bob:mock-4"

    override func setUp() {
        continueAfterFailure = false
    }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        let server = ProcessInfo.processInfo.environment["NOCT_SERVER"] ?? "http://127.0.0.1:8765"
        app.launchArguments = ["-noct.server", server, "-noct.debugTab", "messages", "-noct.debugRoute", "chat:local_bob"]
        app.launch()
        return app
    }

    private func message(in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)[messageId]
    }

    private func save(_ name: String) {
        guard let directory = ProcessInfo.processInfo.environment["SHOTS_DIR"] else { return }
        let url = URL(fileURLWithPath: directory).appendingPathComponent(name + ".png")
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url)
    }

    func testSwipeLeftAnswersTheMessage() {
        let app = launch()
        let bubble = message(in: app)
        XCTAssertTrue(bubble.waitForExistence(timeout: 30))
        let start = bubble.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5))
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: -180, dy: 0)))
        XCTAssertTrue(app.staticTexts["Ответ Боб"].waitForExistence(timeout: 5))
        save("22-swipe-reply")
    }

    func testHoldShowsReactionsAndActions() {
        let app = launch()
        let bubble = message(in: app)
        XCTAssertTrue(bubble.waitForExistence(timeout: 30))
        bubble.press(forDuration: 0.8)
        let fire = app.buttons["reaction-🔥"]
        XCTAssertTrue(fire.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Ответить"].exists)
        XCTAssertTrue(app.buttons["Переслать"].exists)
        save("23-hold-menu")
        fire.tap()
        expectation(for: NSPredicate(format: "label CONTAINS %@", "🔥"), evaluatedWith: message(in: app))
        waitForExpectations(timeout: 10)
        save("24-reacted")
    }
}
