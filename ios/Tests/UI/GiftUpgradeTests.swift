import XCTest

/// Upgrading a gift on the mock server (ios/Tests/mock_server.py), as in
/// Telegram: «улучшить» in the gift's table opens the upgrade, the button
/// with the price buys it, the attributes roll and settle, and the sheet
/// shows the collectible with its number, model, backdrop and symbol. The
/// mock server keeps nothing, so every run starts from the plain gift.
final class GiftUpgradeTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        let server = ProcessInfo.processInfo.environment["NOCT_SERVER"] ?? "http://127.0.0.1:8765"
        app.launchArguments = [
            "-noct.server", server, "-noct.debugTab", "profile",
            "-noct.debugRoute", "screen:gifts", "-noct.debugSheet", "gift",
        ]
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

    func testUpgradeTurnsAGiftIntoACollectible() {
        let app = launch()
        let open = app.buttons["gift-upgrade-open"]
        expect(open.waitForExistence(timeout: 25), "The gift offers no «улучшить»", in: app, shot: "upgrade-open")
        open.tap()

        expect(app.staticTexts["Улучшить подарок"].waitForExistence(timeout: 8), "«улучшить» opens no upgrade", in: app, shot: "upgrade-preview")
        let keep = app.buttons["gift-upgrade-keep"]
        if keep.exists { keep.tap() }
        let submit = app.buttons["gift-upgrade-submit"]
        expect(submit.waitForExistence(timeout: 5) && submit.isEnabled, "No enabled upgrade button", in: app, shot: "upgrade-submit")
        save("47-gift-upgrade")
        submit.tap()

        let number = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Коллекционный подарок #")).firstMatch
        expect(number.waitForExistence(timeout: 12), "No collectible after buying the upgrade", in: app, shot: "upgrade-result")
        let done = app.buttons["gift-collectible-done"]
        expect(poll(8) { done.exists && done.label == "Готово" }, "The attributes never settle", in: app, shot: "upgrade-settle")
        for label in ["Модель", "Фон", "Узор"] {
            expect(app.staticTexts[label].exists, "The collectible has no «\(label)» row", in: app, shot: "upgrade-rows")
        }
        expect(app.staticTexts["Подарок улучшен"].exists, "No «Подарок улучшен» after the reveal", in: app, shot: "upgrade-status")
        save("48-gift-upgraded")

        done.tap()
        expect(poll(6) { !number.exists }, "«Готово» does not close the collectible", in: app, shot: "upgrade-close")
        let tile = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "#1234")).firstMatch
        expect(tile.waitForExistence(timeout: 6), "The grid does not show the new collectible", in: app, shot: "upgrade-grid")
    }
}
