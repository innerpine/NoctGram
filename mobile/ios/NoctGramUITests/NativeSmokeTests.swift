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

    func testSignedInFeedContainsPortraitAndPanoramaInsideCard() {
        let app = launchSocial()
        let portrait = app.buttons["media.fixture-portrait-image"]
        XCTAssertTrue(portrait.waitForExistence(timeout: 8))
        let author = element("feed.author.fixture-portrait", in: app)
        XCTAssertTrue(author.exists)
        assertHorizontalBounds(portrait, in: app)
        assertHorizontalBounds(author, in: app)
        XCTAssertGreaterThanOrEqual(portrait.frame.minY, author.frame.maxY)
        snapshot("Feed portrait and long author", in: app)
        // The first tall photo initially reaches behind the floating tab bar. XCTest reports
        // the clipped accessibility frame there; bring the complete preview into the viewport.
        nudgeFeed(app.scrollViews.matching(identifier: "feed.scroll").firstMatch, up: true)
        waitForAspectRatio(0.75, of: portrait, in: app)
        assertHorizontalBounds(portrait, in: app)
        XCTAssertGreaterThan(portrait.frame.height, 150)
        XCTAssertLessThan(portrait.frame.height, app.frame.height * 0.55)
        snapshot("Feed portrait preview fully visible", in: app)

        let portraitLike = app.buttons["feed.like.fixture-portrait"]
        revealFeed(portraitLike, in: app)
        XCTAssertTrue(portraitLike.isHittable)
        XCTAssertGreaterThanOrEqual(portraitLike.frame.minY, portrait.frame.maxY - 1)
        assertHorizontalBounds(app.buttons["feed.comments.fixture-portrait"], in: app)
        assertHorizontalBounds(app.buttons["feed.save.fixture-portrait"], in: app)

        let panorama = app.buttons["media.fixture-landscape-image"]
        revealFeed(panorama, in: app)
        XCTAssertTrue(panorama.isHittable)
        waitForAspectRatio(3, of: panorama, in: app)
        assertHorizontalBounds(panorama, in: app)
        XCTAssertGreaterThan(panorama.frame.height, 80)
        XCTAssertLessThan(panorama.frame.height, panorama.frame.width / 2)
        snapshot("Feed panorama", in: app)

        defer { XCUIDevice.shared.orientation = .portrait }
        XCUIDevice.shared.orientation = .landscapeLeft
        let landscape = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            app.frame.width > app.frame.height
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [landscape], timeout: 5), .completed)
        revealFeed(panorama, in: app)
        snapshot("Feed landscape orientation", in: app)
        XCTAssertTrue(panorama.isHittable)
        waitForAspectRatio(3, of: panorama, in: app)
        assertHorizontalBounds(panorama, in: app)
        assertHorizontalBounds(element("feed.post.fixture-landscape", in: app), in: app)
    }

    func testRealRootLoadsDirectAndGroupChatsAndKeepsComposerAboveKeyboard() {
        let app = launchSocial()
        XCTAssertTrue(app.buttons["media.fixture-portrait-image"].waitForExistence(timeout: 8))
        let messagesTab = app.tabBars.buttons["Сообщения"]
        XCTAssertTrue(messagesTab.exists)
        messagesTab.tap()
        let friend = element("chats.row.fixture-friend", in: app)
        XCTAssertTrue(friend.waitForExistence(timeout: 5), "The real app scene must activate chat loading.")
        XCTAssertTrue(element("chats.row.fixture-room", in: app).exists)
        snapshot("Loaded chats", in: app)
        friend.tap()

        let directMessage = element("chat.message.fixture-dm-message", in: app)
        XCTAssertTrue(directMessage.waitForExistence(timeout: 5), "A personal conversation must leave the initial spinner.")
        let composer = app.textViews["chat.composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        XCTAssertTrue(composer.isEnabled)
        snapshot("Direct conversation", in: app)
        composer.tap()
        composer.typeText("Checking the keyboard")
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
        let send = app.buttons["chat.send"]
        XCTAssertTrue(send.isEnabled)
        assertHorizontalBounds(composer, in: app)
        assertHorizontalBounds(send, in: app)
        XCTAssertLessThanOrEqual(composer.frame.maxY, keyboard.frame.minY + 1)
        XCTAssertLessThanOrEqual(send.frame.maxY, keyboard.frame.minY + 1)
        XCTAssertLessThanOrEqual(directMessage.frame.maxY, composer.frame.minY + 1)
        snapshot("Direct conversation with keyboard", in: app)

        // No message is sent: fixture keyboard edits stay local. Exercise actual background/foreground handling.
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(directMessage.waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Загрузка сообщений"].exists)
        app.navigationBars.buttons["Чаты"].tap()
        let room = element("chats.row.fixture-room", in: app)
        XCTAssertTrue(room.waitForExistence(timeout: 5))
        room.tap()
        let roomMessage = element("chat.message.fixture-room-message", in: app)
        XCTAssertTrue(roomMessage.waitForExistence(timeout: 5), "A group must leave the initial spinner.")
        XCTAssertTrue(app.textViews["chat.composer"].isEnabled)
        XCTAssertFalse(app.staticTexts["Загрузка сообщений"].exists)
        assertHorizontalBounds(roomMessage, in: app)
        snapshot("Group conversation", in: app)
    }

    private func launchSocial() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-social"]
        app.launch()
        XCTAssertEqual(app.webViews.count, 0)
        return app
    }

    private func element(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func waitForAspectRatio(_ ratio: CGFloat, of element: XCUIElement, in app: XCUIApplication,
                                   file: StaticString = #filePath, line: UInt = #line) {
        let scroll = app.scrollViews.matching(identifier: "feed.scroll").firstMatch
        // A preview can be tappable while only a strip is visible above the tab bar. If its
        // accessibility frame is clipped, scroll it into view before checking the full ratio.
        for _ in 0..<4 {
            let frame = element.frame
            if element.exists, frame.height > 0, abs(frame.width / frame.height - ratio) < 0.04 { break }
            nudgeFeed(scroll, up: frame.minY >= app.navigationBars.firstMatch.frame.maxY)
        }
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            element.exists && element.frame.height > 0 && abs(element.frame.width / element.frame.height - ratio) < 0.04
        }, object: nil)
        let result = XCTWaiter.wait(for: [settled], timeout: 5)
        let frame = element.frame
        XCTAssertEqual(result, .completed,
                       "Expected preview ratio \(ratio); accessibility frame \(frame), ratio \(frame.width / max(1, frame.height)), scroll \(scroll.frame), app \(app.frame)",
                       file: file, line: line)
    }

    private func nudgeFeed(_ scroll: XCUIElement, up: Bool) {
        let start = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: up ? 0.65 : 0.40))
        let end = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: up ? 0.40 : 0.65))
        start.press(forDuration: 0.05, thenDragTo: end)
    }

    private func revealFeed(_ element: XCUIElement, in app: XCUIApplication,
                            file: StaticString = #filePath, line: UInt = #line) {
        let scroll = app.scrollViews.matching(identifier: "feed.scroll").firstMatch
        XCTAssertTrue(scroll.exists, file: file, line: line)
        // Target the scrolling content, not the application frame: its global swipe can hit
        // the navigation bar after iPhone rotation instead of moving the feed.
        for _ in 0..<6 {
            if element.isHittable { return }
            if element.exists && element.frame.maxY < scroll.frame.minY + 44 {
                scroll.swipeDown(velocity: .slow)
            } else {
                scroll.swipeUp(velocity: .slow)
            }
        }
    }

    private func assertHorizontalBounds(_ element: XCUIElement, in app: XCUIApplication,
                                        file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.exists, file: file, line: line)
        XCTAssertGreaterThan(element.frame.width, 0, file: file, line: line)
        XCTAssertGreaterThanOrEqual(element.frame.minX, app.frame.minX - 1, file: file, line: line)
        XCTAssertLessThanOrEqual(element.frame.maxX, app.frame.maxX + 1, file: file, line: line)
    }

    private func snapshot(_ name: String, in app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
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
