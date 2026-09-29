import XCTest

/// Stickers, emoji, voice and round messages and forwarding on the mock
/// server (ios/Tests/mock_server.py), in the dialogue with Carol that holds
/// every new kind of message. The recorder records a tone
/// (`-noct.fakeRecorder`): the simulator of CI has no microphone.
final class ChatMediaTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(_ route: String = "chat:local_carol", _ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        let server = ProcessInfo.processInfo.environment["NOCT_SERVER"] ?? "http://127.0.0.1:8765"
        app.launchArguments = ["-noct.server", server, "-noct.debugTab", "messages", "-noct.debugRoute", route,
                               "-noct.fakeRecorder", "1", "-noct.panelTab", "stickers"] + extra
        app.launch()
        return app
    }

    private func element(_ id: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)[id]
    }

    private func save(_ name: String) {
        guard let directory = ProcessInfo.processInfo.environment["SHOTS_DIR"] else { return }
        let url = URL(fileURLWithPath: directory).appendingPathComponent(name + ".png")
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: url)
    }

    private func poll(_ timeout: TimeInterval, until condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    private func expect(_ passed: Bool, _ message: String, in app: XCUIApplication, shot: String) {
        if !passed {
            save(shot + "-failed")
            print("UI TREE (\(message)):\n" + app.debugDescription)
        }
        XCTAssertTrue(passed, message)
    }

    /// Messages whose spoken line contains the text.
    private func messages(saying text: String, in app: XCUIApplication) -> XCUIElementQuery {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "message-", text))
    }

    private func fieldText(_ app: XCUIApplication) -> String {
        element("composer-field", in: app).value as? String ?? ""
    }

    func testStickerPanelSendsASticker() {
        let app = launch()
        let toggle = element("composer-stickers", in: app)
        expect(toggle.waitForExistence(timeout: 30), "No sticker button in the field", in: app, shot: "50-sticker-panel")
        let before = messages(saying: "Стикер", in: app).count
        toggle.tap()
        expect(element("sticker-panel", in: app).waitForExistence(timeout: 10), "The panel does not open", in: app, shot: "50-sticker-panel")
        element("panel-tab-stickers", in: app).tap()
        // Favourites of the panel come first; the pack bar leads to Утя.
        let pack = app.buttons["Утя"]
        expect(pack.waitForExistence(timeout: 20), "The built-in packs are not in the bar", in: app, shot: "50-sticker-panel")
        pack.tap()
        let sticker = element("sticker-b:utya:discussion", in: app)
        expect(sticker.waitForExistence(timeout: 20), "The built-in packs do not show", in: app, shot: "50-sticker-panel")
        Thread.sleep(forTimeInterval: 2)
        save("50-sticker-panel")
        sticker.tap()
        let sent = poll(10) { messages(saying: "Стикер", in: app).count > before }
        expect(sent, "The sticker is not sent", in: app, shot: "50-sticker-sent")
        // The keyboard comes back in place of the panel.
        element("composer-stickers", in: app).tap()
        expect(poll(5) { !element("sticker-panel", in: app).exists }, "The panel does not give way to the keyboard", in: app, shot: "50-sticker-keyboard")
    }

    func testEmojiTabFillsTheField() {
        let app = launch()
        let toggle = element("composer-stickers", in: app)
        expect(toggle.waitForExistence(timeout: 30), "No sticker button in the field", in: app, shot: "51-emoji-panel")
        toggle.tap()
        element("panel-tab-emoji", in: app).tap()
        // The category bar leads to the smileys and to the premium sets.
        let smileys = app.buttons["Смайлы и люди"]
        expect(smileys.waitForExistence(timeout: 10), "No categories in the emoji tab", in: app, shot: "51-emoji-panel")
        smileys.tap()
        let smile = element("emoji-😀", in: app).firstMatch
        expect(smile.waitForExistence(timeout: 10), "No emoji in the emoji tab", in: app, shot: "51-emoji-panel")
        smile.tap()
        expect(poll(5) { fieldText(app).contains("😀") }, "An emoji does not go into the field", in: app, shot: "51-emoji-panel")
        // A premium emoji goes in as its token and shows in the preview.
        app.buttons["NewsEmoji"].tap()
        let fire = element("premium-emoji-:noct_fire:", in: app)
        expect(fire.waitForExistence(timeout: 10), "No premium emoji", in: app, shot: "51-emoji-panel")
        fire.tap()
        expect(poll(5) { fieldText(app).contains(":noct_fire:") }, "A premium emoji does not go into the field", in: app, shot: "51-emoji-panel")
        let preview = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Предпросмотр")).firstMatch
        expect(preview.waitForExistence(timeout: 5), "No preview of the premium emoji", in: app, shot: "51-emoji-panel")
        save("51-emoji-panel")
        // The backspace takes the whole token back.
        element("panel-backspace", in: app).tap()
        expect(poll(5) { !fieldText(app).contains(":noct_fire:") && fieldText(app).contains("😀") }, "The backspace does not take the token back", in: app, shot: "51-emoji-backspace")
    }

    func testVoiceMessageRecordsAndPlays() {
        let app = launch()
        let record = element("composer-record", in: app)
        expect(record.waitForExistence(timeout: 30), "No microphone in the composer", in: app, shot: "52-voice")
        let voices = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "voice-play-"))
        let before = voices.count
        // A tap switches to round videos and back, as in Telegram.
        record.tap()
        expect(poll(5) { record.label == "Видеосообщение" }, "A tap does not switch to round videos", in: app, shot: "52-voice-mode")
        record.tap()
        expect(poll(5) { record.label == "Голосовое сообщение" }, "A second tap does not switch back", in: app, shot: "52-voice-mode")
        // Holding records; letting go sends.
        record.press(forDuration: 2.5)
        expect(poll(15) { voices.count > before }, "The recording is not sent", in: app, shot: "52-voice-sent")
        // Playing the sent voice message: pause and the speed show.
        voices.element(boundBy: voices.count - 1).tap()
        expect(app.buttons["Пауза"].waitForExistence(timeout: 10), "The voice message does not play", in: app, shot: "52-voice")
        let speed = app.buttons["Скорость 1×"]
        expect(speed.waitForExistence(timeout: 5), "No speed button while playing", in: app, shot: "52-voice")
        speed.tap()
        expect(app.buttons["Скорость 1,5×"].waitForExistence(timeout: 5), "The speed does not change", in: app, shot: "52-voice")
        save("52-voice")
    }

    func testRoundVideoPlaysInACircle() {
        let app = launch()
        let round = element("round-night-walk.mp4", in: app)
        expect(round.waitForExistence(timeout: 30), "No round video in the dialogue", in: app, shot: "53-round")
        Thread.sleep(forTimeInterval: 2)
        save("53-round")
        if round.isHittable {
            round.tap()
            Thread.sleep(forTimeInterval: 1.5)
            save("53b-round-playing")
        }
    }

    /// Search over every chat finds a message and opens its chat on it.
    func testSearchOpensTheFoundMessage() {
        let app = launch("screen:none")
        let field = app.searchFields.firstMatch
        expect(field.waitForExistence(timeout: 30), "No search field over the chats", in: app, shot: "56-search")
        field.tap()
        field.typeText("гулять")
        let hit = element("hit-message:local_alice:media-6", in: app)
        expect(hit.waitForExistence(timeout: 15), "The message is not found", in: app, shot: "56-search")
        save("56-search")
        hit.tap()
        let bubble = element("message-message:local_alice:media-6", in: app)
        expect(bubble.waitForExistence(timeout: 20), "The found message does not open", in: app, shot: "57-search-open")
        expect(poll(5) { bubble.isHittable }, "The chat does not show the found message", in: app, shot: "57-search-open")
    }

    /// «Цитировать» takes a fragment into the reply.
    func testQuoteAnswersAFragment() {
        let app = launch()
        let bubble = element("message-message:local_alice:media-6", in: app)
        expect(bubble.waitForExistence(timeout: 30), "No text message", in: app, shot: "58-quote")
        bubble.press(forDuration: 0.8)
        let quote = app.buttons["Цитировать"]
        expect(quote.waitForExistence(timeout: 5), "No «Цитировать» in the menu", in: app, shot: "58-quote")
        quote.tap()
        let text = element("quote-text", in: app)
        expect(text.waitForExistence(timeout: 10), "The quote sheet does not open", in: app, shot: "58-quote")
        // A double tap selects a word.
        text.doubleTap()
        let confirm = app.buttons["quote-confirm"]
        expect(poll(5) { confirm.isEnabled }, "Selecting a word does not allow quoting", in: app, shot: "58-quote")
        confirm.tap()
        let context = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "«")).firstMatch
        expect(context.waitForExistence(timeout: 5), "The quote is not over the field", in: app, shot: "58-quote")
        save("58-quote")
    }

    func testForwardToSaved() {
        let app = launch()
        let bubble = element("message-message:local_carol:media-5", in: app)
        expect(bubble.waitForExistence(timeout: 30), "No message with emoji", in: app, shot: "54-forward")
        bubble.press(forDuration: 0.8)
        let forward = app.buttons["Переслать"]
        expect(forward.waitForExistence(timeout: 5), "No «Переслать» in the menu", in: app, shot: "54-forward")
        forward.tap()
        let saved = element("forward-person:local_alice", in: app)
        expect(saved.waitForExistence(timeout: 10), "«Избранное» is not offered", in: app, shot: "54-forward")
        saved.tap()
        let group = element("forward-room:room_media", in: app)
        expect(group.waitForExistence(timeout: 10), "Groups are not offered", in: app, shot: "54-forward")
        group.tap()
        save("54-forward")
        element("forward-send", in: app).tap()
        expect(poll(10) { !element("forward-send", in: app).exists }, "The forward sheet stays open", in: app, shot: "54-forward-sent")
        app.terminate()

        let notes = launch("chat:local_alice")
        let copy = messages(saying: "Переслано от Кэрол", in: notes).firstMatch
        expect(copy.waitForExistence(timeout: 30), "The forward is not in «Избранное»", in: notes, shot: "55-saved")
        Thread.sleep(forTimeInterval: 1.5)
        save("55-saved")
    }
}
