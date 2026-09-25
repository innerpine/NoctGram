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

    /// Brings the tile wholly between the bars with short drags that do not
    /// coast, then taps it beside its middle, where a video has its play
    /// button; returns «Назад». Should anything cover the feed (a viewer
    /// that left something behind), the viewer does not open.
    private func open(_ id: String, in app: XCUIApplication, shot: String) -> XCUIElement {
        let tile = app.buttons["media-" + id]
        let top: CGFloat = 180, bottom = app.frame.height - 170
        for _ in 0..<20 {
            guard tile.exists else {
                drag(app, by: -280)
                continue
            }
            let frame = tile.frame
            if frame.minY >= top && frame.maxY <= bottom { break }
            drag(app, by: max(-280, min(280, (top + bottom) / 2 - frame.midY)))
        }
        expect(tile.exists, "No media tile in the feed", in: app, shot: shot)
        tile.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.3)).tap()
        let back = app.buttons["viewer-back"]
        expect(back.waitForExistence(timeout: 10), "The viewer does not open", in: app, shot: shot)
        return back
    }

    /// A slow drag that stops where it ends, so the feed does not coast.
    private func drag(_ app: XCUIApplication, by distance: CGFloat) {
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: distance)), withVelocity: .slow, thenHoldForDuration: 0.2)
    }

    private func landscape(_ app: XCUIApplication) -> Bool {
        let frame = app.windows.firstMatch.frame
        return frame.width > frame.height
    }

    /// The viewer itself, whatever XCUITest makes of it (it is modal, so it
    /// may show as an alert).
    private func viewer(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)["media-viewer"]
    }

    func testVideoViewerAnswersAndSwipesAway() {
        let app = launch()
        let back = open(video, in: app, shot: "32-viewer-video")
        save("32-viewer-video")
        // Whether the round play button answers: its label flips.
        let play = app.buttons.matching(NSPredicate(format: "label IN %@", ["Пауза", "Смотреть"])).firstMatch
        let before = play.exists ? play.label : "none"
        if play.exists { play.tap() }
        let answered = poll(3) { play.exists && play.label != before }
        back.tap()
        // Gone for good, not just its buttons: nothing stays over the feed.
        expect(viewer(app).waitForNonExistence(timeout: 5), "«Назад» does not close the viewer (play button \(before) answered \(answered))", in: app, shot: "32-viewer-video")

        _ = open(video, in: app, shot: "33-viewer-menu")
        app.buttons["viewer-menu"].tap()
        let saveItem = app.buttons["Сохранить видео"]
        expect(saveItem.waitForExistence(timeout: 5), "The menu does not open", in: app, shot: "33-viewer-menu")
        save("33-viewer-menu")
        // A tap beside the menu closes it: on the black above the video,
        // clear of the menu that opens under the button.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.33)).tap()
        expect(poll(5) { !saveItem.exists }, "The menu does not close", in: app, shot: "33-viewer-menu")

        let center = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45))
        center.press(forDuration: 0.05, thenDragTo: center.withOffset(CGVector(dx: 0, dy: 320)))
        expect(viewer(app).waitForNonExistence(timeout: 5), "A swipe down does not close the viewer", in: app, shot: "35-viewer-swipe")
        // And the feed answers again.
        _ = open(video, in: app, shot: "35-viewer-swipe")
    }

    func testVideoFullScreenTurns() {
        let app = launch()
        _ = open(video, in: app, shot: "34-viewer-landscape")
        let full = app.buttons["viewer-fullscreen"]
        expect(full.waitForExistence(timeout: 5), "No full screen button", in: app, shot: "34-viewer-landscape")
        let before = "button \(full.frame), hittable \(full.isHittable)"
        full.tap()
        let turned = poll(8) { landscape(app) }
        expect(turned, "Full screen does not turn the video (\(before); window after \(app.windows.firstMatch.frame), button there \(full.exists))", in: app, shot: "34-viewer-landscape")
        save("34-viewer-landscape")
        app.buttons["viewer-fullscreen"].tap()
        expect(poll(8) { !landscape(app) }, "Full screen does not turn back", in: app, shot: "34-viewer-landscape")
        app.buttons["viewer-back"].tap()
        expect(viewer(app).waitForNonExistence(timeout: 5), "«Назад» does not close the viewer after full screen", in: app, shot: "34-viewer-landscape")
    }

    func testPhotoViewerCloses() {
        let app = launch()
        let back = open(photo, in: app, shot: "36-viewer-photo")
        save("36-viewer-photo")
        back.tap()
        expect(viewer(app).waitForNonExistence(timeout: 5), "«Назад» does not close the photo", in: app, shot: "36-viewer-photo")

        _ = open(photo, in: app, shot: "37-viewer-photo-swipe")
        let center = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        center.press(forDuration: 0.05, thenDragTo: center.withOffset(CGVector(dx: 0, dy: -320)))
        expect(viewer(app).waitForNonExistence(timeout: 5), "A swipe up does not close the photo", in: app, shot: "37-viewer-photo-swipe")
    }
}
