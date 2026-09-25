import XCTest

/// The media viewer opened from posts in the feed of the mock server
/// (ios/Tests/mock_server.py: a video post second, a post with two photos
/// further down): «Назад», the menu and full screen answer, and a swipe
/// down closes it. A failed check saves the screen and prints the tree.
final class MediaViewerTests: XCTestCase {
    private let video = "night-walk.mp4"
    private let photo = "d2d76d31-94a6-496c-8405-251c1042f0b4"

    override func setUp() {
        continueAfterFailure = false
    }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        let server = ProcessInfo.processInfo.environment["NOCT_SERVER"] ?? "http://127.0.0.1:8765"
        // The chrome stays while the video plays, so its buttons can be pressed.
        app.launchArguments = ["-noct.server", server, "-noct.viewerKeepsChrome", "1"]
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

    /// Scrolls the feed to the tile and opens it; returns «Назад».
    private func open(_ id: String, in app: XCUIApplication, shot: String) -> XCUIElement {
        let tile = app.buttons["media-" + id]
        // Between the bars: above the tab bar, below the header.
        let bottom = app.frame.height - 150
        for _ in 0..<10 {
            if tile.exists {
                if tile.frame.midY > bottom {
                    app.swipeUp(velocity: .slow)
                    continue
                }
                if tile.frame.midY < 150 {
                    app.swipeDown(velocity: .slow)
                    continue
                }
                break
            }
            app.swipeUp(velocity: .slow)
        }
        expect(tile.exists, "No media tile in the feed", in: app, shot: shot)
        tile.tap()
        let back = app.buttons["viewer-back"]
        expect(back.waitForExistence(timeout: 10), "The viewer does not open", in: app, shot: shot)
        return back
    }

    private func landscape(_ app: XCUIApplication) -> Bool {
        let frame = app.windows.firstMatch.frame
        return frame.width > frame.height
    }

    func testVideoViewerAnswersAndSwipesAway() {
        let app = launch()
        let back = open(video, in: app, shot: "32-viewer-video")
        save("32-viewer-video")
        back.tap()
        expect(back.waitForNonExistence(timeout: 5), "«Назад» does not close the viewer", in: app, shot: "32-viewer-video")

        _ = open(video, in: app, shot: "33-viewer-menu")
        app.buttons["viewer-menu"].tap()
        let saveItem = app.buttons["Сохранить видео"]
        expect(saveItem.waitForExistence(timeout: 5), "The menu does not open", in: app, shot: "33-viewer-menu")
        save("33-viewer-menu")
        // A tap beside the menu closes it.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)).tap()
        expect(poll(5) { !saveItem.exists }, "The menu does not close", in: app, shot: "33-viewer-menu")

        let full = app.buttons["viewer-fullscreen"]
        expect(full.waitForExistence(timeout: 5), "No full screen button", in: app, shot: "34-viewer-landscape")
        full.tap()
        expect(poll(5) { landscape(app) }, "Full screen does not turn the video", in: app, shot: "34-viewer-landscape")
        save("34-viewer-landscape")
        app.buttons["viewer-fullscreen"].tap()
        expect(poll(5) { !landscape(app) }, "Full screen does not turn back", in: app, shot: "34-viewer-landscape")

        let center = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45))
        center.press(forDuration: 0.05, thenDragTo: center.withOffset(CGVector(dx: 0, dy: 320)))
        expect(app.buttons["viewer-back"].waitForNonExistence(timeout: 5), "A swipe down does not close the viewer", in: app, shot: "35-viewer-swipe")
    }

    func testPhotoViewerCloses() {
        let app = launch()
        let back = open(photo, in: app, shot: "36-viewer-photo")
        save("36-viewer-photo")
        back.tap()
        expect(back.waitForNonExistence(timeout: 5), "«Назад» does not close the photo", in: app, shot: "36-viewer-photo")

        _ = open(photo, in: app, shot: "37-viewer-photo-swipe")
        let center = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        center.press(forDuration: 0.05, thenDragTo: center.withOffset(CGVector(dx: 0, dy: -320)))
        expect(app.buttons["viewer-back"].waitForNonExistence(timeout: 5), "A swipe up does not close the photo", in: app, shot: "37-viewer-photo-swipe")
    }
}
