import XCTest

final class NativeSmokeTests: XCTestCase {
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
        // Do not submit: tests must never send OTP mail to a real account.
    }
}
