import XCTest

final class NativeSmokeTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testNativeLoginAndInputValidation() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-login"]
        app.launch()
        let email = app.textFields["login.email"]
        XCTAssertTrue(email.waitForExistence(timeout: 12))
        XCTAssertEqual(app.webViews.count, 0, "The root must be a native screen.")
        let submit = app.buttons["login.submit"]
        XCTAssertFalse(submit.isEnabled)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "NoctGram native sign in"
        attachment.lifetime = .keepAlways
        add(attachment)
        email.tap()
        email.typeText("invalid")
        XCTAssertFalse(submit.isEnabled)
        email.typeText("@example.com")
        XCTAssertTrue(submit.isEnabled)
    }

    func testAuthButtonsRespondToOneTapAtTheirMargins() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-login"]
        app.launch()
        let email = app.textFields["login.email"]
        XCTAssertTrue(email.waitForExistence(timeout: 12))
        email.tap()
        email.typeText("tap@example.test")
        XCTAssertTrue(app.keyboards.firstMatch.exists)

        // The empty area to the left of the title must submit on its first tap.
        tapMargin(app.buttons["login.submit"], x: 0.08)
        let code = app.textFields["login.code"]
        XCTAssertTrue(code.waitForExistence(timeout: 5))
        code.tap()
        code.typeText("123456")
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        tapMargin(app.buttons["login.submit"], x: 0.92)
        waitForLabel("Проверка нажатия входа: 1", identifier: "login.error", in: app)

        // These secondary buttons previously enlarged only their outer layout frame.
        let resend = app.buttons["login.resend"]
        reveal(resend, in: app)
        tapMargin(resend, x: 0.08)
        waitForLabel("Проверка повторной отправки: 2", identifier: "login.error", in: app)
        let changeEmail = app.buttons["login.change-email"]
        reveal(changeEmail, in: app)
        tapMargin(changeEmail, x: 0.92)
        XCTAssertTrue(email.waitForExistence(timeout: 5))
        XCTAssertFalse(code.exists)
    }

    func testRegistrationButtonRespondsAtMarginWithKeyboardOpen() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-onboarding"]
        app.launch()
        let name = app.textFields["onboarding.name"]
        XCTAssertTrue(name.waitForExistence(timeout: 12))
        name.tap()
        name.typeText("Tester")
        let handle = app.textFields["onboarding.handle"]
        handle.tap()
        handle.typeText("tap_tester")
        XCTAssertTrue(app.keyboards.firstMatch.exists)

        tapMargin(app.buttons["onboarding.submit"], x: 0.92)
        waitForLabel("Проверка регистрации: 1", identifier: "onboarding.error", in: app)
    }

    private func tapMargin(_ button: XCUIElement, x: CGFloat, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(button.waitForExistence(timeout: 5), file: file, line: line)
        XCTAssertTrue(button.isEnabled, file: file, line: line)
        XCTAssertTrue(button.isHittable, file: file, line: line)
        XCTAssertGreaterThanOrEqual(button.frame.height, 44, file: file, line: line)
        XCTAssertGreaterThan(button.frame.width, 200, file: file, line: line)
        button.coordinate(withNormalizedOffset: CGVector(dx: x, dy: 0.5)).tap()
    }

    private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<3 {
            if element.isHittable { return }
            app.swipeUp()
        }
    }

    private func waitForLabel(_ text: String, identifier: String, in app: XCUIApplication,
                              file: StaticString = #filePath, line: UInt = #line) {
        let element = app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        let predicate = NSPredicate(format: "exists == true AND label CONTAINS %@", text)
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 5), .completed, file: file, line: line)
    }
}
