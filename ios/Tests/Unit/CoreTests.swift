import XCTest
@testable import Noctgram

/// Decoding of real API responses (Tests/Fixtures, captured from a local
/// NoctGram server with sample accounts) and the formatting shared with the web.
final class CoreTests: XCTestCase {
    private func responses() throws -> JSON {
        let url: URL
        if let path = ProcessInfo.processInfo.environment["NOCT_FIXTURES"] {
            url = URL(fileURLWithPath: path)
        } else {
            url = try XCTUnwrap(Bundle(for: CoreTests.self).url(forResource: "fixtures", withExtension: "json"))
        }
        return try XCTUnwrap(JSON.parse(Data(contentsOf: url)))["responses"]
    }

    func testTolerantScalars() throws {
        let json = try XCTUnwrap(JSON.parse(Data(#"{"one":1,"two":"2","yes":true,"none":null,"text":"x","half":1.5}"#.utf8)))
        XCTAssertTrue(json["one"].bool)
        XCTAssertEqual(json["two"].int, 2)
        XCTAssertTrue(json["yes"].bool)
        XCTAssertTrue(json["none"].isNull)
        XCTAssertFalse(json["missing"].bool)
        XCTAssertEqual(json["one"].string, "1")
        XCTAssertEqual(json["half"].double, 1.5)
        XCTAssertEqual(json["text"].str, "x")
        XCTAssertEqual(json["none"].str, "")
        XCTAssertEqual(JSON.string(#"{"a":2}"#).nestedJSON["a"].int, 2)
    }

    func testOwnProfileHasEverythingTheWebShows() throws {
        let profile = Profile(try responses()["profileAlice"])
        XCTAssertEqual(profile.name, "Алиса Ночная")
        XCTAssertEqual(profile.handle, "alice_night")
        XCTAssertEqual(profile.extraHandles, ["alice_writes", "moonchild"])
        XCTAssertTrue(profile.appearance.premium)
        XCTAssertTrue(profile.appearance.nameGradient)
        XCTAssertTrue(profile.appearance.chromeFlow)
        XCTAssertEqual(profile.appearance.ringText, "ночь · музыка · звёзды")
        XCTAssertEqual(profile.appearance.profileTheme, "iris")
        XCTAssertEqual(profile.background.mode, "none")
        XCTAssertEqual(profile.location, "Санкт-Петербург")
        XCTAssertEqual(profile.website, "https://noctgram.com")
        XCTAssertEqual(profile.instagram, "alice.night")
        XCTAssertEqual(profile.tiktok, "alicenight")
        XCTAssertEqual(profile.youtube, "alicenight")
        XCTAssertEqual(profile.birthday, "1999-03-14")
        XCTAssertTrue(profile.showBirthYear)
        XCTAssertEqual(profile.followers, 2)
        XCTAssertEqual(profile.following, 1)
        XCTAssertEqual(profile.postCount, 4)
        XCTAssertFalse(profile.isChannel)
        XCTAssertFalse(profile.pinnedPostId.isEmpty)
        XCTAssertTrue(profile.coverImage.hasPrefix("/api/media/"))
        XCTAssertEqual(profile.personalChannels.count, 1)
        let channel = try XCTUnwrap(profile.personalChannels.first)
        XCTAssertEqual(channel.handle, "night_city")
        XCTAssertEqual(channel.followers, 2)
        XCTAssertTrue(channel.post?.summary.hasPrefix("Новый выпуск") ?? false)
    }

    func testChannelAndLiquidCoverProfiles() throws {
        let channel = Profile(try responses()["profileChannel"])
        XCTAssertTrue(channel.isChannel)
        XCTAssertEqual(channel.channelRole, "owner")
        XCTAssertTrue(channel.canPublish)
        XCTAssertTrue(channel.canEditProfile)
        let bob = Profile(try responses()["profileBob"])
        XCTAssertTrue(bob.isLiquidCover)
        XCTAssertEqual(bob.coverImage, "")
        XCTAssertTrue(bob.followed)
        XCTAssertGreaterThan(bob.lastSeen, 0)
    }

    func testFeedPosts() throws {
        let posts = try responses()["feed"].array.map { Post($0) }
        XCTAssertFalse(posts.isEmpty)
        let photos = try XCTUnwrap(posts.first { $0.media.count == 2 })
        XCTAssertTrue(photos.media.allSatisfy(\.isImage))
        XCTAssertTrue(photos.pinned)
        XCTAssertEqual(photos.likes, 2)
        XCTAssertEqual(photos.comments, 2)
        let poll = try XCTUnwrap(posts.first { !$0.poll.isEmpty })
        XCTAssertEqual(poll.poll.count, 4)
        XCTAssertEqual(poll.totalVotes, 2)
        let code = try XCTUnwrap(posts.first { !$0.code.isEmpty })
        XCTAssertEqual(code.codeLang, "swift")
        XCTAssertTrue(code.isMine("local_alice"))
        XCTAssertTrue(posts.contains { $0.isChannel })
    }

    func testCommentsMessagesAndGifts() throws {
        let comments = try responses()["comments"].array.map { Comment($0) }
        XCTAssertEqual(comments.count, 2)
        let messages = try responses()["messagesBob"].array.map { ChatMessage($0) }
        XCTAssertGreaterThanOrEqual(messages.count, 3)
        let gift = try XCTUnwrap(messages.compactMap(\.gift).first)
        XCTAssertEqual(gift.giftId, "toy_bear")
        XCTAssertEqual(gift.price, 25)
        XCTAssertEqual(gift.message, "Для самой ночной 🧸")
        let gifts = try responses()["gifts"]["gifts"].array.map { ReceivedGift($0) }
        XCTAssertEqual(gifts.count, 2)
        XCTAssertTrue(gifts.contains { $0.artPath == "/assets/gifts/toy_bear.webp" })
        let catalog = try responses()["giftCatalog"]["catalog"].array.map { GiftDefinition($0) }
        XCTAssertTrue(catalog.contains { $0.id == "toy_bear" && $0.name == "Мишка" && $0.price == 25 })
        XCTAssertTrue(gifts.allSatisfy { $0.recipient == "local_alice" })
        let quote = try XCTUnwrap(JSON.parse(Data(#"{"id":"g","available":true,"reason":null,"originalPrice":25,"amount":21,"fee":4,"feePercent":15,"convertedAt":null}"#.utf8)))
        let sale = GiftSale(quote)
        XCTAssertTrue(sale.available)
        XCTAssertEqual(sale.originalPrice, 25)
        XCTAssertEqual(sale.amount, 21)
        XCTAssertEqual(sale.feePercent, 15)
        XCTAssertEqual(sale.reason, "")
    }

    func testGiftUpgradeReadsAsTheSite() throws {
        func json(_ text: String) throws -> JSON { try XCTUnwrap(JSON.parse(Data(text.utf8))) }
        let preview = GiftUpgradePreview(try json(#"""
        {"balance":40,"collectible":null,"collection":{"id":"toy_bear","title":"Toy Bear","price":25,
         "models":[{"id":"m1","name":"Cozy","rarityPermille":12,"asset":"collectible-toy_bear-m1"},{"id":"m2","name":"Midnight","rarityPermille":988,"asset":"collectible-toy_bear-m2"}],
         "backdrops":[{"id":"b1","name":"Chocolate","rarityPermille":10,"centerColor":"#a46e58","edgeColor":"#74443b","patternColor":"#3e0a02","textColor":"#e4b6ac"}],
         "symbols":[{"id":"s1","name":"Money Bag","rarityPermille":4,"asset":"gift-pattern-s1"},{"id":"s2","name":"Cap","rarityPermille":996,"asset":"gift-pattern-s2"}]}}
        """#))
        let collection = try XCTUnwrap(preview.collection)
        XCTAssertEqual(preview.balance, 40)
        XCTAssertNil(preview.collectible)
        XCTAssertEqual(collection.price, 25)
        // previewAttributes(): the model at step × 7, the symbol at step × 13.
        XCTAssertEqual(collection.look(at: 1).model.id, "m2")
        XCTAssertEqual(collection.look(at: 1).symbol.id, "s2")
        XCTAssertEqual(collection.look(at: 2).model.id, "m1")
        // giftRarity(): tenths of a percent with a Russian comma.
        XCTAssertEqual(collection.models[0].rarity, "1,2%")
        XCTAssertEqual(collection.backdrops[0].rarity, "1%")
        XCTAssertEqual(collection.symbols[0].rarity, "0,4%")
        XCTAssertEqual(collection.backdrops[0].pattern, "#3e0a02")
        let collectible = try XCTUnwrap(Collectible(try json(#"{"family":"toy_bear","number":1234,"keepOriginal":1,"model":{"id":"m1","name":"Cozy","rarityPermille":12,"asset":"collectible-toy_bear-m1"},"backdrop":{"id":"b1","name":"Chocolate","rarityPermille":10},"symbol":{"id":"s1","name":"Money Bag","rarityPermille":4,"asset":"gift-pattern-s1"}}"#)))
        XCTAssertEqual(collectible.number, 1234)
        XCTAssertTrue(collectible.keepOriginal)
        XCTAssertFalse(collectible.issued)
        XCTAssertEqual(collectible.modelAsset, "collectible-toy_bear-m1")
        XCTAssertEqual(collectible.look.backdrop.center, "#3b3b46")
        XCTAssertNil(GiftUpgradePreview(try json(#"{"balance":0,"collection":null,"collectible":null}"#)).collection)
    }

    func testThreadsNotificationsWallet() throws {
        let threads = try responses()["threads"].array.map { Person($0) }
        XCTAssertEqual(threads.map(\.handle), ["carol_sky", "bob_night"])
        XCTAssertEqual(threads.map(\.unread), [2, 3])
        let notices = try responses()["notifications"].array.map { NoctNotification($0) }
        XCTAssertTrue(Set(notices.map(\.kind)).isSuperset(of: ["message", "gift", "like", "comment", "follow"]))
        XCTAssertTrue(notices.contains { $0.kind == "comment" && !$0.commentText.isEmpty && !$0.postImage.isEmpty })
        let wallet = Wallet(try responses()["wallet"])
        XCTAssertEqual(wallet.balance, 10_000)
        XCTAssertTrue(wallet.testMode)
        let status = AuthStatus(try responses()["session"])
        XCTAssertEqual(status.user?.id, "local_alice")
        XCTAssertTrue(status.user?.onboardingComplete ?? false)
    }

    func testRussianFormatting() {
        XCTAssertEqual(Format.plural(1, "подписчик", "подписчика", "подписчиков"), "подписчик")
        XCTAssertEqual(Format.plural(3, "подписчик", "подписчика", "подписчиков"), "подписчика")
        XCTAssertEqual(Format.plural(11, "подписчик", "подписчика", "подписчиков"), "подписчиков")
        XCTAssertEqual(Format.plural(21, "подписчик", "подписчика", "подписчиков"), "подписчик")
        XCTAssertEqual(Format.plural(112, "подписчик", "подписчика", "подписчиков"), "подписчиков")
        XCTAssertEqual(Format.marketNumber("12345678"), "+888 1234 5678")
        XCTAssertEqual(Format.siteLabel("https://www.example.com/"), "example.com")
        XCTAssertEqual(Format.initials("Алиса Ночная"), "АН")
        XCTAssertEqual(Format.birthday("03-14"), "14 марта")
        XCTAssertTrue(Format.birthday("1999-03-14").hasPrefix("14 марта 1999 ("))
        XCTAssertEqual(Format.birthday("bad"), "")
        XCTAssertEqual(Format.fileSize(512), "512 Б")
        XCTAssertNotNil(Format.receipt(1790235131598).range(of: #"^\d{2}\.\d{2}\.\d{2} в \d{2}:\d{2}$"#, options: .regularExpression))
    }

    func testLinksMentionsAndTags() throws {
        let text = RichText.attributed("Привет @alice_night и #ночь: https://example.com/a. Почта me@site.ru", baseURL: URL(string: "https://noctgram.com"))
        let links = text.runs.compactMap(\.link)
        XCTAssertEqual(links, [AppLink.handle("alice_night"), AppLink.tag("#ночь"), URL(string: "https://example.com/a")].compactMap { $0 })
        let profile = RichText.attributed("https://noctgram.com/?handle=bob_night", baseURL: URL(string: "https://noctgram.com"))
        XCTAssertEqual(profile.runs.compactMap(\.link), [AppLink.handle("bob_night")].compactMap { $0 })
        XCTAssertEqual(PremiumEmoji.replace("Горит :noct_fire: и :noct_moon:"), "Горит 🔥 и 🌛")
        XCTAssertTrue(Emoji.isOnly("🔥", limit: 3))
        XCTAssertTrue(Emoji.isOnly("❤️ 👍", limit: 3))
        XCTAssertFalse(Emoji.isOnly("ок", limit: 3))
        XCTAssertFalse(Emoji.isOnly("1", limit: 3))
        XCTAssertFalse(Emoji.isOnly("🔥🔥🔥🔥", limit: 3))
    }

    func testOneReactionPerPerson() {
        let start = [Reaction(emoji: "👍", count: 2, own: true), Reaction(emoji: "🔥", count: 1, own: false)]
        let fire = Reaction.applying("🔥", to: start)
        XCTAssertEqual(fire, [Reaction(emoji: "👍", count: 1, own: false), Reaction(emoji: "🔥", count: 2, own: true)])
        XCTAssertEqual(Reaction.applying(nil, to: fire), [Reaction(emoji: "👍", count: 1, own: false), Reaction(emoji: "🔥", count: 1, own: false)])
        XCTAssertEqual(Reaction.applying("❤️", to: []), [Reaction(emoji: "❤️", count: 1, own: true)])
        XCTAssertEqual(Reaction.applying(nil, to: [Reaction(emoji: "😢", count: 1, own: true)]), [])
    }

    /// The same two colours as lib/image-palette.ts finds (checked with the
    /// site's function on the same pixels).
    func testPaletteMatchesTheSite() {
        func pixels(_ runs: [(count: Int, red: UInt8, green: UInt8, blue: UInt8)]) -> [UInt8] {
            var bytes: [UInt8] = []
            for run in runs {
                for _ in 0..<run.count { bytes += [run.red, run.green, run.blue, 255] }
            }
            return bytes
        }
        // Nearly black and nearly white pixels do not count: #28785a, #c83c8c.
        let plain = ImagePalette.palette(pixels([(300, 40, 120, 90), (200, 200, 60, 140), (50, 10, 10, 10), (26, 250, 250, 250)]))
        XCTAssertEqual(plain, [RGBColor(0x28785A), RGBColor(0xC83C8C)])
        // A second colour too close to the first gives way: #28785a, #e6c828.
        let close = ImagePalette.palette(pixels([(300, 40, 120, 90), (200, 50, 125, 100), (76, 230, 200, 40)]))
        XCTAssertEqual(close, [RGBColor(0x28785A), RGBColor(0xE6C828)])
        XCTAssertNil(ImagePalette.palette(pixels([(10, 5, 5, 5)])))
        // color-mix(in srgb, #87e7d6 30%, #0b0b10).
        XCTAssertEqual(RGBColor(0x87E7D6).mixed(into: RGBColor(0x0B0B10), amount: 0.3), RGBColor(red: 48.2, green: 77, blue: 75.4))
    }

    func testTeamRowsReadAsTheSiteShowsThem() throws {
        func json(_ text: String) throws -> JSON { try XCTUnwrap(JSON.parse(Data(text.utf8))) }
        let report = TeamReport(try json(#"{"id":"r","targetType":"post","kind":"channel","handle":"night_city","status":"new","available":1}"#))
        XCTAssertEqual(report.title, "@night_city · Пост канала")
        XCTAssertTrue(report.canOpenPost)
        XCTAssertEqual(report.removeTitle, "Удалить пост")
        XCTAssertEqual(TeamReport(try json(#"{"targetType":"message","handle":null}"#)).title, "Удалённый аккаунт · Личное сообщение")
        let event = TeamAdminEvent(try json(#"{"id":"e","action":"starsDebit","amount":1500,"actorName":"Алиса","handle":"bob_night"}"#))
        XCTAssertEqual(event.title, "Отнять Stars −1\u{00A0}500")
        XCTAssertEqual(event.subtitle, "Алиса → @bob_night")
        let account = TeamAccount(try json(#"{"id":"u","mode":"blocked","reason":"Спам","expiresAt":null,"canRestrict":1}"#))
        XCTAssertEqual(account.status.title, "Заблокирован")
        XCTAssertEqual(account.current, "Сейчас: блокировка, бессрочно. Спам")
        XCTAssertTrue(account.canRestrict)
        let message = ChatMessage(room: try json(#"{"id":"m","sender":"b","senderName":"Боб","senderAppearance":{"premium":1,"profileTheme":"aurora"}}"#))
        XCTAssertTrue(message.senderAppearance.premium)
        XCTAssertEqual(message.senderAppearance.theme, .aurora)
    }

    /// Waveforms as lib/voice-waveform.ts stores them: one base32 character
    /// per 0–31 sample, loud outliers capped at 1.8× the mean.
    func testWaveformsReadAsTheSite() {
        XCTAssertEqual(Waveform.decode("0v80"), [0, 31, 8, 0])
        XCTAssertEqual(Waveform.encode([0, 31, 8, 40, -2]), "0v8v0")
        XCTAssertEqual(Waveform.decode("0v8?w"), [0, 31, 8])
        let wave = Waveform.fromPeaks([0, 1000, 2000, 30000], count: 4)
        // The cap is max(1.8 × mean, 2500) = 14 850: the outlier is 31.
        XCTAssertEqual(wave, [0, 2, 4, 31])
        XCTAssertEqual(Waveform.resample([1, 5, 2, 9], bars: 2), [5, 9])
        XCTAssertEqual(Waveform.barCount(duration: 1), 24)
        XCTAssertEqual(Waveform.barCount(duration: 60), 56)
        XCTAssertEqual(Waveform.clock(67.4), "1:07")
        XCTAssertEqual(Waveform.clock(7.46, tenths: true), "0:07,4")
    }

    /// Premium and custom emoji tokens (lib/premium-emoji.ts) and the large
    /// emoji rule (lib/chat-emoji.ts): one to six emoji, tokens count as one.
    func testEmojiTokensReadAsTheSite() {
        let custom = ":ce_3f0c2a9e-8d7b-4c1a-9e2f-5b6d7c8e9f01:"
        XCTAssertEqual(EmojiTokens.parts("Горит :noct_fire:!"), [.text("Горит "), .token(":noct_fire:"), .text("!")])
        XCTAssertEqual(EmojiTokens.parts(":noct_unknown_thing: x"), [.text(":noct_unknown_thing: x")])
        XCTAssertEqual(EmojiTokens.customId(custom), "3f0c2a9e-8d7b-4c1a-9e2f-5b6d7c8e9f01")
        XCTAssertEqual(EmojiTokens.fallback("А :noct_star_gold: и \(custom)"), "А ⭐ и ✨")
        XCTAssertTrue(EmojiTokens.contains("x :noct_duck:"))
        XCTAssertFalse(EmojiTokens.contains("просто текст"))
        XCTAssertEqual(EmojiTokens.largeCount(":noct_fire::noct_moon: 🔥"), 3)
        XCTAssertEqual(EmojiTokens.largeCount("🔥🔥🔥🔥🔥🔥🔥"), 0)
        XCTAssertEqual(EmojiTokens.largeCount("ок 🔥"), 0)
        XCTAssertEqual(EmojiTokens.largeCount("❤️"), 1)
    }

    /// Stickers resolve to their pictures the way the site finds them.
    func testStickersReadAsTheSite() throws {
        func json(_ text: String) throws -> JSON { try XCTUnwrap(JSON.parse(Data(text.utf8))) }
        let built = Sticker(try json(#"{"ref":"b:utya:birthday","packRef":"b:utya","emoji":"🎂","format":"lottie","src":"/assets/stickers/tgs/UtyanBirthday.json","w":512,"h":512,"available":true}"#))
        XCTAssertTrue(built.animated)
        XCTAssertEqual(built.poster, "/assets/stickers/posters/UtyanBirthday.webp")
        XCTAssertEqual(built.packName, "utya")
        let upload = Sticker(try json(#"{"ref":"u:1","packRef":"u:7a1b","emoji":"😺","format":"tgs","src":"/api/media/5d6e","available":true}"#))
        XCTAssertTrue(upload.animated)
        XCTAssertNil(upload.poster)
        XCTAssertEqual(upload.packName, "u:7a1b")
        let still = Sticker(try json(#"{"ref":"u:2","format":"webp","src":"/api/media/9","available":true}"#))
        XCTAssertFalse(still.animated)
        XCTAssertEqual(still.poster, "/api/media/9")
        let gone = Sticker(try json(#"{"ref":"u:3","emoji":"🐱","format":"webp","src":"","available":true}"#))
        XCTAssertFalse(gone.available)
        XCTAssertEqual(EmojiTokens.legacySticker(EmojiTokens.legacy[6]).poster, "/assets/emoji/5424972470023104089.preview.webp")
    }

    /// Chat folders pick chats by the site's rules (lib/chat-folders-filter.ts).
    func testFoldersPickChatsAsTheSite() throws {
        func json(_ text: String) throws -> JSON { try XCTUnwrap(JSON.parse(Data(text.utf8))) }
        let folder = ChatFolder(try json(#"{"id":"f","title":"Личные","includePersonal":true,"excludeArchived":true,"includePeers":["room:g"],"excludePeers":["person:b"]}"#))
        let open = ThreadItem.direct(Person(try json(#"{"id":"a"}"#)))
        let excluded = ThreadItem.direct(Person(try json(#"{"id":"b"}"#)))
        let archived = ThreadItem.direct(Person(try json(#"{"id":"c","archivedAt":5}"#)))
        let chosenGroup = ThreadItem.room(RoomSummary(try json(#"{"id":"g","kind":"group"}"#)))
        let otherGroup = ThreadItem.room(RoomSummary(try json(#"{"id":"h","kind":"group"}"#)))
        XCTAssertEqual([open, excluded, archived, chosenGroup, otherGroup].filter(folder.includes), [open, chosenGroup])
        let unread = ChatFolder(try json(#"{"id":"u","title":"Новые","includePersonal":true,"includeGroups":true,"excludeRead":true}"#))
        let fresh = ThreadItem.direct(Person(try json(#"{"id":"d","unread":2}"#)))
        XCTAssertEqual([open, fresh, otherGroup].filter(unread.includes), [fresh])
    }

    /// Voice, round, sticker, quote and shared post fields of a message.
    func testChatMessagesCarryTheNewKinds() throws {
        func json(_ text: String) throws -> JSON { try XCTUnwrap(JSON.parse(Data(text.utf8))) }
        let voice = ChatMessage(try json(#"{"id":"message:b:k","sender":"b","recipient":"a","text":"","created":1,"read":0,"listenedAt":0,"forwardedName":"Кэрол","forwardedSender":"c","attachments":[{"id":"v","name":"voice.m4a","type":"audio/mp4","size":9,"kind":"voice","duration":4200,"waveform":"0v8"}],"reply":{"id":"x","sender":"a","name":"Алиса","text":"Встречаемся в восемь","unavailable":false,"quote":"в восемь"}}"#))
        XCTAssertEqual(voice.voice?.duration, 4.2)
        XCTAssertEqual(voice.voice?.waveform, [0, 31, 8])
        XCTAssertEqual(voice.summary, "Голосовое сообщение")
        XCTAssertEqual(voice.forwardedSender, "c")
        XCTAssertEqual(voice.reply?.quote, "в восемь")
        XCTAssertEqual(voice.listenedAt, 0)
        let sticker = ChatMessage(try json(#"{"id":"s","sender":"b","text":"","sticker":"b:utya:birthday","postShare":null}"#))
        XCTAssertEqual(sticker.sticker, "b:utya:birthday")
        XCTAssertEqual(sticker.summary, "Стикер")
        let post = ChatMessage(try json(#"{"id":"p","sender":"b","text":"","postShare":{"id":"post-1"}}"#))
        XCTAssertEqual(post.postShare, "post-1")
        let room = ChatMessage(room: try json(#"{"id":"r","roomId":"g","sender":"b","senderName":"Боб","text":"","deletedAt":5,"attachments":[{"id":"o","kind":"round","type":"video/mp4","duration":12000}],"forwardedName":"Кэрол","forwardedFrom":"c","topicId":"t1","replyTo":"q"}"#))
        XCTAssertTrue(room.deleted)
        XCTAssertEqual(room.round?.duration, 12)
        XCTAssertEqual(room.forwardedSender, "c")
        XCTAssertEqual(room.topicId, "t1")
        XCTAssertEqual(room.recipient, "g")
        XCTAssertEqual(room.reply?.id, "q")
    }
}
